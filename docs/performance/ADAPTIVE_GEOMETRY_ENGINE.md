# Ultimate .10 adaptive geometry engineering checkpoint

Status: investigation and native prototype in progress; not a production release.

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
