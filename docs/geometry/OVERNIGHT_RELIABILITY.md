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
- [x] Fix shared-vertex intersection gaps, cache memory and budget preflight issues.
- [x] Exercise cutter diagnostics, double-precision 3MF QA and worker recovery.
- [x] Run focused tests and selected high-density checks.
- [x] Complete final packaged precision acceptance after the mixed-group correction.
- [x] Complete final OpenSCAD compatibility acceptance and release record.

## Investigation

The baseline field performed a nearest-surface BVH traversal followed by an
oriented first-ray traversal on every query. CPU profiles and phase timings
identified these repeated traversals as the principal cost. The optimized path
reuses the already-found closest face for an unambiguous face-interior sign,
while retaining ray fallback at edges, vertices and openings. Grid resolution,
sampling, simplification and accuracy thresholds remain unchanged.

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

| Measurement | Baseline | Closest-face reuse | Final reuse + SAH BVH |
| --- | ---: | ---: | ---: |
| Hollowing time | 204,289.1 ms | 170,860.1 ms | 151,289.5 ms |
| Sampled cavity error | 0.092864712 mm | 0.092864712 mm | 0.092864712 mm |
| Solid volume | 24,237.875851 mm3 | 24,237.875851 mm3 | 24,237.875851 mm3 |
| Ray queries | 55,036,917 | 19,561,231 | 19,561,231 |
| Closest-face sign queries | 0 | 32,046,026 | 32,046,026 |
| Bounds sign queries | 0 | 3,429,660 | 3,429,660 |

Final time reduction: **25.94% (53.00 s)**. All three indexed meshes are
byte-identical, not merely within a tolerance. A 200,000-query microbenchmark measured
979–998 ms baseline versus 811–820 ms optimized. Across 50,000 deterministic
convex, concave, toroidal and translated samples, the optimized field matched
the reference distance and sign exactly. Edges, vertices, near-surface ambiguity,
degenerate faces and opening probes retain the original oriented-ray fallback.
No distance clamping, resampling, quality reduction or worker parallelism was used.
The next measured change used the existing BVH library's SAH build strategy at
the same leaf size of 8. In 200,000-query comparisons it reduced 797–804 ms to
695–696 ms, with zero differing distance values; build cost rose only from
7.3 to 9.5 ms. Leaf size 4 offered no useful additional gain, so it was not used.
One final controlled cavity run confirmed the gain and exact-output equality.

CPU profile attribution: nearest-point stack 71.4%, ray/intersection stack 20.1%,
field callback 92.3%. Inclusive categories overlap; Manifold levelSet includes
the JS callback and cannot be treated as isolated native CPU. The finest grid
accounts for 85.6% of wall time. Baseline peak RSS was approximately 1,856 MiB.
The final run peaked at approximately 1,879 MiB, a small increase rather than
a memory-saving claim. The spatial index and face metadata remain per-job.

Both raw outputs retain the pre-existing numerical mesh defects and are not
declared manufacturing-ready. The same explicit 0.0001 mm repair produces
92,448 valid triangles with 0.000083606 mm sampled deviation in this direct
STL-coordinate fixture. This differs from the saved project's 92,394 world-placed
export because its source coordinate normalization/rounding differs; baseline
and optimized results within each fixture are compared without mixing them.

## Reliability and resource changes

- Triangle pairs sharing vertices are checked beyond their expected common
  edge/vertex, using robust orientation predicates. A closed 5-vertex bipyramid
  with a crossing vertex star has valid combinatorial topology but was missed
  by the old blanket exclusion; the new check detects it.
- Surface acceleration uses Float64 coordinates for actual 3MF geometry. Tests
  distinguish a 0.01 mm separation from an intersection at a 1e8 mm offset.
  Shell volumes are integrated about shell-local origins to avoid translation
  cancellation; encoded float32 overflow is rejected explicitly.
- Exact tessellation cache: estimated 256 MiB byte cap plus 12-entry LRU cap,
  including key storage. One encoded preview is capped at 256 MiB including its
  buffers, report and key, and released before a different job allocates geometry.
  Large uncached exports remain eligible for processing.
- Known raw source/cutter counts, incomplete/empty/missing meshes are checked
  before JSON keys, worker cloning and mesh construction. Native tessellation
  receives the selected remaining aggregate budget and stops before expensive
  face projections or JS mesh copies if that call exceeds it. One native OCCT
  mesher call itself cannot be pre-budgeted precisely; worker termination remains
  the cancellation boundary.
- Invalid/open cutters are rejected with their names before Boolean operations;
  missing cutter geometry is never inferred by export repair. Valid cutters also
  receive surface/orientation checks. Manifold operand status is checked explicitly.
- Worker construction failures return rejected promises, malformed messages are
  ignored, and successful/canceled/error paths retain explicit worker ownership.
- Repair handles are released even if native construction/simplification throws.
  Local final B-rep construction wrappers are explicitly disposed after export
  tessellation; underlying brepjs intermediate wrappers retain their GC finalizers.
- Precision settings and output budgets are unchanged. The memory estimate was
  recalibrated above the measured high-density working set; it is an estimate,
  not a memory reservation or a guarantee against JS/WASM engine limits.
- Test outputs have explicit or unique per-run directories. The original source
  and release artifacts remain separate from new results.
- Mixed native/mesh groups export their complete mesh, with the representation
  reported honestly. Native-only groups retain exact tessellation. An unbaked
  mixed group containing cuts/Boolean operations is rejected until regenerated;
  export never drops a member or fills a cut by exporting a partial exact subset.
  Nested missing mesh inputs are rejected; a valid cached group mesh remains
  authoritative even when its historical inputs are unavailable. Cached root
  triangle counts also participate in the early resource budget.

