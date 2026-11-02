# Ultimate .13 — dense surface certification

Status: implementation and independent fixture verification complete; Windows release acceptance pending. Campaign state: `docs/roadmap/ULTIMATE_MASTER_ROADMAP.md`.

## Imported placement and encoding diagnosis

Full packaged testing found a second, distinct case: the original cached STL is valid, and direct import exactly matches the captured LYL source-position hash. Its local mesh and exact translated world mesh remain valid. At ordinary imported placement (x=10, z=-10), float32 STL encoding merges seven unique vertices: 541,322 → 541,315, introducing 14 degenerate faces, 14 non-manifold edges and seven winding mismatches. This is real encoding loss, not a false-positive intersection detector, an importer/LYL loss, or an invalid original artifact. The STL copy remains blocked.

The report now measures maximum encoding displacement over **all** vertices, compares pre-encoding topology when float32 output is invalid, and explains this loss with an actionable 3MF/placement warning. The full vertex displacement bound also conservatively participates in the reported deviation budget. It does not rebase, move, simplify or repair the model automatically. A small translated-tetrahedron regression proves that a valid precise source can require 3MF instead of STL at its chosen placement.

The exact imported-world mesh and actual full-precision 3MF both independently pass complete CGAL checks with zero intersections (1,569.3 / 1,538.0 ms, ~191 MB checker peak). An independent raw duplicated-index witness confirms all 14 collapsed STL triangles; the first is source face 1,058,154 with two identical corners at (2.6693215370178223,16.741928100585938,-10.334883689880371). Evidence `.codex-run/certification13/import-encoding`, `cgal-import-world.json`, `cgal-import-3mf.json`, `float32-collapse-witness.json`. Source STL and captured LYL hashes remain unchanged. The actual 3MF independently reimports closed/valid with all 1,082,636 triangles; its wall concern still keeps readiness false.

The large captured-project trace passed in 62.2 s. It is an explicit opt-in regression (`LAYERLING_DENSE_IMPORT_ENCODING=1`, with `LAYERLING_IMPORT_ENCODING_STL`/`LAYERLING_IMPORT_ENCODING_LYL` paths and optional output directory); a missing fixture fails an opted-in run. The fast translated-tetrahedron test runs unconditionally. Routine integration after the encoding diagnostic: 23 passed, three unchanged optional cases skipped; TypeScript passed. This does not disable or weaken any existing test.

## Baseline, provenance and verdict

Started clean at .12 verification `2257c653dcce67c129b2362be5db161f2bc96ed2`, runtime `b3ad46924c662be462fe471b9b231dace2f3a58c`; branch `codex/manufacturing-certification-13`. Full .12 rollback `.codex-run/preserved-ultimate12`, installer SHA-256 `f41cb0da2e10d4f6f5f15111b189865dc44194ece1abfff49dc398131db78f2e`. Installed application/profile untouched.

Input is the saved .10 **dense-cone fixture output**, not an original user-supplied cone file. Native result `.codex-run/adaptive10/cone-delivery-final/result.mesh.bin`: 1,082,636 triangles / 541,322 vertices; SHA-256 `c4c0a187f0a1f7c76d5a6d3010f6ab66312925ea9e73b19db56fc70a79034f29`. Its constructor recorded 1,048,576 input triangles, 22.08 s total / 21.91 s native computation. Those are historical measurements; **no SDF/cavity construction was rerun**. Encoded outputs: `.codex-run/adaptive10/manufacturing-1793350350780/result.stl` and `result.3mf`.

.10 stopped at 5,000,001 candidates, correctly withholding readiness. A new .12 baseline, already carrying .11's robust predicates and mesh-scaled budget, completes: native 9,882,895 candidates / 0 intersections / 4.112 s surface check; STL and 3MF 9,876,182 candidates / 0 intersections / 3.953 and 3.989 s. Raw closed edge/vertex topology, winding and degenerate checks pass. The old report was incomplete evidence, not proof of an intersecting cone or justification for reconstructing the cavity.

The complete **surface topology/contact verdict is verified-valid**. Separate sampled normal-ray wall 0.028632 mm is below the selected 0.8 mm concern threshold. **Manufacturing ready remains false.** Acute-tip sampling is not a global wall-minimum certificate or proof that nominal thickness is wrong everywhere. No global Hausdorff, global thickness, physical printability or calibrated FDM-strength guarantee is claimed. All source files/hashes and geometry fingerprints remain unchanged; no repair, remeshing, simplification or normal perturbation was used.

## Implementation and bounds

