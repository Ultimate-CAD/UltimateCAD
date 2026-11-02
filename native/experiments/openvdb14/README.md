# OpenVDB 14 isolated cavity prototype

This standalone experimental executable compares OpenVDB level-set sampling and meshing with the current Manifold `LevelSet` path. It is not wired into the desktop app, release build, or production geometry broker. No performance claim is established by the build alone.

Measured results and integration rejection: `docs/performance/OPENVDB14_EVALUATION.md`. Validated application remains .13. Default experiment retains the generated cavity without tolerance simplification (delivery conditioning still applies). To reproduce the rejected faster variant in a separate build directory, configure `-DSPARSE_CAVITY_SIMPLIFY_DIVISOR=4`; never treat its output as approved because raw topology alone passes.

## Rebuild

Run from the repository root in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File native/experiments/openvdb14/build.ps1
```

The script checks the official codeload archive at `.codex-run/sparse14/deps/openvdb-14.0.0.zip` against SHA-256 `d53508b64e50eabd8c01fb62310f2d55a2ef00475972a6b14e69ec0a6d6d05d1`, requires the extracted 14.x source and existing pinned native/TBB builds, then installs/builds only below `.codex-run/sparse14`. It does not download dependencies, modify host packages, or write to `dist` or the `.13` build directories. Configure, build, and install logs are written under `.codex-run/sparse14/logs`; every native command is checked for a nonzero exit code.

The pinned OpenVDB archive was extracted to `.codex-run/sparse14/deps/openvdb-14.0.0`. TBB is installed from `.codex-run/adaptive10/build/_deps/tbb-build` to `.codex-run/sparse14/deps/tbb-install`. OpenVDB static core installs to `.codex-run/sparse14/deps/openvdb-install`; the isolated executable builds under `.codex-run/sparse14/prototype-build`.

Acquire the development archive only if missing: `Invoke-WebRequest https://codeload.github.com/AcademySoftwareFoundation/openvdb/zip/refs/tags/v14.0.0 -OutFile .codex-run/sparse14/deps/openvdb-14.0.0.zip`; verify the pinned SHA before `Expand-Archive` to that dependency folder. Application operation never downloads it.

Generate without rendering: `node scripts/benchmark-sparse-volume.mjs --label UNIQUE --fixture dense-cone --generate-only`. Run the prototype with `--exe .codex-run/sparse14/prototype-build/Release/ultimate-openvdb14.exe`; default runner executable remains the original CPU helper. `--cancel-after-ms 300` tests actual process cancellation. Every run refuses an existing artifact directory. The original dense request SHA is asserted for default settings. The runner uses a System32-only PATH, 600 s deadline and owner process monitoring; partial output is discarded on cancellation.

Independent exact exterior comparison (local NumPy/SciPy): `python native/experiments/openvdb14/verify_exterior.py REQUEST RESULT REPORT NATIVE_REFERENCE_RESULT`. Positive-volume shells are compared by exact oriented coordinate triangles after each engine's normal ingestion; cavity shells are excluded. Raw input seam changes inherited from native normalization are not misattributed to the new backend. Native defaults have a separate `ultimate-native-control` CMake target for regression checks.

## Geometry notes

- The prototype uses `meshToVolume<FloatGrid>` with an index-space mesh adapter and a uniform voxel transform. OpenVDB's standard signed-distance output is negative inside and positive outside; the inward cavity is the `-wallMm` isosurface. The wrapper `meshToSignedDistanceField` instead accepts world-space points.
- `exBandWidth` and `inBandWidth` are measured in voxels. Choose the interior band wider than `wallMm / voxelPitchMm`, with additional voxels around the extraction crossing. The transform's voxel pitch sets the spatial sampling interval; it is not an accuracy guarantee.
- Extract at isovalue `-wallMm` with `volumeToMesh` and zero adaptivity for the initial comparison. Convert the extracted faces to the triangle mesh protocol, validate the cavity, then reuse the unchanged source-minus-cavity and downstream validation path.
- The source conversion uses float-valued signed distances and a discretized voxel grid. Mesh conversion can renormalize values and remove intersecting voxels. Measure actual cavity offsets against the existing exact `DistanceQuery`; validate topology, float32 delivery, and manufacturing coverage separately.
- `meshToSignedDistanceField` and `levelSetRebuild` accept OpenVDB interrupters. A conversion can return a partial grid when interrupted, so check the cancellation state and discard that result. `volumeToMesh` has no public interrupter parameter; process termination remains the fallback for cancellation during extraction.

## License records

The upstream archive's main `LICENSE` and `RE-LICENSE_NOTE.txt` are retained under `docs/research/openvdb14/licenses`. Vendored compression notices are retained there in `blosc/`, `blosc/lz4/`, and `blosc/LICENSES/` using the original filenames. The OpenVDB source archive, static library, or derived binaries must retain applicable OpenVDB and third-party notices.
