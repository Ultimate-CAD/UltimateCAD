# Ultimate .6 localized mesh smoothing

Branch: codex/precision-local-smoothing. Rollback: checkpoint-ultimate5-c3eb86dc;
complete .5 packaged release copied to .codex-run/preserved-ultimate5.

Core: indexed adjacency, fixed open boundaries and zero-weight vertices,
quintic brush falloff, weighted Taubin lambda 0.5 / mu -0.53 pairs. Strength
and iteration bounds are checked. Indices and faces are never modified.
Triangle inversion/collapse and topology changes reject the operation.
This reduces shrinkage; it does not guarantee constant volume. Displacement
and before/after signed volume are measured. Self-intersection checking is
required separately before accepting a preview as safe.

Source: [Taubin's original paper](https://graphics.stanford.edu/courses/cs468-01-fall/Papers/taubin-smoothing.pdf).

Core checkpoint: two focused tests pass, including an open cylindrical collar,
fixed surroundings, determinism and non-manifold refusal. UI, worker isolation,
persistence acceptance, manufacturing regression and packaging remain pending.
Do not treat that checkpoint as a completed .6 release.

## Integration checkpoint

The editor now offers Smooth Mesh on one unlocked imported mesh without exact
or parametric/deformation ownership. Its tool panel has a separate rotatable
mesh preview, a radius in physical millimeters, add/subtract painting with
quintic falloff, strength/iteration controls, Preview, Apply and Cancel.
The preview displays selection weights, maximum/RMS displacement and signed
volume change. Apply uses the normal single commitShapes history transaction.
No document edits occur before Apply. Unselected raw soup coordinates are copied
directly rather than multiplied/divided through a size conversion.

An isolated worker caches adjacency and spatial buckets once per session.
Iteration work updates selected vertices and incident faces. Source and preview
undergo existing manufacturing topology and bounded surface checks; intersecting
or unverified surfaces are refused, never repaired. Intentional open boundaries
stay pinned. Imported triangle soup is indexed by exact coordinate equality,
without a proximity tolerance; ambiguous coincident/non-manifold contacts are
rejected rather than joined. Indices and triangle count remain unchanged.
Cancel/unmount terminate the worker; previews have a 120-second timeout.

Focused verification: TypeScript, 70 geometry/history/LYL/STL unit tests and
19 manufacturing/export integration tests pass (two opt-in benchmarks skipped).
The closed 2,016-triangle collar has max displacement 0.413428 mm, RMS 0.172968 mm,
volume 6759.971759 -> 6767.070587 mm3 (+0.1050%), valid topology and an independently
reimported manifold STL. A 102,912-triangle closed collar core benchmark takes
1,040 ms at 383 MiB process RSS, selecting 15,104 vertices. This excludes the
preview self-intersection check. Reports are in .codex-run/smoothing-*-result.json.

Dense tessellations diffuse less for the same iteration count; this tool does not
reconstruct a reference surface or promise volume preservation. Unverified
self-intersection checks block the operation. Undo/Redo, actual LYL readback,
brush interaction and final release acceptance were subsequently verified below.

Packaged acceptance caught a shared manufacturing-validator false positive:
two coplanar collar facets occupying y=15..16 and y=17..18 were reported as
intersecting by the approximate triangle predicate. A strict triangle AABB
separation check now rejects provably disjoint pairs before that predicate.
Touching and overlapping bounds still receive the complete original checks.
The regression retains a true-overlap case; this does not relax manifold or
surface validation. The smoothing worker message protocol also has a direct
init/paint/preview test. Preview is disabled after failed source initialization.
Seventy-two focused unit tests pass after this correction.

## Final packaged acceptance

Ultimate **1.114.0-ultimate.6** is built from
**507cb5ce1c3b0be441f5fbe458a0b45562d3e38f**. All **36 packaged checks** pass:
three smoothing workflows, eleven precision/export workflows and twenty-two
OpenSCAD compatibility checks, with zero renderer errors. Profiles are isolated,
PATH contains only System32 and external network requests are blocked.

The smoothing acceptance paints, subtracts weights, rotates to another side,
adds selection and previews real geometry. Cancel closes the isolated worker
and leaves the saved source unchanged. Apply preserves object identity and
2,016 triangles. Undo/Redo restore the expected coordinate arrays; a renamed,
distinct-ID LYL checkpoint forces actual source readback rather than selecting
an already-open database project. The first painted patch measures maximum
displacement **0.10683 mm**, RMS **0.02407 mm**, volume change **+0.1155 mm3**.
The preview screenshot was visually inspected.

The saved, applied LYL additionally passes Precision Mesh Studio's full mesh
QA pipeline and independently reimports as a valid **2,016-triangle STL**, with
no export repair. This is an additional focused integration test, alongside the
nineteen earlier manufacturing/export regressions. Normal manufacturing checks
and warnings remain enabled; an open mesh is never labeled watertight.

The existing organic source fixture (4,812 triangles) also passes worker
initialization, localized painting, smoothing and source/result surface checks.
A conservative 0.2-strength/3-iteration patch moves 50 selected vertices by up
to **0.006279 mm**, RMS **0.001554 mm**, with volume
**85465.347531 -> 85465.378184 mm3**. Topology remains valid. No hollowing run
was repeated. Detailed timing is in .codex-run/smoothing-organic-result.json.

Core checkpoint: **56cce9e3**. Integrated tool: **c58ad880**. Validated production
correction: **507cb5ce**. Later commits contain acceptance tests/documentation;
they do not change packaged production code. All work is committed locally;
no publication/push or replacement of the installed .5 application was performed.

## Verified deliverables and recovery

- Executable: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\win-unpacked\Layerling Ultimate.exe`.
  SHA256: `f7902f13f681cf175f829097ac44db829c2552c701528c76838f073a91a13df4`.
- Installer: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\Layerling-Ultimate-OpenSCAD-Setup-x64.exe`.
  Size: **212,686,607 bytes**; SHA256:
  `f7bb453ab14be650e5740d1c058f0d35a20755a0c4680e16ddeb285d95105a5b`.
- App acceptance: `dist/ultimate/windows/smoothing-validation-interactions/results.json`;
  preview: `smoothing-preview.png` in that directory.
- Compatibility: `dist/ultimate/windows/smoothing-precision-validation/results.json`
  and `dist/ultimate/windows/smoothing-scad-validation/results.json`.
- Manufacturing readback: `.codex-run/smoothing-manufacturing/packaged-smoothed.stl`
  and `packaged-smoothed-report.json` in that directory.
- Source archive/provenance: `dist/ultimate/windows/sources/Layerling-Ultimate-Source.zip`
  and `dist/ultimate/windows/release-metadata.json`.
- Rollback: `.codex-run/preserved-ultimate5` and tag
  `checkpoint-ultimate5-c3eb86dc`. Both .5 executable/installer hashes were verified
  unchanged. The .6 installer was built; acceptance runs the packaged unpacked
  application, without installing over the existing working release.

## Practical limits

The brush is a tool-local geometry view, with right-button orbit and middle-button
pan. Selection weights live only in the tool session; Apply stores the modified
mesh and its Undo snapshot, while Cancel discards the selection. There is no
subdivision, reconstruction, automatic repair, or promise of constant volume.
Dense tessellations need more iterations or repeated applications for a wider
blend. Open boundary vertices are pinned. Exact/parametric/deformed bodies must
remain under their own modeling representation and are excluded from this tool.
Very complex source/preview surfaces can exceed the existing bounded intersection
check; they are refused rather than treated as validated. The 100k benchmark is
a core timing and does not certify interactive performance for millions of faces.
