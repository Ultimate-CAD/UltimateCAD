# Precision Mesh Studio checkpoint

Branch: codex/precision-mesh-studio. Preserved baseline: 165dd53e.

## Integrity checkpoint (before precision export implementation)

The cached private `hollowed-organic.lyl` contains 171,914 triangles, including
143 exactly zero-area triangles and 588 below 1e-8 mm2. The 143 zero-area facets
were already present in its float32 Manifold output, before STL writing. The STL
writer omitted them, leaving 171,771 faces and a three-edge opening. A separate
edge has four incident faces: distinct Manifold topological vertex fans occupy
the same coordinate. Manifold NoError alone does not detect that geometric
singularity after coordinate welding. A 1e-4 rounding grid also merges additional
nearby vertices; exact coordinate welding is used for the format topology audit.
No validation tolerance was relaxed.

Explicit, bounded repair preview in `meshManufacturingRepair.ts` uses native
Manifold simplification at its numerical tolerance and separates coincident,
topologically distinct fans along their own area-weighted normals. It refuses
open/non-manifold inputs that cannot be interpreted by the engine, does not fill
holes or reconstruct missing surfaces, and rejects results that fail strict
coordinate-welded edge, vertex, winding, duplicate and degenerate checks.
This operation is never silently applied by the ordinary STL writer.

Actual cached fixture: 101,674 repaired triangles, 0 boundary edges, 0 non-manifold
edges or vertices, 0 winding mismatches, 0 duplicate or zero-area faces. Eleven
very small nonzero faces remain; small area alone is not a topology defect.
Two surface shells are the outside and the closed cavity, not two material parts.
Volume: 24,237.876187 mm3. Dimensions: 47.577999 x 120.449997 x 39.387001 mm
(editor Y-up). Bidirectional sampled surface deviation: 0.000024018 mm at a
0.0001 mm repair budget. Samples cover vertices, edge midpoints and centroids;
this is not a global Hausdorff certificate. Float32 arithmetic remains a limit.

Verification: three focused tests passed, including an independent STLLoader
reimport and strict coordinate topology audit, followed by Manifold NoError.
Typecheck passed. No SDF regeneration was performed. The source project, project
identity/history and captured artifacts are unchanged. Output and detailed
report are private, ignored artifacts:

- .codex-run/organic-repro/hollowed-organic-manifold-fixed.stl
- .codex-run/organic-repro/manifold-fix-report.json
- .codex-manifold-fix.log

Reproduce from the repository root in PowerShell:

```powershell
$env:LAYERLING_SAVED_ORGANIC='dist/ultimate/windows/organic-validation/hollowed-organic.lyl'
npx.cmd vitest run --config tests/vitest.e2e.config.ts tests/e2e/manufacturingRepair.e2e.ts --reporter=dot
```

## Next implementation

- [x] Independent analytic export tessellation and measured mesh refinement.
- [x] Background precision export with quality controls and repair preview.
- [x] Manufacturing report, explicit limitations and file round-trip checks.
- [ ] Final focused regressions, packaged UI validation and private Windows release.

## Implemented workbench

The STL/3MF export panel now opens Precision Mesh Studio. Standard, High, Ultra
and Custom provide independent surface deviation and angular mesher settings.
Native primitives, supported parametric profiles, stored CAD B-reps and STEP
sources use the STEP exporter's actual exact-body construction and placement.
Analytic faces are sampled at vertices, edge midpoints and centroids, with finer
OCCT passes when needed. Pole/seam edges below 1e-9 mm are stitched in the
tessellation, with movement explicitly reported; the B-rep is never modified.
Angular refinement stops with an unmet-tolerance report if measurements stall,
rather than generating an enormous file without improving the limiting facets.

Mesh inputs support conforming adaptive edge subdivision, coplanar diagonal
optimization for aspect ratio, and optional bounded smoothing that pins sharp
and boundary edges. None of these claims fidelity to an unavailable source
surface. The maximum edge and aspect achieved are reported; feature preservation
takes priority over an unattainable aspect target. Binary STL encoding is
validated at float32 coordinates. Precision 3MF uses exact-coordinate indexing
and round-trip decimal coordinates, avoiding the ordinary exporter's tolerance
weld and decimal rounding.

The isolated export worker handles geometry, validation and encoding, supports
immediate termination, stale-result guards, errors and a 15-minute timeout.
The worker caches exact tessellations and one unchanged validated export up to
256 MiB. Settings or source changes invalidate the result. Canceled jobs never
change objects, IDs, source, undo history or project storage. No hollowing job is
invoked by this pipeline.

