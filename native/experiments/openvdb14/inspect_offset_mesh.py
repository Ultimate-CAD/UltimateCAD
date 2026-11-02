"""Locate exact emitted defects and measure raw-to-delivered cavity conversion."""
import json
import struct
import sys
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

folder = Path(sys.argv[1])


def load(path):
    b = path.read_bytes()
    magic, version, pn, tn = struct.unpack_from('<4I', b)
    assert magic == 0x31524C4C and version == 1
    return np.frombuffer(b, '<f8', pn, 16).reshape(-1, 3), np.frombuffer(b, '<u4', tn, 16+pn*8).reshape(-1, 3)


def save(path, points, faces):
    with path.open('wb') as f:
        f.write(struct.pack('<4I', 0x31524C4C, 1, len(points)*3, len(faces)*3))
        f.write(np.asarray(points, '<f8').tobytes())
        f.write(np.asarray(faces, '<u4').tobytes())


raw_v, raw_f = load(folder / 'cavity-raw.mesh.bin')
zero_ids, small_count = [], 0
for start in range(0, len(raw_f), 100000):
    tri = raw_v[raw_f[start:start+100000]]
    area2 = np.linalg.norm(np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]), axis=1)
    zero_ids.extend((np.flatnonzero(area2 == 0) + start).tolist())
    small_count += int((area2 < 2e-8).sum())
v, f = load(folder / 'result.mesh.bin')
canonical, remap = np.unique(v, axis=0, return_inverse=True)
faces = remap[f]
rows = np.concatenate((faces[:, 0], faces[:, 1], faces[:, 2]))
cols = np.concatenate((faces[:, 1], faces[:, 2], faces[:, 0]))
graph = coo_matrix((np.ones(len(rows), np.uint8), (rows, cols)), shape=(len(canonical), len(canonical))).tocsr()
count, labels = connected_components(graph, directed=False)
face_labels = labels[faces[:, 0]]
volumes = np.einsum('ij,ij->i', canonical[faces[:, 0]], np.cross(canonical[faces[:, 1]], canonical[faces[:, 2]])) / 6
shell_volumes = np.bincount(face_labels, weights=volumes, minlength=count)
inside_faces = f[shell_volumes[face_labels] < 0][:, [0, 2, 1]]
ids, inverse = np.unique(inside_faces, return_inverse=True)
inner_v, inner_f = v[ids], inverse.reshape(-1, 3)
save(folder / 'cavity-delivered.mesh.bin', inner_v, inner_f)
nearest, _ = cKDTree(raw_v).query(inner_v, workers=8)
contacts = []
cg = folder / 'cgal-final.json'
if cg.exists():
    for pair in json.loads(cg.read_text()).get('firstPairs', []):
        shared = set(f[pair[0]]) & set(f[pair[1]])
        contacts.append({'faces': pair, 'sharedIndexedVertices': len(shared), 'worldPointsMm': [v[f[i]].tolist() for i in pair]})
report = {
    'rawTriangles': len(raw_f), 'deliveredCavityTriangles': len(inner_f),
    'rawZeroAreaFaces': len(zero_ids), 'rawFacesBelow1e8Mm2': small_count,
    'zeroAreaExamples': [{'face': int(i), 'pointsMm': raw_v[raw_f[i]].tolist()} for i in zero_ids[:64]],
    'rawToDeliveredTriangleReduction': len(raw_f)-len(inner_f),
    'maxDeliveredVertexDistanceToRawVerticesMm': float(nearest.max()),
    'deliveredVerticesNotExactlyInRaw': int((nearest != 0).sum()),
    'conversion': 'Standard Manifold ingest/Boolean only; no smoothing, no Simplify, no explicit vertex movement or face deletion',
    'finalContactExamples': contacts,
}
(folder / 'geometric-failure-locations.json').write_text(json.dumps(report, indent=2))
print(json.dumps({k: val for k, val in report.items() if k not in ('zeroAreaExamples', 'finalContactExamples')}))
