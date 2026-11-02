# Ultimate CAD master development campaign

Private, single-user Windows workstation. No push, publication, cloud runtime, online activation or mandatory external application/MCP dependency. Preserve source/license access and compatibility. Work in release order; only mark a milestone validated after its intended capability and packaged acceptance are demonstrated.

## Verified starting point

- Branch: `codex/manufacturing-certification-13`, starting clean at `2257c653dcce67c129b2362be5db161f2bc96ed2` (validated .12 verification); runtime `b3ad46924c662be462fe471b9b231dace2f3a58c`.
- Brand/release definition: `apps/web/src/config/productBranding.json`, `Ultimate CAD`; .12 at campaign start, .13 is the current unverified release target.
- .12 executable: `dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe`, SHA-256 `d823a9cf2077735d4ce163e51294ebb60cd9a5aaecff13e864db13bac922a251`.
- .12 installer: `dist/ultimate/windows/Ultimate-CAD-Setup-x64.exe`, SHA-256 `f41cb0da2e10d4f6f5f15111b189865dc44194ece1abfff49dc398131db78f2e`.
- Full rollback: `.codex-run/preserved-ultimate12`; installer hash checked before new work. Installed app/profile is untouched.
- Current files/hashes and recorded .12 acceptance independently inspected: 16 branding and 22 OpenSCAD/MCP checks passed, zero recorded errors. Evidence `.codex-run/branding12/packaged-1793625240483/results.json`, `packaged-openscad/results.json`, `docs/desktop/PRIVATE_BRANDING.md`.
- .11 robust-contact implementation and seven-hole plate regression are present (`cbbdeb2f16b735f63f1d777109174c9cf3e9c2b8`, `aba102834cca79629ca8190495ab2d5ed78d7547`). Reports/proofs: `docs/performance/EXPORT_RELIABILITY.md`, `.codex-run/export11`.
- .10 native hollowing is present. Historical hollowing timings are baseline evidence, not a newly run benchmark. The cone remained unready due incomplete self-intersection coverage and a thin-wall concern. Do not equate raw topology success with manufacturing certification.

## Release ledger

| Milestone | Status | Dependency / intended demonstration | Rollback |
| --- | --- | --- | --- |
| A / .13 dense manufacturing certification | implementing | Complete native/STL/3MF contact verdict independently verified; explicit outcomes, range traversal/profiling and translation fix implemented; final package acceptance pending | validated .12 above |
| B / .14 sparse OpenVDB | planned | Isolated Windows native prototype; compare identical inputs/error/topology/exterior constraints with .10 CPU, RSS/allocations/end-to-end time; integrate only measured advantage; native/WASM fallback | latest validated A |
| C / .15 CUDA/OptiX | planned | Isolated pilot against latest validated CPU; include transfers/setup/sign/distance/sync/VRAM/cancellation and numerical error; mandatory CPU fallback; reject unsupported speed claims | latest validated CPU |
| D / .16 constrained Sketcher | planned | Research PlaneGCS/reference FreeCAD when useful; points/lines/circles/arcs and complete initial constraint subset, DOF/conflicts, interactive editing; OCCT/Undo/LYL mounting-plate acceptance offline without FreeCAD | latest validated release |
| E / .17 feature history | planned | Persistent graph, stable IDs, named equations, incremental recomputation; sketch/pad/pocket/revolve/hole/pattern/edge features; tree/errors/suppression/Undo/LYL; explicit topology-reference failures | validated D |
| F / .18 assembly | planned | Independent components/frames, fixed/revolute/slider joints, evaluation/transforms/interference and motion preview; hinge/linkage example; local persistence, no false dynamic-physics claim | validated E |
| G / .19 FEM | planned | Evaluate established local solver; bounded isolated linear-static pipeline with materials/BCs/forces/displacement/stress/convergence and persistence; cantilever analytical verification; no generic FDM strength claim | latest validated geometry |
| H / .20 migration/library | planned | Research authorized Tinkercad exports/account access; otherwise user-supplied exports. Offline bulk STL/OBJ/STEP/LYL, thumbnails/metadata/tags/categories/duplicates/provenance/resumable indexing/batch projects; preserve only real edit history | latest validated persistence |

## A: investigation and implementation record

The .12/.11 implementation already completes the saved cone contact search with its mesh-scaled budget. Historical .10 stopped at 5,000,001 candidates; current native input completes 9,882,895 candidates in 4.11 s. Both encoded artifacts complete 9,876,182 candidates. Thus a new SDF reconstruction or wholesale collision algorithm was unjustified. The 30 s default and 5–50 million mesh-scaled candidate bound remain; explicit resource controls and reasoned outcomes never turn exhaustion into PASS. Precision export remains isolated with a separate 15-minute overall deadline.