The preview is a lightweight sampled wireframe with before/after and rotation.
It includes exact triangle count and encoded size after processing, estimated
working memory, elapsed time, dimensions, volume, units, components/cavity shells,
edge and vertex manifoldness, winding, duplicates, degeneracy, self-intersection
search coverage, sampled wall concerns and a downloadable JSON report.

Malformed topology always blocks export. Detected intersections and unmet
surface/normal tolerances block export too. A skipped or budget-limited surface
check, thin-wall concerns or extra components require explicit review before
export and never receive a print-ready status. The self-intersection search has
a 30-second / 5-million candidate budget, excludes shared-vertex pairs and is not
a global exact proof. Shell containment/orientation is probed with parity rays.
Thickness uses sampled inward normal rays and is not a global minimum thickness
certificate. B-rep normal estimates use closest-surface displacement where it is
above positional noise. All these limits are visible in the report.

## Additional measurements

An additional sliver found by the surface intersection test was resolved by
spending half of the same explicit 0.0001 mm repair budget on simplification.
The world-placed cached organic mesh then exports 92,394 triangles, sampled
repair deviation 0.000083552 mm, 0 topology defects and 0 found intersections
over 3,480,719 non-adjacent candidate tests. One positive outer component and
one negative cavity shell remain. Small and acute regions still produce wall
concerns around 0.000099 mm; these are flagged and require inspection, rather
than being represented as a uniformly printable 2 mm wall.

Analytic sphere comparison (20 mm diameter): 4,754 triangles / 0.0439177 mm sampled
error at coarse settings versus 117,616 / 0.00180974 mm at finer settings. The
normal measurement stalled around 6.97 degrees in the limiting facets; tighter
custom requests are reported unmet. Ultra's 7.5-degree default respects that
observed limitation while tightening surface deviation to 0.005 mm.

Density benchmark: 2,621,440 triangles, 131,072,084-byte STL, 5,778.9 ms conforming
subdivision, 699.5 ms binary encoding and 263.0 ms independent STLLoader reimport.
Tetrahedron volume remained 1,333.333333 mm3. This proves high-density processing
and encoding, not a fidelity improvement from subdivision or an exhaustive
million-triangle self-intersection certificate. Default output budget is
4 million triangles, configurable to 12 million, with transparent estimated
working memory. WASM engine and available JS memory remain practical limits.

Repeated unchanged actual organic export: cold STL 11,387.7 ms versus cached
45.94 ms; cold 3MF 7,679.9 ms versus cached 46.02 ms. Both cached files were
byte-identical. No geometry recomputation or hollowing occurred on cache hits.
The focused release checks passed TypeScript, 26 unit tests, 18 integration
tests (one optional expensive original hollow fixture skipped), the density
benchmark, and an additional defective STL/OBJ export-blocking regression.

Previous Ultimate .3 installer, metadata, checksums and organic artifacts were
copied to `.codex-run/preserved-organic-ultimate3`. Installer SHA256:
81e655cebaa5f8548030c75bf1513f04635ec8fc703345768da954f9cb09a277.
The existing installed application and user profile are unchanged.

## Validation commands

```powershell
npm.cmd run typecheck -- --pretty false
npx.cmd vitest run --config tests/vitest.config.ts tests/unit/precisionExportWorker.test.ts tests/unit/stlExport.test.ts tests/unit/threemfExport.test.ts tests/unit/threemfExportAsync.test.ts tests/unit/meshHollowWorker.test.ts tests/unit/meshHollowSource.test.ts --reporter=dot
$env:LAYERLING_SAVED_ORGANIC='dist/ultimate/windows/organic-validation/hollowed-organic.lyl'
npx.cmd vitest run --config tests/vitest.e2e.config.ts tests/e2e/precisionExport.e2e.ts tests/e2e/manufacturingRepair.e2e.ts tests/e2e/meshHollow.e2e.ts --reporter=dot
$env:LAYERLING_DENSE_EXPORT_BENCH='1'
npx.cmd vitest run --config tests/vitest.e2e.config.ts tests/e2e/precisionDensity.e2e.ts --reporter=dot
npm.cmd run ultimate:release
npm.cmd run ultimate:validate:precision
```

Sources inspected: installed `occt-wasm`, `manifold-3d`, `three-mesh-bvh` and
`fflate` implementations, plus official documentation:
[OCCT meshing](https://occt3d.com/dev/doc/overview/html/occt_user_guides__mesh.html),
[Manifold mesh interchange](https://manifoldcad.org/docs/html/structmanifold_1_1_mesh_g_l_p.html).
