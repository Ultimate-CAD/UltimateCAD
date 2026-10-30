# Native geometry helper (development)

C++20, Windows x64. Build with CMake 3.24+ and MSVC x64 (Visual Studio 2026 toolchain here). The helper statically links the C runtime and Manifold; the pinned libigl/Eigen subset is header-only. No CUDA or development installation is required to run the compiled executable. Builds initially fetch pinned sources; repeat builds can use CMake source overrides offline.

```powershell
cmake -S native/geometry -B .codex-run/adaptive10/build -G "Visual Studio 18 2026" -A x64
cmake --build .codex-run/adaptive10/build --config Release --parallel 8
```

Dependencies: Manifold 3.5.4 (`ce50d78021d64507f89e8c9fc2c2e51018117857`, Apache-2.0), libigl 2.6.0 (`40e7900ccbd767f1f360e0eb10f0f1a6432e0993`, MPL-2.0 used headers), Eigen 3.4.0 (`3147391d946bb4b6c68edd901f2add6ac1f31f8c`, MPL-2.0 core). Eigen's optional unsupported modules and libigl's GPL/CGAL modules are not used. Package their notices and corresponding source before release. Upstream licenses apply even if use is currently private. MSVC static runtime redistribution terms also apply to the built binary.

## Protocol v1

Little-endian request: 48-byte header; u32 magic LLG1, version 1, coordinate count, triangle-index count; f64 wall, sampled-error target, optional initial pitch (0 automatic); u32 flags (0 adaptive, 1 dense diagnostic), reserved 0. Follow with f64 coordinates and u32 indices. All lengths/settings/indices/coordinates are validated. No caller filesystem paths cross the renderer boundary; the broker owns temporary request/result paths.

Result: 16-byte header (u32 LLR1 magic, version, coordinate count, index count), f64 coordinates, u32 indices. Bounded JSON statistics go to stdout, progress/errors to stderr. Source and result arrays cross process boundaries by copying. The caller owns received arrays; helper exit releases all native geometry/index state. Cancellation kills this one helper; no persistent native cache yet.

Prototype supports closed inward cavities only. Other modes retain WASM. Existing source exterior is retained through the same Manifold subtraction; cavity triangulation can differ because libigl uses angle-weighted pseudonormal signing. Final float32 export still needs manufacturing validation. Adaptive vs native dense mode should be byte-identical: only provably inactive blocks bypass exact queries. This is sparse query acceleration, not a fully sparse voxel allocator.
