"""Independent analytic cone check; bounded whole-triangle offset error, no repair.

Only valid for the hash-pinned 512-sided dense cone, wall=2 mm. Ideal circular
cone differs by <= facet sagitta + conservative float32 vertex rounding. Lattice
subtriangles have diameter <= longest triangle edge/n; signed distance is
1-Lipschitz, giving a conservative bound between sampled lattice positions.
"""
import hashlib
import json
import struct
import sys
import time
from pathlib import Path
import numpy as np

started = time.perf_counter()
request, mesh_file, report_file = map(Path, sys.argv[1:4])
assert hashlib.sha256(request.read_bytes()).hexdigest() == 'f86d7b3637b832f14fa151f407b6d16e6ed723910b231d9a41ee97ab813a7fda'
data = mesh_file.read_bytes()
magic, version, pn, tn = struct.unpack_from('<4I', data)
assert magic == 0x31524C4C and version == 1
vertices = np.frombuffer(data, '<f8', pn, 16).reshape(-1, 3)
faces = np.frombuffer(data, '<u4', tn, 16 + pn * 8).reshape(-1, 3)
assert np.isfinite(vertices).all()
source_bound = 20 * (1 - np.cos(np.pi / 512)) + 0.00002
wall, allowance = 2.0, 0.1


def distance(points):
    r = np.hypot(points[:, 0], points[:, 2])
    y = points[:, 1]
    t = np.clip(((r - 20) * -20 + (y + 40) * 80) / 6800, 0, 1)
    side = np.hypot(r - (20 - 20 * t), y - (-40 + 80 * t))
    base = np.hypot(r - np.clip(r, 0, 20), y + 40)
    inside = (y >= -40) & (y <= 40) & (r <= (40 - y) / 4)
    return np.minimum(side, base) * np.where(inside, 1, -1)


worst_error, worst_bound, worst_point = 0.0, 0.0, None
unproven, rejected, checked_points, highest_n = 0, 0, 0, 0
for start in range(0, len(faces), 10000):
    tri = vertices[faces[start:start + 10000]]
    lengths = np.stack([np.linalg.norm(tri[:, j] - tri[:, (j+1) % 3], axis=1) for j in range(3)], axis=1).max(axis=1)
    active = np.arange(len(tri))
    for n in (2, 4, 8, 16, 32, 64):
        if not len(active):
            break
        highest_n = max(highest_n, n)
        selected = tri[active]
        errors = np.zeros(len(active))
        for i in range(n + 1):
            for j in range(n + 1 - i):
                p = selected[:, 0] + (selected[:, 1] - selected[:, 0]) * (i / n) + (selected[:, 2] - selected[:, 0]) * (j / n)
                e = np.abs(distance(p) - wall)
                checked_points += len(p)
                k = int(np.argmax(e))
                if e[k] > worst_error:
                    worst_error, worst_point = float(e[k]), p[k].tolist()
                errors = np.maximum(errors, e)
        bound = errors + source_bound + lengths[active] / n
        passed = bound <= allowance
        certainly_bad = errors - source_bound > allowance
        rejected += int(certainly_bad.sum())
        finished = passed | certainly_bad
        if finished.any():
            worst_bound = max(worst_bound, float(bound[finished].max()))
        active = active[~finished]
    unproven += len(active)
    if len(active):
        worst_bound = max(worst_bound, float(bound[~finished].max()))

report = {
    'durationMs': (time.perf_counter() - started) * 1000,
    'meshSha256': hashlib.sha256(data).hexdigest(), 'triangles': len(faces),
    'reference': 'independent analytic circular cone; bounded difference from hash-pinned 512-sided float32 source',
    'sourceSurfaceDistanceBoundMm': float(source_bound),
    'sampledMaxOffsetErrorMm': worst_error, 'worstSamplePointMm': worst_point,
    'wholeTriangleOffsetErrorUpperBoundMm': worst_bound,
    'requestedOffsetErrorMm': allowance, 'certainlyRejectedTriangles': rejected,
    'unprovenTriangles': unproven, 'samplePoints': checked_points, 'largestLatticeSubdivision': highest_n,
    'boundedAccuracyPass': rejected == 0 and unproven == 0 and worst_bound <= allowance,
    'scope': 'distance-to-source offset error over emitted cavity triangles; not a global bidirectional Hausdorff or printability certificate',
}
report_file.write_text(json.dumps(report, indent=2))
print(json.dumps(report))
sys.exit(0 if report['boundedAccuracyPass'] else 2)
