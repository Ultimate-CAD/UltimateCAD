"""Prove delivered cavity keeps every nonzero-area raw oriented triangle."""
import json
import struct
import sys
from pathlib import Path
import numpy as np

folder = Path(sys.argv[1])


def load(name):
    b = (folder / name).read_bytes()
    _, _, pn, tn = struct.unpack_from('<4I', b)
    return np.frombuffer(b, '<f8', pn, 16).reshape(-1, 3), np.frombuffer(b, '<u4', tn, 16+pn*8).reshape(-1, 3)


def keys(f):
    first = np.argmin(f, axis=1)
    rotated = np.take_along_axis(f, (first[:, None]+np.arange(3)) % 3, axis=1)
    return np.unique(np.ascontiguousarray(rotated, dtype='<u8').view('V24').ravel(), return_counts=True)


rv, rf = load('cavity-raw.mesh.bin')
dv, df = load('cavity-delivered.mesh.bin')
_, remap = np.unique(np.concatenate((rv, dv)), axis=0, return_inverse=True)
zero = np.zeros(len(rf), bool)
for start in range(0, len(rf), 100000):
    tri = rv[rf[start:start+100000]]
    zero[start:start+len(tri)] = np.linalg.norm(np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]), axis=1) == 0
rk, rc = keys(remap[:len(rv)][rf[~zero]])
dk, dc = keys(remap[len(rv):][df])
_, ri, di = np.intersect1d(rk, dk, return_indices=True)
common = int(np.minimum(rc[ri], dc[di]).sum())
report = {'rawNonzeroAreaFaces': int((~zero).sum()), 'rawZeroAreaFaceIds': np.flatnonzero(zero).tolist(), 'deliveredFaces': len(df), 'exactOrientedNonzeroFacesPreserved': common, 'pass': common == int((~zero).sum()) == len(df)}
(folder / 'exact-cavity-face-preservation.json').write_text(json.dumps(report, indent=2))
print(json.dumps({k: v for k, v in report.items() if k != 'rawZeroAreaFaceIds'}))
assert report['pass'], 'Conversion changed meaningful cavity triangles'
