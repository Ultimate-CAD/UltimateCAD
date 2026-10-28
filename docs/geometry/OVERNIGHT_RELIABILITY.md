# Overnight geometry performance and reliability pass

Baseline: a51ac809, Ultimate 1.114.0-ultimate.4.
Branch: codex/overnight-geometry-reliability.
Recovery tag: checkpoint-ultimate4-a51ac809.
The complete previous unpacked app, installer, release metadata and acceptance
artifacts are preserved under .codex-run/preserved-ultimate4. Source projects,
captured hollowing fixtures and precision defaults remain unchanged.

## Work and acceptance

- [x] Verify clean baseline; create local branch and recovery checkpoint.
- [x] Profile one controlled original-model hollowing run at 2 mm / 0.1 mm.
- [x] Implement and measure a conservative distance-query optimization.
- [x] Compare identical inputs, output geometry, sampled error and repaired topology.
- [ ] Fix shared-vertex intersection gaps, cache memory and budget preflight issues.
- [ ] Exercise cutter diagnostics, double-precision 3MF QA and worker recovery.
- [ ] Run focused tests, selected high-density checks and packaged acceptance.
- [ ] Build and validate a private Windows release; record measurements and commits.

## Investigation

The current field performs a nearest-surface BVH traversal followed by an
oriented first-ray traversal on every query. A CPU profile and phase timings
are being collected before changing that path. Safe candidates include reusing
the already-found closest face for an unambiguous face-interior sign, while
retaining ray fallback at edges, vertices and openings. Grid resolution,
sampling, simplification and accuracy thresholds must not be loosened.

Reliability audit identified five concrete gaps: self-intersection pairs sharing
a vertex are all excluded; exact mesh caches are count-bounded but not
memory-bounded; selected triangle budgets are checked after materialization;
cutter meshes lack dedicated preflight diagnostics; and 3MF surface QA rounds
its geometry to float32 even though the encoded file preserves doubles.

Private benchmark results/profiles are written to .codex-run/overnight-hollow,
separately from the preserved organic artifacts. The opt-in benchmark test does
not run during ordinary test execution and never replaces the source fixtures.

## Measured hollowing improvement

Identical private source STL, wall 2 mm, requested sampled error 0.1 mm, unchanged
grid/slabs/simplification. Both profiled runs made 55,036,917 evaluations and
produced 171,914 raw triangles with exactly identical positions and indices:
SHA256 1504371d8584bb491abb899174702e05ee58b6862db978861771fd452f5223c9.

| Measurement | Baseline | Optimized |
| --- | ---: | ---: |
| Hollowing time | 204,289.1 ms | 170,860.1 ms |
| Sampled cavity error | 0.092864712 mm | 0.092864712 mm |
| Solid volume | 24,237.875851 mm3 | 24,237.875851 mm3 |
| Ray queries | 55,036,917 | 19,561,231 |
| Closest-face sign queries | 0 | 32,046,026 |
| Bounds sign queries | 0 | 3,429,660 |

Time reduction: 16.36% (33.43 s). A 200,000-query microbenchmark measured
979–998 ms baseline versus 811–820 ms optimized. Across 50,000 deterministic
convex, concave, toroidal and translated samples, the optimized field matched
the reference distance and sign exactly. Edges, vertices, near-surface ambiguity,
degenerate faces and opening probes retain the original oriented-ray fallback.
No distance clamping, resampling, quality reduction or worker parallelism was used.

CPU profile attribution: nearest-point stack 71.4%, ray/intersection stack 20.1%,
field callback 92.3%. Inclusive categories overlap; Manifold levelSet includes
the JS callback and cannot be treated as isolated native CPU. The finest grid
accounts for 85.6% of wall time. Baseline peak RSS was approximately 1,856 MiB.

Both raw outputs retain the pre-existing numerical mesh defects and are not
declared manufacturing-ready. The same explicit 0.0001 mm repair produces
92,448 valid triangles with 0.000083606 mm sampled deviation in this direct
STL-coordinate fixture. This differs from the saved project's 92,394 world-placed
export because its source coordinate normalization/rounding differs; baseline
and optimized results within each fixture are compared without mixing them.
