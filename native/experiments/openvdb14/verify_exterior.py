"""Exact oriented triangle preservation check. Requires local NumPy; no repair."""
import hashlib
import json
import struct
import sys
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def load(path, request):
    data = Path(path).read_bytes()
    magic, version, pn, tn = struct.unpack_from('<4I', data)
    assert magic == (0x31474C4C if request else 0x31524C4C) and version == 1
    offset = 48 if request else 16
    assert len(data) == offset + pn * 8 + tn * 4
    points = np.frombuffer(data, '<f8', pn, offset).reshape(-1, 3)
    # Same documented float32 input normalization as the native engine.
    if request:
        points = points.astype(np.float32).astype(np.float64)
    faces = np.frombuffer(data, '<u4', tn, offset + pn * 8).reshape(-1, 3)
    return points, faces, hashlib.sha256(data).hexdigest()


def oriented_keys(faces):
    # Rotate, never reverse, so exterior winding must also survive exactly.
    first = np.argmin(faces, axis=1)
    cyclic = np.take_along_axis(faces, (first[:, None] + np.arange(3)) % 3, axis=1)
    packed = np.ascontiguousarray(cyclic, dtype='<u8').view('V24').ravel()
    return np.unique(packed, return_counts=True)


def exterior(points, faces):
    # Weld by exact supplied coordinates; find oriented closed surface shells.
    points, inverse = np.unique(points, axis=0, return_inverse=True)
    faces = inverse[faces]
    rows = np.concatenate((faces[:, 0], faces[:, 1], faces[:, 2]))
    cols = np.concatenate((faces[:, 1], faces[:, 2], faces[:, 0]))
    graph = coo_matrix((np.ones(len(rows), np.uint8), (rows, cols)), shape=(len(points), len(points))).tocsr()
    count, labels = connected_components(graph, directed=False)
    face_labels = labels[faces[:, 0]]
    volumes = np.einsum('ij,ij->i', points[faces[:, 0]], np.cross(points[faces[:, 1]], points[faces[:, 2]])) / 6
    shell_volumes = np.bincount(face_labels, weights=volumes, minlength=count)
    return points, faces[shell_volumes[face_labels] > 0]


source, source_faces, source_sha = load(sys.argv[1], True)
result, result_faces, result_sha = load(sys.argv[2], False)
input_triangle_count, total_result_triangles = len(source_faces), len(result_faces)
reference_sha = None
if len(sys.argv) > 4:
    # Compare with validated native output: its source ingestion/normalization is
    # inherited and differs from raw request seams; cavity shells are excluded.
    source, source_faces, reference_sha = load(sys.argv[4], False)
    source, source_faces = exterior(source, source_faces)
    result, result_faces = exterior(result, result_faces)
_, inverse = np.unique(np.concatenate((source, result)), axis=0, return_inverse=True)
source_keys, source_counts = oriented_keys(inverse[:len(source)][source_faces])
result_keys, result_counts = oriented_keys(inverse[len(source):][result_faces])
_, si, ri = np.intersect1d(source_keys, result_keys, return_indices=True)
preserved = int(np.minimum(source_counts[si], result_counts[ri]).sum())
report = {
    'requestSha256': source_sha, 'resultSha256': result_sha,
    'normalizedExteriorReferenceSha256': reference_sha,
    'requestTriangles': input_triangle_count, 'totalResultTriangles': total_result_triangles,
    'comparedSourceTriangles': len(source_faces), 'comparedResultTriangles': len(result_faces),
    'exactOrientedSourceTrianglesPreserved': preserved,
    'missingOrChangedExteriorTriangles': len(source_faces) - preserved,
    'comparison': 'Exact float32-ingested coordinates and cyclic orientation; no tolerance',
    'sourceFileUnchanged': hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() == source_sha,
    'resultFileUnchanged': hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest() == result_sha,
}
Path(sys.argv[3]).write_text(json.dumps(report, indent=2))
print(json.dumps(report))
assert preserved == len(source_faces), 'Source exterior changed'
assert report['sourceFileUnchanged'] and report['resultFileUnchanged']