Research: [CGAL PMP](https://doc.cgal.org/latest/Polygon_mesh_processing/group__PMP__intersection__grp.html), [CGAL implementation](https://github.com/CGAL/cgal/blob/main/Polygon_mesh_processing/include/CGAL/Polygon_mesh_processing/self_intersections.h), and [three-mesh-bvh public range API](https://github.com/gkjohnson/three-mesh-bvh/blob/master/API.md). The application keeps its established BVH and .11 predicates; public range callbacks remove per-pair Vector3 copying/identity transforms and skip symmetric leaf ranges. Degenerate fallback remains available; exact AABB rejection precedes the coordinate-only predicate. No coordinates, contact tolerances or repair settings change.

Measured isolated STL baseline vs range traversal: surface check 3.953 s → 3.244 s; new BVH build 348 ms, exact bounds 92.9 ms, intersection traversal 2.748 s. Same 37,767,514 unique broad pairs, 9,876,182 narrow contacts and 27,891,332 strict bounds rejects. Opt-in clock profiling measured 1.320 s narrow-phase accumulation before the range optimization (adds instrumentation overhead): 3,077,856 unshared, 5,174,372 shared-vertex, 1,623,954 shared-edge contacts. Entire STL test peak process RSS was ~1.68 GB before and ~1.68 GB after; no aggregate memory-reduction claim. Parallel scheduling was not introduced; single isolated-worker completion is already well inside bounds. End-to-end worker transport/cancel/failure acceptance is pending. No expensive SDF recomputation occurred.

Independent CGAL 6.2.1 EPIK/PMP checker built using isolated Boost 1.88 headers, no GMP/MPFR or host installation; source/build/license details `tests/reference/dense-si-cgal/README.md`, `docs/research/dense-si-reference/licenses`. Full native/STL/3MF checks return zero intersections (~1.98–2.01 s each, ~191 MB checker working set). This is reference-only, not an application dependency; its timing/memory excludes the app's import/index/audit pipeline. CGAL controls reject real crossings and accept the captured .11 disjoint pair/shared-edge contact. Evidence `.codex-run/certification13/cgal-{native,stl,3mf}.json`.

The saved native source is `.codex-run/adaptive10/cone-delivery-final/result.mesh.bin` (1,082,636 output triangles), SHA-256 `c4c0a187f0a1f7c76d5a6d3010f6ab66312925ea9e73b19db56fc70a79034f29`. Final .10 STL/3MF inputs: `manufacturing-1793350350780/result.*`. All hashes/coordinates remain unchanged. Raw topology is valid; complete contact verdict is **verified-valid**. Separate sampled wall 0.028632 mm < selected 0.8 mm remains a concern, so **ready stays false**. This is not a global wall-thickness, Hausdorff or physical printability certificate. The original user cone file is not present; this verdict concerns the saved dense-cone fixture output.

Implementation commits: pending runtime checkpoint. Focused geometry/worker/predicate tests 13 passed; full i18n 17 passed (the inherited static scan is fixed without exclusions); integration 22 passed, three existing optional cases skipped; TypeScript passed. Evidence `.codex-run/certification13/{geometry-focused,i18n-final,integration,typecheck-final}.log`. The seven-hole plate retains .11 geometry fingerprints and both formats; intentional intersecting solids remain blocked. Explicit statuses distinguish verified valid/invalid, inconclusive, cancelled and failed; the surface scope is separate from readiness.

Runtime checkpoint `c4bcc7d7a3e9ce59e98e26d7d652a8b6a2838969` built .13; packaged plate 13/13, branding 16/16 and OpenSCAD/MCP 22/22 passed. The dense packaged flow exposed a genuine format/placement limitation: source import/LYL/exact-world topology stays valid; float32 STL at imported x=10,z=-10 merges seven vertices and creates 14 degenerate faces, whereas full-precision 3MF remains valid and independently CGAL-verified. Additive encoding diagnostics and a small deterministic regression now explain/block that copy without moving or repairing it. Final rebuilt package acceptance is pending. Details `docs/performance/DENSE_MANUFACTURING_CERTIFICATION.md`, artifacts `import-encoding`, `cgal-import-world.json`, `cgal-import-3mf.json`, `float32-collapse-witness.json`.

## Research/dependency records for later releases

B: no OpenVDB version, Windows build, memory advantage or accuracy result established in this campaign. C: no GPU backend, transfer-inclusive speedup or RT-core closest-distance claim established. D/F/G: optional local FreeCAD endpoint is a development reference only; verify real MCP tool execution before relying on it, continue via native APIs if unavailable. E/H: inspect current persistence/library functionality before expanding it; no wholesale rewrite or inferred mesh modeling history.

## Recovery and next executable action

Latest verified packaged commit/build: .12 hashes and paths above. Active work: A final runtime checkpoint and packaged acceptance. Current tests pass as above; dense surface verdict is complete and independently corroborated. Remaining manufacturing issue: sampled thin wall. Three unrelated optional integration fixtures are skipped; none of the new correctness tests is disabled.

Next action: clean runtime commit; `node desktop/build-ultimate.mjs`, then `node desktop/validate-certification.mjs` and version-overridden `desktop/validate-export-reliability.mjs`. Verify dense imported STL, real worker failure/cancel/recovery, saved report scope and genuine defect blocking from the package; preserve .12 installation/rollback. Repeatable CPU/reference commands are in the .13 report and test/reference README. Only after .13 acceptance, begin B's isolated OpenVDB prototype.

At every release boundary: focused tests → relevant integration checks → clean runtime commit → Windows build → isolated offline packaged acceptance → evidence/report/verification commit → preserved rollback. Do not overwrite the installed release. Do not mark an incomplete result PASS or a committed but unverified feature validated.