- Retain three-mesh-bvh and .11 predicates; use its public range callbacks to avoid per-pair Vector3 copies/identity transforms and reject symmetric leaf ranges early. Keep exact AABB rejection, robust shared-simplex checks and degenerate fallback/topology rejection. No contact tolerance or encoded coordinate changes.
- Add scoped `verified-valid`, `verified-invalid`, `inconclusive`, `cancelled`, `failed` outcomes. One intersection witness establishes invalidity without enumerating every hit; `exhaustive` identifies a finished no-hit search. Worker cancellation preserves source; resource/deadline exhaustion stays inconclusive; internal errors failed; retry creates a fresh worker.
- Preserve defaults: 30 s search bound, mesh-scaled 5–50 million candidate cap and isolated 15-minute export-worker bound. Diagnostic controls alter work limits only, never tolerances. Deadlines are checked during broad-phase rejection too; incomplete never becomes PASS.
- Report BVH/bounds/traversal times, unique broad pairs, strict AABB rejects, actual narrow tests, contact categories, leaf/symmetry counts, limits and stop reason. Per-contact timing is opt-in and adds clock overhead.
- Fix inherited i18n scan through translated finishing timeout/precision-label keys; complete catalogues receive the new messages. No tests or language-completeness flags are weakened. English automation labels remain identical.

## Measurements

Isolated cached STL, same coordinates and 9,876,182 narrow candidates; observations, not statistical speed guarantees:

| Stage | .12 triangle callback | .13 range callback |
| --- | ---: | ---: |
| Exact canonical indexing | 759.6 ms | 761.3 ms |
| Raw topology audit | 1,411.4 ms | 1,465.0 ms |
| Surface check incl. BVH/thickness | 3,953.2 ms | 3,244.2 ms |
| New BVH / exact bounds / traversal | — | 348.0 / 92.9 / 2,748.3 ms |
| Entire test peak process RSS | 1,685,995,520 bytes | 1,675,132,928 bytes |

Observed surface elapsed-time reduction ~18%; no aggregate memory-reduction claim. Process RSS includes decoding, hashing, indexing and audit. Opt-in pre-range profiling: 37,767,514 unique broad pairs; 27,891,332 AABB rejects; 3,077,856 unshared, 5,174,372 shared-vertex, 1,623,954 shared-edge, 0 duplicate-face contacts. Narrow clock accumulation 1,319.5 ms; instrumented traversal 4,151.1 ms includes profiling overhead. Parallel scheduling was not introduced because one isolated worker finishes well inside bounds; no parallel/GPU speed claim. Packaged transport/cancel/failure observations are pending. Evidence `.codex-run/certification13/{stl,3mf,profile-stl,range-stl}`.

## Independent reference and research

CGAL 6.2.1 EPIK/PMP complete sequential self-intersection search, isolated Boost 1.88 headers, documented GMP/MPFR-disabled fallback. No host install or app runtime dependency. Source, flags, pins and commands: `tests/reference/dense-si-cgal/README.md`; original licenses: `docs/research/dense-si-reference/licenses`.

All three exact native/STL/3MF meshes complete with zero intersections: native 2,008.8 ms / peak 191,336,448 bytes; STL 1,986.4 ms / 191,311,872 bytes; 3MF 1,976.3 ms / 191,651,840 bytes. This reference pipeline excludes app STL decoding/index/audit, so it is not an end-to-end product comparison. CGAL exposes no candidate counts; the report says null. Evidence `.codex-run/certification13/cgal-{native,stl,3mf}.json`.

Controls: captured .11 disjoint coplanar pair and legitimate shared edge return 0; crossing triangles return 1; overlapping closed tetrahedra return 3. Application tests also cover shared vertices, coplanar overlap, invalid topology and the seven-hole plate. Sources: [CGAL API](https://doc.cgal.org/latest/Polygon_mesh_processing/group__PMP__intersection__grp.html), [shared-topology implementation](https://github.com/CGAL/cgal/blob/main/Polygon_mesh_processing/include/CGAL/Polygon_mesh_processing/self_intersections.h), [three-mesh-bvh range API](https://github.com/gkjohnson/three-mesh-bvh/blob/master/API.md). No private BVH buffers or replacement tree are used.

## Reproduction and checks

```powershell
$env:LAYERLING_DENSE_QA_FILE=(Resolve-Path '.codex-run/adaptive10/manufacturing-1793350350780/result.stl').Path
$env:LAYERLING_DENSE_QA_DIR=(Join-Path (Get-Location) '.codex-run/certification13/repeat-stl')
$env:LAYERLING_DENSE_REQUIRE_COMPLETE='1'
node node_modules/vitest/vitest.mjs run --config tests/vitest.e2e.config.ts tests/e2e/denseManufacturing13.e2e.ts --reporter=dot
& ./tests/reference/dense-si-cgal/build.ps1
& '.codex-run/certification13/cgal-reference-build/Release/dense-si-cgal-reference.exe' '.codex-run/adaptive10/cone-delivery-final/result.mesh.bin'
```

Prepare the checker dependencies per README first. Require-complete mode fails on incomplete coverage; diagnostic mode records an inconclusive result without certifying it. Geometry/worker tests: 13 passed, including 12,000 seeded comparisons and exact BigInt oracle checks. Full i18n 17 passed, no exclusions. Integration 22 passed / three old optional cases skipped (saved smoothing fixture, stress opt-in, older defective organic fixture). TypeScript passed. Logs `.codex-run/certification13`; packaged acceptance/commits to be appended after validation.
