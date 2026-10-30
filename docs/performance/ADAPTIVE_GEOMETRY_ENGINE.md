# Ultimate .10 adaptive geometry engineering checkpoint

Status: native integration development checkpoint; final packaged verification pending. Not yet a production release.

## Baseline and preservation

Working source starts at b98ed228 (the .9.1 personal theme patch, geometry unchanged from .9). Known-good .9 runtime is 62d9dfad, verification commit 100ae650. The .9 installer, executable, sources and evidence remain in `.codex-run/preserved-ultimate9`; installer SHA-256 is `0324013dd00ce7c17d7711f80a982009163869d66930ba19da89df75ef0db7f4`. The .9.1 package is separately preserved in `.codex-run/preserved-ultimate9-theme`. Local development branch: `codex/adaptive-native-geometry`. No installed application or user projects are replaced.

## Spatial-domain investigation

`meshHollow.ts` uses independently padded source AABB axes, not a diagonal-derived cube. Each refinement halves pitch, and large domains use overlapping slabs. The actual Manifold 3.5.4 `src/sdf.cpp` stores sampled values in a power-of-two encoded index array; its allocation can exceed the logical cell product substantially. It traverses the encoded grid and retains near-surface vertices in a separate sparse table. Thus sparse output does not mean sparse distance sampling or sparse voxel storage.

The dense-input diagnostic is a literal `indices.length / 3 > 1_000_000` guard, not a measured allocation failure. This must be replaced only alongside a defensible resource model and reduced copies, not by blindly increasing a threshold.

No Stanford_Bunny.stl or identified cone source exists in repository fixtures or retained `.codex-run` assets. The supplied Bunny measurements cannot currently be attributed to a program. Their diagonal/pitch grid reporting differs from this engine, so they are external observations, not a matched Layerling baseline. No personal folders were searched.

Existing preserved organic benchmark (`.codex-run/overnight-hollow/optimized-sah-result.json`) reports 55,036,917 distance queries, 151,289 ms total, 4,812 source / 171,914 result triangles. It is historical evidence, not a fresh .10 measurement. Existing .9 finishing benchmarks concern opening an already-hollow body, not this SDF generation.

## Research direction

First prototype: native C++20 isolated helper, existing Apache-2.0 Manifold 3.5.4 extraction/Booleans, libigl 2.6.0 MPL-2.0 AABB and angle-weighted pseudonormals, Eigen 3.4.0 MPL-2.0. Validate closed oriented source before pseudonormal signing; do not use it as a repair for arbitrary soups. Preserve the TypeScript/WASM path. Binary transport must be versioned, bounded and validated. Native transport is copying across processes, not zero-copy.

