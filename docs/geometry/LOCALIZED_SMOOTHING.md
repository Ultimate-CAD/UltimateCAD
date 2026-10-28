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
Do not treat this checkpoint as a completed .6 release.
