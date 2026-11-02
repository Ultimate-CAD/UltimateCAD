# Isolated OpenVDB offset versus interior dilation

Completed 2026-11-02. **No production integration.** Fastest fully geometry-validated configuration: 0.10 mm, interior-directed 26-neighbor dilation, one fast-sweeping iteration, extract at -2 mm, zero adaptivity. Full native generation/validation/write takes **18.170 s**, versus the fixed **23.799 s** native baseline, but sampled maximum offset error worsens (0.093405 versus 0.080170 mm), peak RSS rises 44.5%, and output triangles more than double. Fastest tested configuration with lower measured error than native is `LevelSetFilter::offset(+2)` at 0.10 mm: **27.363 s**, 0.050585 mm. None provides the requested speed improvement without accuracy regression. The original native backend, .13 app and installer are unchanged.

## Inspection before implementation

Pinned OpenVDB 14.0.0 source and old experimental adapter inspected before edits. Original `p / pitch` is **correct for a uniform zero-origin transform**, not a demonstrated coordinate bug. The low-level mesh adapter must supply index-space coordinates; the mesher returns world-space points. New code calls `transform.worldToIndex()` explicitly, supporting translated grids without double-transforming output. Four off-origin 10 mm box checks (both methods, zero and translated grid origins) pass native and independent analytic checks at expected world center (17.25, -8.5, 3.75) mm and approximately 6 mm cavity dimensions. Grid phase changes discretization error, not world placement.