## High-density and regression checks

The existing 2,621,440-triangle / 125 MiB STL encode-and-reimport baseline is
preserved. An additional bounded **786,432-triangle** end-to-end export/QA run
used a 1-million-triangle budget: **11,429.5 ms**, **2,065.9 MiB peak RSS**,
and **17.64 ms** for the byte-identical cached result. Independent STLLoader
reimport retained all 786,432 faces. Strict topology and volume checks passed.
The self-intersection candidate budget was reached, so the result remained
explicitly unverified for print readiness; no validation limit was relaxed.

Focused checks passed TypeScript, **97 unit tests** and **54 geometry/STEP/export
integration tests**, with four opt-in expensive benchmarks skipped in that suite.
Separate tests cover the profiled organic runs, the high-density workload,
closed/open cavities, thin walls, multiple shells, invalid STL/OBJ and cutters,
precision preflight, bounded cache eviction, worker failure/cancellation/recovery,
Undo/Redo history and LYL source serialization. After the mixed-group correction,
the affected 36 export/STEP tests and three resource tests passed again.
The final .5 source was rebuilt after this correction and passed all 11 packaged
precision checks, with zero renderer errors. The original cached organic LYL
was hash-checked unchanged. A small imported mesh exercises the actual optimized
worker in the packaged app: 8,596 triangles, 0.034212 mm sampled error and 338 ms;
Undo/Redo, preserved outside dimensions/identity, and source/history save/reopen
all pass. The saved test copy uses a separate project identity to force actual
readback rather than selecting an already-open project.

Final OpenSCAD compatibility acceptance passed **22 checks** with zero renderer
errors, including bundled engine/libraries, editable source and parameters,
native coexistence, cached regeneration, malformed/missing-library diagnostics,
save/reopen, mesh reimport and native process cancellation. Test applications
exited gracefully. In total the final packaged application passed **33 checks**.

Both independently reimported organic STL and 3MF contain **92,394 triangles**,
46,201 vertices, volume **24,237.875896 mm3**, and zero boundary edges,
non-manifold edges or non-manifold vertices. Explicit repair reports
**0.000083552021 mm sampled deviation**. Raw defective geometry is still blocked;
no automatic repair or relaxed validity check was introduced. The full packaged
run uses an isolated profile, System32-only PATH, and a runtime network block.

## Release and recovery

- App version: **1.114.0-ultimate.5**.
- Packaged source commit: **22f867f389c2ab21240ed9120c8b6c7f6342a7c7**.
- Local checkpoints: **62cf0a8d** (measured hollow optimization), **5c96b7c8**
  (manufacturing QA/resources), **22f867f3** (complete mixed-group export).
- The earlier integrity-only milestone **caa8bb63**, previous .4 baseline
  **a51ac809**, and recovery tag **checkpoint-ultimate4-a51ac809** remain available.
- Executable: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\win-unpacked\Layerling Ultimate.exe`.
  SHA256: `d21d49cda0523b23257ad92f2faff5e537e5125404141ae29b27d037ecb4a202`.
- Installer: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\Layerling-Ultimate-OpenSCAD-Setup-x64.exe`.
  Size: **212,658,173 bytes**. SHA256:
  `219c8796b0c73f866f2da55f4e72247696654567b0ec958d8daf7158f4515678`.
- Source archive and provenance: `dist/ultimate/windows/sources/Layerling-Ultimate-Source.zip`
  and `dist/ultimate/windows/release-metadata.json`.
- Final acceptance: `dist/ultimate/windows/overnight-final-validation/results.json`
  and `dist/ultimate/windows/overnight-final-scad-validation/results.json`.
- Private measurements: `.codex-run/overnight-hollow/*-result.json`, CPU profiles,
  binary mesh comparisons, and `.codex-run/overnight-precision/density/bounded-density-result.json`.

The complete .4 rollback app/installer hashes were verified unchanged, as were
the original STL and cached hollow LYL. No repository push/publication or
replacement of the installed working app was performed. Acceptance launches
the packaged unpacked executable; the NSIS installer is built, not installed
over the working release.

## Remaining limits

- Timings are measured controlled runs on this workstation, not guaranteed
  latency. Peak memory increased slightly; the gain comes from less traversal.
- The raw hollow retains its original numerical defects and secondary-cavity
  policy. Explicit export repair is still needed for this fixture. Surface
  deviation and cavity error are sampled measurements, not global proofs.
- The organic thin-region warning remains (approximately 0.000099 mm at an
  acute feature); this is not certification of a uniform 2 mm printable wall.
- Self-intersection work has a 5-million-candidate/time budget. Exhaustion stays
  explicitly unverified, including the 786k-triangle stress model; a closed
  topology alone cannot establish global print readiness.
- The 4-million default/12-million selectable triangle limits are unchanged.
  The recalibrated RAM estimate is advisory; JavaScript/WASM limits and one
  native tessellation call can constrain large jobs even with 64 GB system RAM.
  The full pipeline was newly measured at 786k triangles; the retained 2.62M
  baseline measures encoding/reimport rather than a complete new QA run.
- No unavailable analytic surface is inferred from imported mesh detail.
  Mixed-group remeshing still lacks per-face material provenance. Final B-rep
  exports are deterministically disposed; intermediate library objects retain
  their existing GC finalizers.

Primary implementations inspected:
[three-mesh-bvh queries](https://github.com/gkjohnson/three-mesh-bvh/blob/v0.9.16/src/core/cast/closestPointToPoint.js),
[Manifold level sets](https://github.com/elalish/manifold/blob/v3.5.0/src/sdf.cpp),
[robust predicates](https://github.com/mourner/robust-predicates).
