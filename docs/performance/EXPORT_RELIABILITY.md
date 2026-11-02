# High-precision manufacturing export reliability

Status: root-cause reproduction captured; implementation and packaged acceptance pending.

## Preserved baseline

Source baseline `0568f52a652fc2599584288204b6df9456bb4087`, runtime `8decfb88690cb3072c9daed2a9c7dfcbad8b6377`, release 1.114.0-ultimate.10. Complete release copied to `.codex-run/preserved-ultimate10` before changes. Installer SHA-256 `244534824d92c4bd4496804800881b6496031bc7697cced22b42a0f0ba0750f3`. Branch `codex/precision-export-reliability`; working installed app and original projects are untouched.

## Reproduction and stage trace

Native Ø80 × 6 mm plate, Ø12 central hole, six Ø6 holes on Ø50 PCD; cutters extend beyond the plate. Constructed through the actual `buildGroupedShapeFromSelection` Group operation, retaining native children. Viewport Group uses a mesh Boolean; Precision Studio separately rebuilds the retained native children as an exact OCCT `cutAll` body. No imported STL or organic hollowing is involved.

Ordinary High (3,076 triangles), Ultra (3,912), and Custom 0.001 mm/1 degree (23,096) pass this fixture on .10. High plus 1 mm maximum edge length creates 353,884 triangles and reproduces the block: topology valid, zero boundary/non-manifold/winding/degenerate defects, one reported intersection. Analytic tessellation and aspect improvement both pass before subdivision; subdivided float64 and final float32 variants are falsely flagged. Artifacts: `.codex-run/export11/repro-1793615328208`.

Captured float32 triangle IDs 4361 / 4369 have no shared vertices. Both triangles are exactly coplanar and their XY projections are strictly disjoint. `.codex-run/export11/intersection-proof.json` records all coordinates, robust 3D orientations (all zero), and an independent exact BigInt separating-axis witness after lossless scaling by 2^24. A triangle edge has own-side determinant -34824668577792; all opposite triangle vertices have determinants 69649337155584, 139298674311168, 104474005733376. Their intersection has no positive extent; it is empty.

The installed three-mesh-bvh `ExtendedTriangle.intersectsTriangle` reports true. Its normalized floating plane calculations produce distances [0, 0, 7.105427357601002e-15] on mathematically coplanar points. Its 1e-15 near-zero threshold fails to recognize coplanarity, sending the pair through the noncoplanar intersection-line calculation. The manufacturing predicate delegates all pairs without shared vertices to this method. The BVH broad phase and export-blocking gate are behaving correctly; the narrow-phase result is wrong for this captured pair. No geometry movement, repair, increased epsilon, or disabling of checks is justified.

## Upstream research

- [OCCT meshing guide](https://occt3d.com/dev/doc/overview/html/occt_user_guides__mesh.html): edge discretization is shared across face boundaries and cached triangulation depends on meshing parameters. Inspect actual tessellation/encoding rather than assuming a valid B-rep guarantees an arbitrary mesh is intersection-free.
- [OCCT BRepAlgoAPI_Check](https://occt3d.com/dev/doc/refman/html/class_b_rep_algo_a_p_i___check.html) distinguishes topological validity, small edges and self-interference. The exposed occt-wasm `isValid` is not a substitute for an unavailable full self-interference check.
- [CGAL intersection API](https://doc.cgal.org/latest/Polygon_mesh_processing/group__PMP__intersection__grp.html) and [implementation](https://github.com/CGAL/cgal/blob/main/Polygon_mesh_processing/include/CGAL/Polygon_mesh_processing/self_intersections.h) distinguish legitimate shared topology from overlapping/intersecting faces. Shared topology must not exempt overlap beyond that simplex. No new CGAL runtime dependency is planned; the project already includes adaptive exact-sign `robust-predicates`.
