# High Speed Geometry Baseline (pre-optimization)

Recorded 2026-10-29 before geometry optimizations. Profile input: `.codex-run/geometry9/baseline/profile.json`; CPU self samples: `organic-cpu-top.json`, `500k-cpu-top.json`. Reproduced packaged runs: `.codex-run/geometry9/baseline-organic` and `baseline-500k`. The source profile adds opt-in timing wrappers around unchanged .8 algorithms. Packaged runs use the untouched preserved .8 payload.

## Profile summary

| Fixture | Input / output triangles | Geometry | Validation | Source prepare | Preview total | Profile total | Profile worker peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Organic | 92,396 / 89,926 | 541.225 ms | 4,510.344 ms | 346.987 ms | 5,104.453 ms | 5,462.172 ms | 842,888 KiB |
| 500k | 500,000 / 447,000 | 3,176.480 ms | 21,228.170 ms | 2,060.098 ms | 24,608.207 ms | 26,711.986 ms | 2,139,492 KiB |

## Exclusive stage aggregates

Milliseconds. These sum spans by stage and subtract nested child spans; `mesh.topology` excludes its nested `mesh.index` spans. Do not add wrapper totals such as `source.prepare`, `cut.total`, or `validation.total` to these stage rows.

| Stage | Organic | 500k |
|---|---:|---:|
| Surface intersections (all validation passes) | 3,895.1 | 18,284.9 |
| BVH build | 98.0 | 441.1 |
| Thickness sampling | 90.7 | 102.7 |
| Mesh indexing | 290.4 | 1,588.5 |
| Mesh topology, exclusive of nested indexing | 959.4 | 5,744.1 |
| Cut clipping | 15.5 | 95.4 |
| Contour construction | 9.0 | 23.2 |
| Rim triangulation/assembly | 4.9 | 7.2 |
| Rebase and worker packing | 52.4 | 203.5 |

The main weighted costs were intersection checking and topology/indexing. The 500k profile recorded 3,196,569 candidate pairs on the cut surface and 3,196,577 on the encoded surface; both completed with zero self-intersections. Thickness warnings remained visible: 0.000247 mm organic and 0.084203 mm 500k, against the 0.8 mm threshold.

## CPU profile top 10 self samples

Each entry is one profile node, not an aggregate for the named function. Values are self milliseconds. Repeated anonymous entries map to the source location shown.

| Rank | Organic | 500k |
|---:|---|---|
| 1 | 223.223 ms — anonymous, `manufacturingMesh.ts:55` | 1,544.512 ms — garbage collector |
| 2 | 216.482 ms — garbage collector | 1,507.988 ms — `intersectsBeyondSharedContact`, `triangleSharedContact.ts:13` |
| 3 | 115.3 ms — anonymous, `manufacturingMesh.ts:55` | 1,435.8 ms — anonymous, `manufacturingMesh.ts:55` |
| 4 | 112.0 ms — `auditMesh`, `manufacturingMesh.ts:36` | 1,339.9 ms — `intersectsBeyondSharedContact`, `triangleSharedContact.ts:13` |
| 5 | 105.7 ms — anonymous, `manufacturingMesh.ts:55` | 892.2 ms — anonymous, `manufacturingMesh.ts:55` |
| 6 | 85.3 ms — `intersectsBeyondSharedContact`, `triangleSharedContact.ts:13` | 817.3 ms — anonymous, `manufacturingMesh.ts:55` |
| 7 | 68.4 ms — `auditMesh`, `manufacturingMesh.ts:36` | 706.4 ms — `auditMesh`, `manufacturingMesh.ts:36` |
| 8 | 67.4 ms — `auditMesh`, `manufacturingMesh.ts:36` | 688.1 ms — `side`, `triangleSharedContact.ts:11` |
| 9 | 60.7 ms — `intersectsBeyondSharedContact`, `triangleSharedContact.ts:13` | 617.0 ms — `intersectsTriangles`, `meshManufacturingQa.ts:125` |
| 10 | 58.8 ms — `intersectsBeyondSharedContact`, `triangleSharedContact.ts:13` | 507.0 ms — `intersectsTriangles`, `meshManufacturingQa.ts:125` |

## Reproduced packaged run

First uncached worker preview round-trip is measured from `send preview` to `receive preview` in the worker event timeline. Source init is `send init` to `receive ready`.

| Fixture | Source init | First uncached preview RTT | Worker geometry | Worker validation | Peak app working set | Max observed working set | Max private bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Organic | 479.6 ms | 4,701.3 ms | 566.7 ms | 4,090.5 ms | 1,216,624 KiB | 1,109,192 KiB | 1,064,892 KiB |
| 500k | 2,467.5 ms | 25,960.2 ms | 4,500.5 ms | 21,331.9 ms | 3,170,600 KiB | 2,991,036 KiB | 2,984,248 KiB |

Both packaged runs have empty error lists and passed all eight recorded checks: cancel retained the source, apply updated the same object, three undo/redo cycles restored positions, save/reopen preserved identity, thin-wall warnings remained non-print-ready, STL/3MF reimports passed exact-weld audits, and packaged restrictions recorded zero external requests. Export audits showed zero boundary/nonmanifold edges, winding mismatches, degenerate/duplicate faces, and nonmanifold vertices.

## Cost and validation risk ranking

1. **Intersection checking — highest cost; highest validation risk.** It dominates both profiles and includes shared-contact triangle checks. Reported completion and zero-hit results are acceptance evidence; changing semantics could admit invalid intersections or turn a complete result incomplete.
2. **Topology and indexing — second-highest cost; high validation risk.** CPU samples concentrate in mesh indexing/audit and garbage collection, especially at 500k. These stages establish welds, components, winding, degeneracy, and manifold status.
3. **BVH construction — moderate cost; high validation dependency.** Every surface pass builds acceleration used by intersection, containment, and thickness checks.
4. **Thickness sampling — lower cost; high user-facing safety significance.** Both accepted outputs correctly retained a below-threshold warning and remained not print-ready.
5. **Cut clipping, rebase/packing, contours, and rim — lower measured cost; geometry correctness still matters.** Timings are small relative to validation, but the outputs depended on closed, oriented cut contours and valid rim construction.


