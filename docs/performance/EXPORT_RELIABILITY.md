# High-precision manufacturing export reliability

Status: complete. Release 1.114.0-ultimate.11 passes focused and packaged acceptance.

## Preserved baseline

Source baseline `0568f52a652fc2599584288204b6df9456bb4087`, runtime `8decfb88690cb3072c9daed2a9c7dfcbad8b6377`, release 1.114.0-ultimate.10. Complete release copied to `.codex-run/preserved-ultimate10` before changes. Installer SHA-256 `244534824d92c4bd4496804800881b6496031bc7697cced22b42a0f0ba0750f3`. Branch `codex/precision-export-reliability`; working installed app and original projects are untouched.

## Reproduction and stage trace

Native Ø80 × 6 mm plate, Ø12 central hole, six Ø6 holes on Ø50 PCD; cutters extend beyond the plate. Constructed through the actual `buildGroupedShapeFromSelection` Group operation, retaining native children. Viewport Group uses a mesh Boolean; Precision Studio separately rebuilds the retained native children as an exact OCCT `cutAll` body. No imported STL or organic hollowing is involved.

Ordinary High (3,076 triangles), Ultra (3,912), and Custom 0.001 mm/1 degree (23,096) pass this fixture on .10. High plus 1 mm maximum edge length creates 353,884 triangles and reproduces the block: topology valid, zero boundary/non-manifold/winding/degenerate defects, one reported intersection. Analytic tessellation and aspect improvement both pass before subdivision; subdivided float64 and final float32 variants are falsely flagged. Artifacts: `.codex-run/export11/repro-1793615328208`.

Captured float32 triangle IDs 4361 / 4369 have no shared vertices. Both triangles are exactly coplanar and their XY projections are strictly disjoint. `.codex-run/export11/intersection-proof.json` records all coordinates, robust 3D orientations (all zero), and an independent exact BigInt separating-axis witness after lossless scaling by 2^24. A triangle edge has own-side determinant -34824668577792; all opposite triangle vertices have determinants 69649337155584, 139298674311168, 104474005733376. Their intersection has no positive extent; it is empty.

The installed three-mesh-bvh `ExtendedTriangle.intersectsTriangle` reports true. Its normalized floating plane calculations produce distances [0, 0, 7.105427357601002e-15] on mathematically coplanar points. Its 1e-15 near-zero threshold fails to recognize coplanarity, sending the pair through the noncoplanar intersection-line calculation. The manufacturing predicate delegates all pairs without shared vertices to this method. The BVH broad phase and export-blocking gate are behaving correctly; the narrow-phase result is wrong for this captured pair. No geometry movement, repair, increased epsilon, or disabling of checks is justified.

OCCT reports a valid 10-face body with volume π × 1510 × 6 mm³. Saved BREP, face hashes, adjacency, and nearest parent-triangle provenance map both false-hit triangles to the same cylindrical face. The same-face observation is diagnostic only: the fix never exempts same-face pairs. The separately captured F64 subdivision false hit rules out STL float32 conversion as the initiating cause. Captures with face provenance: `.codex-run/export11/repro-1793615872878`.

## Correction and coverage

Only the unreliable unshared-triangle narrow phase changes. `robustTriangleIntersection.ts` uses the existing `robust-predicates` adaptive exact-sign orientations, projected separation and inclusive edge/triangle contacts. It does not construct rounded plane intersections or introduce a distance epsilon. Legitimate shared-simplex handling remains in `triangleSharedContact.ts`; crossing or overlap beyond a shared edge/vertex is still a defect. Degenerate inputs retain the legacy fallback and remain separately blocked by the mandatory topology gate.

After removing the first false hit, the 353,884-triangle fixture needs 5,677,947 candidate pairs to finish. The old fixed five-million budget could not complete. Coverage now scales as max(5 million, min(50 million, triangle count × 32)), with the existing 30-second bound retained. Reports expose both bounds. Exhausting either still leaves the result incomplete and blocks print-ready status; candidate pairs are streamed rather than accumulated.

## Fidelity and focused validation

All four baseline float32 preview geometry SHA-256 hashes are unchanged (`tests/fixtures/seven-hole-plate-baseline.json`). No mesh coordinates, dimensions, topology, source project records, tessellation tolerances or repair settings were changed by the fix. These are the existing sampled fidelity measurements, not certified global Hausdorff bounds:

| Settings | Triangles | Sampled analytic deviation mm | Sampled normal deviation degrees | Total reported deviation budget mm |
| --- | ---: | ---: | ---: | ---: |
| High | 3,076 | 0.0124339624998 | 0.660050940482 | 0.0124339625035 |
| Ultra | 3,912 | 0.00250163805070 | 0.619253484648 | 0.00250163805549 |
| Custom 0.001 mm / 1 degree | 23,096 | 0.000381469726563 | 0.0872684680556 | 0.000381470178573 |
| High + 1 mm edge maximum | 353,884 | 0.0124339624998 | 0.660050940482 | 0.0124359277066 |

High/Ultra/Custom and returning to High export STL and 3MF successfully. Changing the group width invalidates cached geometry; restoring it recovers the original hash. Independent STL/3MF decoding checks exact-coordinate closed edge and vertex topology. Flush cutters, translations, scaling, and rotated native groups pass. Intersecting closed tetrahedra remain blocked in both formats, before and after subdivision. Shared-edge, shared-vertex, coplanar overlap/disjointness and nonadjacent contact tests pass; 12,000 seeded comparisons use an independent test-only BigInt SAT oracle for unshared nondegenerate triangles.