Actual API sources: [MeshToVolume](https://github.com/AcademySoftwareFoundation/openvdb/blob/v14.0.0/openvdb/openvdb/tools/MeshToVolume.h), [VolumeToMesh](https://github.com/AcademySoftwareFoundation/openvdb/blob/v14.0.0/openvdb/openvdb/tools/VolumeToMesh.h), [LevelSetFilter](https://github.com/AcademySoftwareFoundation/openvdb/blob/v14.0.0/openvdb/openvdb/tools/LevelSetFilter.h), [FastSweeping](https://github.com/AcademySoftwareFoundation/openvdb/blob/v14.0.0/openvdb/openvdb/tools/FastSweeping.h), [Morphology neighbor definitions](https://github.com/AcademySoftwareFoundation/openvdb/blob/v14.0.0/openvdb/openvdb/tools/Morphology.h).

Both paths start from a three-voxel exterior/interior band. Offset adds +2 mm in world-distance units and tracks its zero surface; its internal CFL step is half a voxel, with PDE level-set tracking, not FastSweeping. Dilation extends the original field inward by ceil(2/pitch) voxel layers using `SWEEP_LESS_THAN_ISOVALUE`; extract the -2 mm surface. It does not move the original zero surface. The measured `initDilate()` then `sweep(1,true)` calls are exactly the operations in the documented `dilateSdf()` wrapper, separated to measure topology initialization and eight-direction sweeping.

## Controlled inputs and resource limits

- Identical preserved 1,048,576-triangle cone request SHA-256 `f86d7b3637b832f14fa151f407b6d16e6ed723910b231d9a41ee97ab813a7fda`; 2 mm wall; 0.1 mm error allowance; same float32 source ingest; eight TBB threads. Saved native baseline 23,798.8272 ms, 1,076,408,320 bytes RSS, sampled error 0.080169677734375 mm.
- Fixed pitches 0.10, 0.075, 0.05, 0.02 mm, no automatic pitch changes. Eight timed trials run sequentially, isolated helper processes, System32-only PATH, 8 GiB process-private-memory limit and 180 s trial deadline. The bound is disclosed, not a claim that workstation RAM is exhausted.
- No smoothing, `Simplify`, cavity conditioning or explicit vertex movement/deletion. Uniform zero-adaptivity quad extraction; split along an orientation-preserving diagonal, prefer the shorter valid diagonal, reverse winding at the Manifold boundary. Keep raw geometry and diagnostic counts. Standard Manifold ingest/Boolean semantics remain observable rather than silently relabeled as raw output.
- Executable used by the matrix preserved at `.codex-run/sparse14-offset/bin/bench-matrix.exe`, SHA-256 `1eccd4e5c176e50def22042c1ff068b505ea66227d2e9ab80e2e4ed9d36d7377`. No app/project or production worker execution was changed.

## Results

Full native time includes source/index preparation, voxelization, method work, polygonization, triangulation, exact source-distance checks, Boolean subtraction and output writing. Independent checks are additional, explicitly shown below. Single observations, not statistical speed guarantees. RSS uses decimal GB; all completed final surfaces have zero boundary/non-manifold edges, non-manifold vertices, winding errors, degenerate/duplicate faces and complete zero intersection searches in both application and CGAL. Thin-wall warning keeps manufacturing `ready=false`.

| Method | Pitch mm | Full native s | Peak RSS GB | Sampled offset error mm | Whole-cavity error upper bound mm | Result triangles | Final integrity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Native baseline | automatic 0.223607 | 23.799 | 1.076 | 0.080170 | not established | 1,082,636 | Valid surface; wall concern |
| Dilation | 0.100 | 18.170 | 1.555 | 0.093405 | 0.099982 | 2,413,774 | Valid surface; wall concern |
| Offset | 0.100 | 27.363 | 1.548 | 0.050585 | 0.099954 | 2,403,980 | Valid surface; wall concern |
| Dilation | 0.075 | 32.447 | 2.189 | 0.073791 | 0.099212 | 3,456,428 | Valid surface; wall concern |
| Offset | 0.075 | 52.752 | 2.054 | 0.034663 | 0.085472 | 3,456,780 | Valid surface; wall concern |
| Dilation | 0.050 | 74.381 | 5.587 | 0.054373 | 0.087485 | 6,466,492 | Valid surface; wall concern |
| Offset | 0.050 | 137.996 | 3.499 | 0.024970 | 0.061127 | 6,472,444 | Valid surface; wall concern |
| Dilation | 0.020 | Failed at 15.841 s runner | 8.448 in diagnostic rerun | unverified | unverified | not produced | Allocation failure; no geometry verdict |
| Offset | 0.020 | Timed out at 180.453 s runner | 4.157 before termination | unverified | unverified | not produced | Incomplete interface tracking; no geometry verdict |

## Exact bottlenecks

Seconds per measured stage; dilation columns are topology initialization / fast sweeping, offset column includes interface tracking and its reinitialization. Dashes mean the other algorithm, not missing profiling.

| Method / pitch | Voxelization | Offset tracking | Dilation init / sweep | Polygonization | Exact distance checks | Active voxels after method |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dilation .100 | 0.816 | — | 0.239 / 1.576 | 0.048 | 12.406 | 18,183,110 |
| Offset .100 | 0.831 | 10.911 | — | 0.030 | 12.497 | 2,915,119 |
| Dilation .075 | 1.113 | — | 0.779 / 4.123 | 0.104 | 22.385 | 41,794,888 |
| Offset .075 | 1.133 | 25.870 | — | 0.059 | 21.911 | 5,203,204 |
| Dilation .050 | 1.856 | — | 2.735 / 15.059 | 0.314 | 47.867 | 132,934,323 |
| Offset .050 | 1.843 | 83.288 | — | 0.115 | 46.767 | 11,659,094 |

For the fastest run, **68.3% is exact distance validation against the original million-triangle source**, not voxelization or polygonization. Removing duplicate shared-edge queries preserves all vertex/edge-midpoint/centroid coverage: 4,095,626 unique sample queries, 2,047,812 duplicate edge queries avoided. Eight-way parallel read-only source queries leave production code untouched. Smaller-pitch offset runs become dominated by repeated CFL tracking; at .050 it takes 83.288 s versus 15.059 s for sweeping. Dilation retains a deep interior band and pays much more memory. Sparse field storage alone is not aggregate process savings.

## Failure locations and independent verification

The first .100 dilation pilot used the API's face-only default stencil. `ceil(wall/pitch)` face-neighbor layers form a Manhattan growth region, insufficient for diagonal normals. It produced a cavity point **(-12.0136032104, -34.9852752686, 12.0136041641) mm** only **1.7040421085 mm** from the source, a 0.2959578915 mm wall error. Independent analytic checking confirms the failure. Switching to 26-neighbor dilation covers the Euclidean depth in every direction while retaining the documented negative-domain sweep. All corrected runs have zero extracted vertices touching an inactive interpolation stencil. No smoothing hides this defect.

Corrected .100 dilation's worst exact source-distance sample is **(-0.0000536051, 31.1560754776, 0.0531101562) mm**, source face 502749, signed inside distance 2.0934049350 mm. Every configuration preserves its own exact witness point, original closest face and closest source point in `accuracy-witness.json`; `stats.json` records sample kind and triangle/vertex/edge ID.

Raw .100 dilation has ten exactly zero-area triangles, one duplicate and nine non-manifold edges after coordinate welding; e.g. face 111932 repeats (-10.8000001907, -38, -2.0999999046) mm. These are preserved as raw evidence, not marked valid. Standard Manifold ingest/Boolean removes precisely those ten zero-area triangles. Exact oriented face comparison proves **every one of the 1,365,198 nonzero-area cavity faces survives unchanged**, with zero vertex displacement; no additional surface is invented. Other completed runs have zero raw degenerate faces. All six preserve all **1,048,576 normalized exterior triangles** exactly, including winding. Full IDs, coordinates and conversion measurements are in `geometric-failure-locations.json` / `exact-cavity-face-preservation.json` for each run.

At .020 dilation, the native exit 0xc0000409 was investigated rather than classified from the exit alone. Local Windows debugger catches the C++ exception during `initDilate`; offline PE/RTTI decoding identifies **std::bad_alloc**. Monitored diagnostic rerun records exactly **8,589,934,592 bytes private commit**, the 8 GiB job limit, and **8,447,709,184 bytes peak RSS**. This is a diagnostic rerun's peak, not invented final statistics for the original aborted run. Details `dilate-002-debug-v3/cpp-exception.json`, `dilate-002-memory-debug/memory-observations.json`. Offset .020 is terminated while tracking; no incomplete result is accepted.

Independent accuracy uses a separate NumPy analytic cone evaluator. The hash-pinned 512-sided source differs from the circular reference by at most facet sagitta plus conservative float32 ingest rounding, 0.000396494348 mm. A barycentric subdivision lattice and the signed-distance 1-Lipschitz bound conservatively cover entire emitted cavity triangles, including between samples. Every completed run proves the 0.1 mm cavity offset allowance in double-precision analysis; no unproven triangles. This is not a formal interval-arithmetic proof, global bidirectional Hausdorff claim or printability certificate. Upper bounds shown above are conservative verification bounds, not estimates of the actual maximum error.

All six final results pass independent CGAL EPIK/PMP exhaustive intersection checks and unchanged application raw topology/contact checks. Whole source and cavity face comparisons pass with zero coordinate movement. For fastest .100 dilation, actual STL and precision 3MF export both retain **2,413,774 triangles**; STL 120,688,784 bytes, 3MF 39,342,907 bytes. Both independently reimport, pass complete application checks and complete CGAL checks with zero hits. Original source bytes remain unchanged. Existing conservative thin-wall concern is retained; nothing is labeled print-ready.

## Complete workflow cost and reproducibility

Post-validation includes analytic bounds, complete application manufacturing QA, CGAL and exact exterior comparison. It excludes debugging and optional raw-defect diagnosis. Native baseline 23.80 s measures native generation only; it does **not** already include these external verification tools. Do not call 18.17 s a complete export workflow or a kernel-only CUDA result. Observed extra check time / generation-plus-check time: dilation .100 **20.436 / 38.606 s**, offset .100 **22.245 / 49.607 s**, dilation .075 **28.485 / 60.932 s**, offset .075 **29.363 / 82.115 s**, dilation .050 **57.604 / 131.985 s**, offset .050 **62.638 / 200.634 s**. Diagnostic and post-validation jobs may overlap; these sums are observed operation costs, not a controlled end-to-end speedup claim. Actual paired STL/3MF serialization and encoding audits add 18.678 s to the fastest run; independent format reimport/contact checks add further time.

Build only target `ultimate-openvdb-offset` in the existing experimental CMake tree. Run `node scripts/run-openvdb-offset-experiment.mjs --label UNIQUE --method dilate --pitch .1` (or `offset`, other tested pitches). It refuses existing directories, preserves traces/source hash, monitors parent ownership and records termination memory. `node scripts/check-openvdb-grid-origin.mjs` runs four coordinate regressions. Helpers `verify_cone_offset.py`, `verify_exterior.py`, `inspect_offset_mesh.py`, `check_cavity_face_preservation.py`, `decode_cpp_exception.py` live under `native/experiments/openvdb14`; summary generator `scripts/summarize-openvdb-offset.py` never promotes missing checks to success. Actual export test `tests/e2e/openVdbOffsetExport.e2e.ts` is opt-in via `LAYERLING_OFFSET_EXPORT_DIR`; all large profiler checks explicitly require complete coverage. Artifact root `.codex-run/sparse14-offset`; machine-readable `summary.json` and per-run `stats.json` / `stages.jsonl` retain all timings, voxel counts, memory and failures.

Decision: retain production native/WASM. The fastest geometry-validated experiment is .100 dilation; the fastest tested accuracy-preserving alternative is .100 offset, which is slower. No tested configuration dominates native on full processing, measured error and memory. No version bump, installer rebuild, project migration or production engine change.
