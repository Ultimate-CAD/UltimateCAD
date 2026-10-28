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
brush interaction and final release acceptance are pending packaged validation.