Focused results: 13 unit tests passed (five files); 17 integration tests passed, three existing optional tests skipped (two files); application TypeScript check passed. Worker cancellation/timeouts and resource-budget regressions are included. Logs: `.codex-run/export11/focused.log`, `integration.log`, `typecheck-final.log`. Captures: `.codex-run/export11/verified-1793616906027`; refined STL generation/validation took 8.27 s in that run, with unchanged geometry and complete contact coverage. Timings are observations, not performance guarantees. No expensive organic hollowing benchmark was rerun.

## Limits

The captured defect is proven to originate in the mesh contact predicate; this is not a claim that every possible analytic B-rep or every high-density tessellation is valid. OCCT BRepCheck validity is not a full self-interference proof. Actual file-coordinate manufacturing checks remain mandatory. Very large/dense cases can still reach the bounded validation limits and remain unverified. Existing sampled fidelity and wall-thickness estimates retain their previous limitations. No exact geometry, Boolean kernel, organic hollowing, or project serialization code was modified.

## Packaged acceptance and delivery

Runtime source commit: `cbbdeb2f16b735f63f1d777109174c9cf3e9c2b8`. Reproduction checkpoint: `b3514a8788fe1039e9a7473f9ac18805978ec30d`. A final verification commit contains only harness acceptance refinements and this documentation. Branch: `codex/precision-export-reliability`; no push or installation over the working release.

`node desktop/build-ultimate.mjs` completed a full optimized build, production type checking, source/legal staging and NSIS packaging. Log: `.codex-run/export11/windows-build.log`. The dedicated `desktop/validate-export-reliability.mjs` launches the packaged executable using an isolated profile, System32-only PATH and the application's native network restriction. Final results: **13 named checks passed, zero errors**, artifacts `.codex-run/export11/packaged-1793617770339`, log `packaged-after-final.log`. High → Ultra → Custom (High + 1 mm edge limit) → High exports in both formats independently reimport with strict closed topology, consistent winding, no degenerate/duplicate faces, connected vertex fans and positive volume. The whole saved project JSON remains identical through settings changes. Two closed intersecting tetrahedra remain blocked, with the actual export buttons disabled, in both formats.

Packaged Custom STL: 353,884 triangles, 5,677,947 candidate pairs, complete coverage, zero intersections, **7.395 s**. 3MF: same triangle count, 5,676,472 candidate pairs, complete coverage, zero intersections, **7.497 s**. Reimported volumes: 28,451.679020894262 mm³ (STL), 28,451.67912837968 mm³ (3MF). These are tessellated volumes, not the exact B-rep volume. High/Ultra/repeated-High binary STL bytes and decoded 3MF model XML are identical between the captured .10 and .11 packages (`packaged-fidelity-comparison.json`). The previously blocked Custom geometry hash is unchanged in the engine regression. No manufacturing repair was enabled.

The .10 packaged baseline reproduces the precise false pair in both formats (`packaged-1793617490830/custom-edge.*.mesh-report.json`). Earlier harness attempts exposed two verification-only issues: imports close the export dialog, and local AdGuard injects HTTP request attempts. The final harness reopens the dialog and requires both native denial-log evidence and failed request events for every incidental external request. Two AdGuard attempts report `net::ERR_BLOCKED_BY_CLIENT`; none succeeded. The explicit external fetch probe also fails. No app network policy was changed.

The three optional skipped integration cases require a saved smoothing project, a stress-benchmark opt-in, or the older defective organic fixture. They are outside this analytic-export fix. No organic cavity was recomputed. The installer was built but not installed; acceptance ran from the packaged executable, preserving the installed baseline.

Deliverables (absolute paths):

- Executable: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\win-unpacked\Layerling Ultimate.exe` — 249,797,632 bytes; SHA-256 `8fceb508864549131b2f8ce509cc2fadbdcee3f798e534413708676a3affd886`.
- Installer: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\Layerling-Ultimate-OpenSCAD-Setup-x64.exe` — 256,383,702 bytes; SHA-256 `13b659acf685bb6aa5c2fcf98aaf00b445ef27ad15027dca2cc205b3e070c649`.
- Rollback package: `C:\Users\Justin\layerling-desktop\.codex-run\preserved-ultimate10` (original installer checksum verified again after implementation).

## Upstream research

- [OCCT meshing guide](https://occt3d.com/dev/doc/overview/html/occt_user_guides__mesh.html): edge discretization is shared across face boundaries and cached triangulation depends on meshing parameters. Inspect actual tessellation/encoding rather than assuming a valid B-rep guarantees an arbitrary mesh is intersection-free.
- [OCCT BRepAlgoAPI_Check](https://occt3d.com/dev/doc/refman/html/class_b_rep_algo_a_p_i___check.html) distinguishes topological validity, small edges and self-interference. The exposed occt-wasm `isValid` is not a substitute for an unavailable full self-interference check.
- [CGAL intersection API](https://doc.cgal.org/latest/Polygon_mesh_processing/group__PMP__intersection__grp.html) and [implementation](https://github.com/CGAL/cgal/blob/main/Polygon_mesh_processing/include/CGAL/Polygon_mesh_processing/self_intersections.h) distinguish legitimate shared topology from overlapping/intersecting faces. Shared topology must not exempt overlap beyond that simplex. No new CGAL runtime dependency is planned; the project already includes adaptive exact-sign `robust-predicates`.