OpenVDB's mesh-to-volume implementation supports signed narrow bands and interior flood filling, but introduces TBB and other build/runtime dependencies. Embree's official closest-point example still implements triangle-distance callbacks; it is not a complete signed-distance method. Compare smaller native reuse before adding either stack. See official [OpenVDB implementation](https://www.openvdb.org/documentation/doxygen/MeshToVolume_8h.html), [Embree example](https://github.com/RenderKit/embree/blob/master/tutorials/closest_point/closest_point_device.cpp), [libigl signed-distance implementation](https://github.com/libigl/libigl/blob/v2.6.0/include/igl/signed_distance.cpp).

No CUDA dependency or analytic reconstruction is introduced at this checkpoint. Accuracy remains a sampled offset error, never a certified Hausdorff or half-pitch bound.

## Measured CPU implementation checkpoint

Fresh WASM organic baseline: `.codex-run/overnight-hollow/adaptive10-baseline-result.json`, 155,354.5 ms, 55,036,917 queries, process max RSS 1,678,696 KiB. Native serial adaptive: `.codex-run/adaptive10/organic-native-1/results.json`, 34,755.3 ms including broker transport, 13,402,595 exact queries, helper peak working set 1,191,673,856 bytes. Mesh payloads (excluding different transport headers) are byte-identical SHA-256 `70df62958e8a1383c352ea0e35f2101e363f84de1d50bed553f086fd998f2578`. The baseline used the inspector profiler; native timing did not, so profiling overhead is part of this preliminary comparison.

Native oneTBB 2022.3.0 sweep (end-to-end ms): 1 thread 35,711.0; 4 threads 10,959.0; 8 threads 7,603.1; 16 threads 7,360.0. Eight selected rather than using all logical CPUs. Thread scheduling affects triangulation; final sampled deviation versus the WASM result was 0.006878 mm forward / 0.005971 mm reverse, not a global bound. All variants achieved 0.092865 mm sampled offset error against a 0.1 mm target. Both directions of deviation were measured with ~601,699 samples. The serial adaptive block guard uses 1-Lipschitz distance bounds plus two cell diagonals; every tetrahedron capable of crossing the offset surface uses exact queries. Native dense vs adaptive sphere/cylinder output was byte-identical at one thread.

Native dense cone reproduction: 1,048,576 triangles, 25,227,360-byte request; 118,155 ms serial end-to-end; 1,130,358 result triangles; 0.080170 mm sampled offset error; helper peak 1,064,022,016 bytes. Original user cone remains unavailable. This test clears the previous hard input cutoff through the native backend, not a raised WASM limit.

The sampler accelerates sparse queries but still uses Manifold's dense per-slab voxel storage. No 40–60% memory reduction claim is established. Helper-only native working set and whole Node/WASM RSS have different process scopes; parent transport memory must be included before asserting a whole-workflow saving. Native memory is constrained by an 8 GiB Windows Job Object and a conservative source/topology estimate, with bounded grid work and transport. Jobs run one at a time, timeout after ten minutes, and cancellation terminates the helper. A parent-liveness monitor prevents orphan computation after host failure. Immutable source index/normals are reused across refinement passes; no persistent native BVH cache yet.

Preliminary export audit: `.codex-run/adaptive10/manufacturing-1793348097937`. Native raw organic output retains the existing numeric slivers; it is not declared print-ready. Precision Studio blocks invalid raw export and offers its existing explicit non-destructive repair preview. With that repair selected (0.0001 mm budget, sampled 0.000083606 mm), STL/3MF independently reimport as valid, with zero complete-search intersection hits. This first check used min-wall 0 solely for topology/export comparison; subsequent checks must retain the normal 0.8 mm warning threshold. Manufacturing algorithms and validation gates have not been weakened.

## Matched settings and repeatability

Unprofiled WASM baseline `.codex-run/overnight-hollow/adaptive10-unprofiled-result.json`: **152,858.0 ms**, peak Node/WASM RSS **1,738,432 KiB**, same 55,036,917 queries and byte-identical output as the profiled baseline. Both used the identical retained source, 2 mm inward closed cavity, 0.1 mm sampled-error target, four-pass refinement and the existing extraction/simplification/Boolean checks. Native timings include request packing, helper startup, binary transport and output protocol validation. Final manufacturing/export QA is timed separately for both paths rather than omitted from only the baseline. Geometry algorithms may produce different triangulation under parallel scheduling.

Relative to the unprofiled baseline, the measured eight-thread 7,603.1 ms run is **20.1× faster**. This is an isolated hollowing benchmark, not an application-wide or all-model speedup. The native thread sweep is one sample per count; repeat final workloads and packaged latency are recorded separately. No CPU affinity was forced across heterogeneous cores; no claim of linear 32-thread scaling is made.

Final default-eight-thread cone scaling: 102,400 input → 177,904 result triangles in 10,905.6 ms (helper peak 553,316,352 bytes); 512,000 → 594,546 in 18,676.1 ms (781,864,960 bytes); 1,048,576 → 1,130,360 in **25,908.5 ms** (1,075,929,088 bytes). All achieved ~0.08017 mm sampled offset error. These are deterministic reproduction fixtures, not the unidentified user cone. They share the same conical surface at different redundant subdivisions; no primitive reconstruction or source decimation is used during hollowing.

Exhaustive retained-exterior check for the parallel organic result: all **4,812/4,812 original triangle coordinate triples** occur unchanged in the output. This establishes zero coordinate change for those preserved exterior facets, independently of the cavity's sampled offset measurement. Parallel-versus-serial cavity deviation is reported separately above.

## Algorithm and library evaluation

| Candidate | Source inspection and decision |
|---|---|
| OpenVDB | Official MeshToVolume implementation has signed flood filling, narrow bands, TBB and sparse topology. Promising for a future genuinely sparse voxel allocator. Not integrated or performance-benchmarked here: the smaller query guard already demonstrates a large CPU gain without replacing extraction/topology. No claim that VDB was slower. |
| Embree | Official closest_point example still needs triangle-distance callbacks and a separate sign algorithm. No justified gain over the measured double-precision libigl path yet; not installed. |
| libigl/Eigen | Selected AABB squared-distance and angle-weighted pseudonormal code, after closed-oriented-source validation. Precomputed edge/vertex normals are reused for all passes. MPL-only Eigen compilation enforced. |
| PCO 2024 | Official [implementation](https://github.com/Alan-Leo-Wong/PCO) README/CMake/license inspected at the retained research clone. GPLv3, with CGAL, implicit/indirect predicates, quick-cliques, Eigen, libigl and optional viewer dependencies. Deferred as a distinct accuracy/sharp-feature research project, not rejected on unmeasured performance. |
| Dual Contouring / DualMC | QEF placement and adaptive transition stitching would introduce a new extraction algorithm and validation burden. QEM simplification is a different operation. [DualMC](https://github.com/dominikwodniok/dualmc) is an alternative extractor, not a complete signed-distance/offset engine. Existing Manifold marching tetrahedra retained; no unsupported manifold or crack-free adaptive extraction claims. |
| CGAL | [Package-specific GPL/LGPL/commercial licensing](https://www.cgal.org/license.html) reviewed. Exact predicates/constructions can be useful selectively, but are distinct from Manifold's topological guarantees. No second Boolean kernel added. |
| oneTBB | Selected 2022.3.0, measured 1/4/8/16 scaling; eight-thread cap. Static-library risk is contained in the isolated helper, which shares no TBB ABI with the editor or other libraries. |
| CUDA/OptiX/NanoVDB | No pilot shipped. NanoVDB's [official FAQ](https://www.openvdb.org/documentation/doxygen/NanoVDB_FAQ.html) describes static tree topology; it does not itself supply this complete mesh-offset pipeline. RT cores do not automatically implement nearest-triangle signed distance. CPU now meets the demonstrated latency goal; .11 should profile sparse storage and remaining query cost before taking GPU dependency/transfer/numerical risk. |

## Integration, ownership and safeguards

Desktop `layerlingGeometry` preload exposes bounded binary jobs and cancellation only. Main-process IPC accepts the editor's own main frame, uses a fixed bundled executable, creates private job directories and owns their cleanup. A helper crash or timeout rejects that job and leaves the editor/source/history intact. Closing the app kills active helpers; owner-PID monitoring also handles abrupt host death. The result is committed only through the existing object/project fingerprint check, so stale replies cannot replace changed geometry.

Protocol v1 uses little-endian f64 coordinates/u32 indices with explicit counts/settings/thread limits, exact byte-length checks and finite/index checks. This is copying binary transport, not zero-copy. The broker validates result buffers without making temporary decoded array copies. Native source/topology preflight and 8 GiB process cap remain conservative estimates/limits, not certified peak forecasts. Invalid source topology, impossible cavity, accuracy failure and excessive resource requests fail with diagnostics. The old WASM safety guard remains in the compatibility path; it has not simply been raised.

Only closed inward imported-mesh cavities use native CPU automatically. Open-side and outward operations retain WASM; the mesh Hollow panel also offers explicit Compatibility/WASM selection. Selected compatibility mode and native result provenance persist in existing reversible feature records. OCCT/STEP, SCAD, precision settings, renderer, .9 finishing and project formats are preserved. No analytic cone fitting, unknown surface reconstruction, silent decimation, global minimum-thickness certificate or general self-intersection repair was introduced.

## Reproduction and release discipline

Native C++ build, protocol and dependency pins: `native/geometry/README.md`; staging: `node desktop/stage-native-geometry.mjs`. The staging script checks Git pins and packages each upstream license plus exact corresponding source archives. Windows x64 MSVC `/MT` helper imports only OS runtime dependencies in the audited PE. Native arrays and BVHs are process-owned and released when the job exits; no persistent cross-job cache/zero-copy claim.

Focused checks: `npx vitest run --config tests/vitest.e2e.config.ts tests/e2e/adaptiveNativeGeometry.e2e.ts tests/e2e/nativeGeometryTransport.e2e.ts tests/e2e/meshHollow.e2e.ts --reporter=dot`. Benchmark: `node scripts/benchmark-native-geometry.mjs <unique-label> [dense-cone|cone-100k|cone-500k|source.stl]`; labels prevent artifact overwrite. Optional `LAYERLING_NATIVE_THREADS=1|4|8|16` records an explicit thread sweep. Native cached manufacturing QA uses `LAYERLING_NATIVE_MESH_QA=<result.mesh.bin>` with `tests/e2e/adaptiveManufacturing.e2e.ts`; it never reruns hollowing.

Local checkpoints so far: `a3063e13` preserved baseline/research; `229962da` implemented native CPU/broker/UI integration checkpoint. Final runtime/evidence commits and exact installer paths are recorded only after packaged checks succeed. Rollback: run `.codex-run/preserved-ultimate9/win-unpacked/Layerling Ultimate.exe` or its preserved installer; the installed working release is not replaced by development packaging.

## Final core verification before packaging

Typecheck passes; 29 focused unit regressions passed (two unrelated opt-in cases skipped), plus 10 native/WASM integration checks (one optional retained fixture skipped). Cases cover sphere/cylinder agreement, concave notches, thin additions, disconnected cavities, invalid open sources/coordinates/protocol lengths, immediate and active cancellation, timeout, forced helper termination followed by restart. Explicit WASM selection is available without removing its original safeguards.

Million-triangle final export evidence: `.codex-run/adaptive10/manufacturing-1793348916124`. Both explicit repair exports reimport with zero boundary/non-manifold/degenerate/duplicate defects and complete zero-hit self-intersection searches. Repair sampled deviation is 0.000097014 mm against its 0.0001 mm allowance. Normal 0.8 mm minimum-wall checks retain an acute/thin-region warning, so **ready remains false**. This is a reviewed export, not a certified printable cone. The full QA completed in 201.4 s but exceeded the test harness's original 180 s timer after writing all results; the harness is now budgeted for 600 s for this optional stress case. `nativeManufacturingArtifacts.e2e.ts` independently reimports those saved outputs, verifies the normal threshold and warning flags, and passes without rerunning the expensive repair.

Packaged application validation is still pending at this source checkpoint. No final .10 installer is claimed ready yet.
