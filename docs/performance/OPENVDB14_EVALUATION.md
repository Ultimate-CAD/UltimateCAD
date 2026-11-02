# OpenVDB 14 isolated evaluation

Status: prototype implemented; **production integration rejected for the measured variants**. This is not a validated .14 desktop release. Keep the packaged .13 native/WASM engines and rollback. Campaign record: `docs/roadmap/ULTIMATE_MASTER_ROADMAP.md`.

Follow-up isolated offset/dilation comparison: `OPENVDB_OFFSET_DILATION_EXPERIMENT.md`. The original coordinate adapter is correct for its zero-origin uniform grid. New fixed-pitch negative-domain sweeping reaches a faster, fully checked .100 mm result, but increases measured error and memory; production integration remains rejected. Do not replace this historical experiment's figures with those from the distinct follow-up.

## Source and implementation

Official latest [OpenVDB 14.0.0](https://github.com/AcademySoftwareFoundation/openvdb/releases/tag/v14.0.0), released 2026-10-29, independently checked through GitHub release API. Codeload ZIP SHA-256 `d53508b64e50eabd8c01fb62310f2d55a2ef00475972a6b14e69ec0a6d6d05d1`. Apache-2.0 main license, relicensing note and vendored compression notices retained under `docs/research/openvdb14/licenses`.

Inspected actual `MeshToVolume.h`, `VolumeToMesh.h`, `LevelSetFilter.h`, `LevelSetRebuild.h`, `NullInterrupter.h` and upstream CMake. [Dependencies](https://www.openvdb.org/documentation/doxygen/dependencies.html), [build reference](https://www.openvdb.org/documentation/doxygen/build.html). MSVC 19.51, C++20 application, static CRT/core, existing pinned TBB 2022.3.0. OpenVDB core no longer requires Boost; optional Zlib/Zstd/Imath disabled. No system SDK or package installation. Rebuild commands and source pin checks: `native/experiments/openvdb14/{README.md,build.ps1}`.

The experimental preprocessor path replaces only cavity construction. A source mesh adapter supplies index-space points to `meshToVolume<FloatGrid>`, using isotropic mm transform and exterior/interior bands of 3 and ceil(wall/pitch)+3 voxels. Negative-inside `-wall` is extracted by `volumeToMesh` at zero adaptivity, quads triangulated, winding converted to Manifold positive-volume convention. The source solid stays separate. Existing dominant cavity selection, float32 conditioning, exact-distance sampling, source-minus-cavity Boolean and error rejection remain. Sparse hierarchy/TBB operations are upstream, not a new language or SDF implementation.

Dense logical sample counts are reported for comparison, not allocated. The experiment removes only the dense-storage work cap; identical 8 GiB native process job and 600 s runner deadline remain. Cancellation kills the child process, including non-interruptible extraction, and discards its result. No change to the production broker, native/WASM selection, desktop build or project storage. No active-region refinement policy or GPU integration claimed; pitch refinement is the existing bounded four-pass loop.

## Identical dense-cone comparison

Three.js fixture 1,048,576 source triangles; wall 2 mm, requested sampled offset error 0.1 mm, same source ingestion, default 8-thread native limit. Every request exactly hashes to `f86d7b3637b832f14fa151f407b6d16e6ed723910b231d9a41ee97ab813a7fda`; preserved request files allow reuse. Fresh original helper compared on this workstation; .10 historical results retained, not overwritten. Observations are individual runs, not statistical confidence intervals.

| Variant | Native / runner ms | Peak process RSS bytes | Sampled offset error mm | Output triangles | Complete contact verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| Existing native | 23,798.8 / 23,951.5 | 1,076,408,320 | 0.080170 | 1,082,636 | Fresh app exhaustive and CGAL zero; source retained |
| OpenVDB, cavity simplify error/4 | 9,373.6 / 9,503.7 | 1,145,962,496 | 0.064153 | 1,053,592 | **Invalid**, app witness and CGAL 3 crossing pairs |
| OpenVDB, no cavity simplification | 111,360.7 / 111,554.0 | 1,478,627,328 | 0.053564 | 1,962,216 | Valid, app exhaustive zero hits and CGAL zero |

Thus the fast variant cannot be accepted, while the validated-surface variant is ~4.68 times slower and ~37% higher peak RSS than fresh native. The sparse grid itself peaks at 64,546,996 bytes / 10,814,091 active voxels / 28,525 leaves; **small grid storage does not imply lower aggregate memory**. Conversion ~3.54 s and extraction ~0.55 s are not end-to-end performance. Full unsimplified cavity remeasurement dominates. Peak private commit 1,493,397,504 bytes; neither this nor grid memUsage is a measured allocation-event peak. Full allocator tracing remains unimplemented and is not falsely reported as complete.

Artifacts `.codex-run/sparse14/{dense-cone-native-comparison,dense-cone-vdb,dense-cone-vdb-unsimplified}` contain request/results/stats/output meshes. `*-qa/dense-manufacturing-qa.json` records explicit verdicts. Independent CGAL results are in each variant's `cgal.json`; raw topology passes even for the simplified invalid case. CGAL pairs 1052715/1052782, 1052713/1052782 and 1052715/1052783 are real cavity contacts, not exterior/source intersections or permitted shared-simplex contact. Omitting simplification removes these witnesses, but this does not prove all OpenVDB simplification strategies unsafe or establish the full internal simplifier root cause. No validator threshold was relaxed.

Exact oriented exterior comparison against the native result preserves **all 1,048,576 normalized exterior triangles**, zero changed coordinates/faces/winding, for both variants. Raw incoming seam duplicates are normalized by the inherited native ingest: a direct raw-request triangle comparison differs identically for both existing native and OpenVDB (2,050 seam/cap triangle keys), so raw-input equality is not substituted for the correct normalized-exterior reference. Proof script `verify_exterior.py`; `exterior*.json` artifacts. Offset figures remain sampled, not certified all-points accuracy or Hausdorff bounds. Thin-wall concern keeps manufacturing ready=false even for the valid cone surface.

## Other checks and limitations

- 102,400-triangle cone simplified trial: 3.79 s runner, meets 0.1 mm sampled error; raw audit passes. It is not acceptance evidence for the failing million-triangle variant.
- Saved concave and thin-feature input requests retain SHA-256 `06669efbe7fff6bd22389b3e49ce94b7721426a52e4610559c1cedc64852c76f` and `dc797701af65bbfef5539bd498a4b187b6d1db3e478dbb36afc968621e1b9821`; wall 1 mm / error 0.1 mm. Unsimplified OpenVDB outputs 228 and 460 triangles, sampled errors 0.0957153 and 0.049157 mm. App raw topology/exhaustive contact checks and CGAL all pass, zero hits.
- Real organic source STL SHA `5ff4a090711fe06aa9d5427a5b325ef14e03967409e8f4e433c8860cc1a59bc4`; identical 4,812-triangle request SHA `767cd6adb747a54c046130de1de4b5e3d21d1cda76c3dac8bd9e7949c172c39f`. At 2 mm / 0.1 mm the prototype rejects after four passes: final sampled error **0.213552 mm**, runner 18.922 s. No output committed. Historical native met 0.092865 mm in 7.499 s total; this is historical, not a fresh simultaneous timing comparison. No attempt to loosen accuracy or silently retain a failed surface.
- Actual dense process cancellation at 300 ms records cancelled after 323 ms with no output accepted. Native normal-path control target produces byte-identical concave/thin meshes to the preserved original helper; hashes/logs `.codex-run/sparse14/control-regression`.
- Stanford Bunny source is absent. No Bunny result, full allocator tracing, aggregate memory reduction, physical-print claim or packaged OpenVDB acceptance. STL/3MF acceptance remains the independently validated .13 production suite; experimental valid cone was independently reimported from native protocol and checked, not delivered as a new manufacturing release.

Decision: retain validated native CPU and WASM. B's isolated investigation has useful negative findings; additional refinement/simplification research and missing allocator metrics are deferred. No .14 installer is produced merely to relabel an unaccepted prototype. Next campaign phase can evaluate a GPU pilot against the **validated native CPU**, not against this rejected approximation.
