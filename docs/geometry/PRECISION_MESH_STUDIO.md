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

- [ ] Independent analytic export tessellation and measured mesh refinement.
- [ ] Background precision export with quality controls and repair preview.
- [ ] Manufacturing report, explicit limitations and file round-trip checks.
- [ ] Focused regressions, packaged UI validation and private Windows release.
