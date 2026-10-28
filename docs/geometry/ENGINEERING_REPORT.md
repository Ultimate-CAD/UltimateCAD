# Precision edge and shell engineering

Private Windows workstation. Baseline: 7e2cf9ad. Branch: codex/precision-edge-shell.

## Root cause and implementation

The 4000-triangle guard protected a genuine quadratic algorithm, not a GPU or hardware
limit. occt-wasm 5.8.0's edgeToFaceMap iterates every shape edge, every face, and each
face's boundary edges. The replacement visits each face boundary once, builds a hash
adjacency map, and matches the legacy map including cylinder seam deduplication.
Plane normals, face types and areas are reused during one topology collection; curved
face normals are still sampled at the edge. A 128 MiB/four-entry LRU retains reconstructed
mesh B-Reps. Exact profiles now use a memory allowance instead of the old 700-segment
fallback to display triangles.

Mesh preparation reconstructs coplanar regions before importing/sewing individual STL
triangles. Collinear outline points are removed within 0.000001 mm; fitting displacement
including vertex welding stays within 0.002 mm. Construction temporaries are released.
Volume agreement, kernel validity and an actual solid are checked before accepting the
fast path. Non-planar/failed fitting retains the existing STL sewing/healing route.
The old 6000-triangle exclusion from planar fitting and UI/MCP count-only rejection are
removed. The remaining 4000 value controls optional display-mesh fallback payloads only.

## Representation and shelling

Native analytic primitives, profiles, thread/spring/gear/Gridfinity constructions, imported
STEP and stored B-Rep take existing exact OCCT paths, independent of display density.
Hollowing uses OCCT thick solids for openings; sealed cavities use an offset and Boolean
subtraction. New outward walls offset outside the original solid, which becomes the
cavity. Direction and reconstruction tolerance are editable in the UI and through MCP,
persist in feature/history metadata, and survive LYL export/import and Undo/Redo.
New precise operations use the requested tolerance without silently trying coarser values;
they reject disconnected/non-solid results. Legacy feature reconstruction retains its
previous compound/fallback behavior. Canceling a shell now terminates the worker and
rejects pending requests before they can commit geometry.

Mesh-only inputs remain faceted polyhedra. They are not recovered analytic CAD surfaces.
The UI states the planar fitting allowance and source limitation. There is no new voxel/SDF
approximation. Highly concave or high-curvature offsets may fail; originals and history stay
available. Precise mode can reject older pocket-extension results that consist of multiple
solids. Reconstruction tolerance is not a certified minimum-clearance measurement.

## Measurements

Generated sphere facets, adjacency stage only; each size ran in an independent Node process:

| Facets | Old adjacency | New adjacency | RSS after new map |
| ---: | ---: | ---: | ---: |
| 4000 | 4546.5 ms | 12.5 ms | 142.1 MiB |
| 14760 | 68231.6 ms | 31.6 ms | 184.3 MiB |
| 20000 | not rerun | 39.3 ms | 200.2 MiB |
| 50000 | not rerun | 83.4 ms | 308.2 MiB |
| 100000 | not rerun | 170.2 ms | 397.3 MiB |

These timings exclude import, sewing, preview and final operations. See topology-benchmark.json
for raw stages and source pin. The old packaged application was separately checked and
rejected an imported mesh of exactly 14772 triangles with its original 4000 guard.

Subdivided boxes at 3888/14772/20172/50700/101568 triangles all reconstructed to six CAD
faces/twelve edges, then passed fillet, chamfer and closed-shell checks. See dense-benchmark.json
for combined durations and measured process peak RSS. A 20736-triangle faceted cylinder
passed rim treatments, independent mesh-volume and boundary-dimension checks; concave
geometry with a through passage preserved its volume. These are generated representatives,
not the user's unavailable original 14772-triangle file.

The comfortable starting range is 20000 genuinely faceted triangles, with 50000–100000
available for measured workloads. Planar display meshes above 100000 can be much cheaper
than a smaller curved mesh. Exact solids should be judged by CAD topology, not triangles.
The isolated worker has an estimated 1 GiB working budget (4096 bytes per input facet),
separate 128 MiB cache budget, recoverable memory faults and termination on cancellation.
Preparation is bounded at ten minutes; edge previews allow two minutes, shell requests three.

## Verification and limitations

Targeted unit/LYL/SCAD compatibility checks: 136 tests passed; 43 STL/LYL checks passed
after the export correction. Targeted real-kernel,
mesh, shell, STEP, tessellation and native SCAD checks: 88 tests passed. TypeScript passed.
Packaged acceptance: 16 geometry checks and 22 OpenSCAD checks passed; both processes
exited 0 with graceful shutdown. Includes actual 14772-triangle chamfer, 20172-triangle
fillet, edge/hollow cancellation on a curved mesh with unchanged source hash, Undo/Redo,
outward hollowing, source/parameter compatibility, LYL close/reopen and zero renderer errors.
The direction/tolerance UI produced a 24x24x24 mm shell from a 20 mm native box at 2 mm wall.

The kernel's default non-adaptive volume integral overestimated the faceted cylinder rim
treatment by approximately 0.26%; independent signed-tetrahedron mesh volume confirmed
material removal and unchanged bounds. Do not treat that query as a high-precision physical
volume measurement for many small curved faces. No kernel/toolchain upgrade was attempted.
No full scene feature-history or geometric constraint solver is introduced by this work.

Packaged validation caught sixteen exactly zero-area seam triangles in the outward shell's
STL. Those facets contributed zero volume but produced apparent valence-1/4 edges.
STL encoding now omits only exactly collapsed facets at final float32 precision. It does
not weld gaps, cap openings, or remove nonzero-area detail. Independent Manifold validation
of the original file confirmed a closed, correctly oriented cavity after the same cleanup.

Sources inspected: [occt-wasm v5.8.0 source](https://github.com/andymai/occt-wasm/tree/ce0e6da47ea43b7994fb2b6275643e04cb36fe5a)
and [OCCT thick-solid documentation](https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_thick_solid.html).
OCCT documents limitations in offset self-intersection handling; invalid results are refused.

## Local release

Version 1.114.0-ultimate.2. Implementation commit fa5fd1f1; STL correction/package source
08359c11. Final validator/documentation checkpoint does not change application code.
Installer: dist/ultimate/windows/Layerling-Ultimate-OpenSCAD-Setup-x64.exe.
SHA256: a8491fb6dbb319b928214c720ca7cb6859f7e1c94061846322c85d59d5540e46.
NSIS archive CRC/decompression integrity passed. Packaged executable was tested; the installer
was not run over any existing installation. Detailed run IDs, timings and lifecycle events are
in release-validation.json and the two validation directories beside the installer.
Final manufacturing STL: 8408 triangles, volume 11225.455293 mm3, zero unmatched edges.
Original Desktop setup/portable hashes are unchanged. Previous Ultimate installer is preserved
at .codex-run/preserved-ultimate-scad; no user projects, public uploads or Git remotes changed.

Main changed files: cadEdgeTopology.ts, cadMeshSolid.ts, cadMeshBudget.ts, cadPlanarMesh.ts,
cadModifier.worker.ts, cadModifierRuntime.ts, cadProfileExtrusion.ts, cadShell.ts, stlExport.ts;
LayerlingEditor.tsx, ShellPanel.tsx, CAD/project types, MCP schemas/timeouts, Ultimate build
metadata and desktop/validate-geometry.mjs. Focused unit/e2e tests and this checkpoint accompany them.
