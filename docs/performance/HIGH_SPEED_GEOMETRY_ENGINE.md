# Ultimate .9 — high-speed geometry engine

Release candidate checkpoint. Packaged .9 acceptance and final release hashes are pending.

## Baseline and scope

Baseline branch/checkpoint: `263fec0a`, packaged source `a2275206`, Ultimate 1.114.0-ultimate.8. A complete .8 application directory, installer, source ZIP, metadata and hashes are preserved at `.codex-run/preserved-ultimate8`; recovery tag `checkpoint-ultimate8-263fec0a`. Original captured STL sources and accepted packaged .8 reports remain available. Nothing is pushed or published.

The same organic and 500k designs are used at local Y=5.123 and 3.123 mm respectively. Read-only control project copies live in `.codex-run/geometry9/fixtures`. Whole-file SHA256 values are recorded before packaged comparisons. Output geometry, object identity, source preservation and final manufacturing validation take precedence over latency. No resolution, tolerance, repair threshold or validation budget was reduced.

Detailed pre-optimization evidence: `HIGH_SPEED_GEOMETRY_BASELINE.md`, `.codex-run/geometry9/baseline/profile.json` and its CPU profiles. Fresh .8 packaged controls and interaction runs are retained separately under `.codex-run/geometry9`.

## Proven bottlenecks and retained changes

The CPU profile showed that clipping, contour construction and rim triangulation were already cheap (approximately 0.126 s combined at 500k). Complete intersection searches took 18.285 s across the required representations. Repeated indexing and allocation-heavy topology verification accounted for most remaining work. The geometry algorithms were profiled before optimization.

1. The shared-contact narrow phase now borrows the exact indexed vertex coordinates and uses scalar scratch values. It removes per-candidate coordinate arrays, Sets, coordinate strings, filter/map closures and repeated AABB checks after the caller has already rejected strictly separated triangle bounds. Robust orientation predicates, nonshared triangle intersection routines, tests beyond shared edges/vertices, arithmetic order and candidate coverage are retained.
2. Vertex-manifold checking uses typed face-corner disjoint sets joined only across real shared edges. This is equivalent to the old per-vertex graph traversal. Normal edges store their first two incident faces directly; exceptional additional incidents remain fully checked. Collision-free numeric edge keys are used only when their integer range is safe, with a string-key fallback. Volume integration keeps the original shell origins and arithmetic.
3. Explicit canonical-index entry points avoid re-indexing a fresh owned mesh. General caller-owned mesh APIs still perform exact defensive indexing. There is no implicit global cache over mutable caller data.
4. Each worker retains at most one validated result and its packed Float64 payload. Responses transfer copies of that packed buffer, leaving the cache attached. New source initialization resets the cache; cut settings form the exact cache key. The worker rejects source replacement while its engine initializes.
5. The isolated viewport retains at most one result's GPU geometry while the plane is adjusted. It reuses those buffers only for the identical validated cached result. Changed geometry replaces/disposes them; closing releases both source/result resources and explicitly loses the private WebGL context. Source and result meshes retain their original density.

No additional runtime concurrency or GPU geometry computation was introduced. The existing local worker performs exact geometry/validation. GPU clipping provides visual feedback only. The main viewport, exact OCCT representation, SCAD engine and SDF hollowing algorithms are unchanged.

## Interaction and diagnostics

Plane movement updates clipping uniforms and the plane quad without issuing a worker Preview. Ready status explicitly says this is visual-only feedback and requires Preview before Apply. Precise Preview constructs or reuses the real connected rim. Incomplete or failed applicable validation blocks Apply. Parameter edits invalidate a verified preview immediately. Cancellation terminates the worker; session/revision checks ignore late replies.

Worker replies contain bounded per-request timings for input unpacking, source preparation, classification, clipping, contour tracing, rim triangulation, topology, indexing, BVH construction, intersection checks, containment probes, thickness sampling, transform materialization and response packing. UI performance measures are opt-in for acceptance runs, preventing an unbounded production PerformanceEntry log. The harness measures initial worker setup, communication, UI-ready latency, rendering API call time, upload counts, rAF delivery, long tasks, process memory and context loss. Rendering API CPU time and rAF delivery are not GPU-completed frame timings or VRAM measurements.

## Pre-package correctness and profiling

- 33 focused tests passed, including exact preserved-fixture geometry/QA comparisons, organic and synthetic 100k/500k cases, source transfer/cache safety and smoothing regressions.
- 22 manufacturing/integration tests passed; four unrelated optional fixture tests skipped. Native analytic solids, STEP, repair and malformed manufacturing geometry remain covered.
- A frozen .8 predicate is compared against 12,000 deterministic cases across shared simplices, coplanarity, degeneracy, large translations and scales.
- A frozen .8 topology auditor is compared against 500 randomized meshes in both precisions plus a disconnected vertex-fan case. Every diagnostic, seed, dimension and volume matches.
- Organic and 500k geometry hashes are unchanged: `8c13d08d5a84214a4e2514a4e669b7576eccff03dc845399b5f1fae44d7d6028` and `e77cbeef50485bd84345596e6c5fbcaaea5cfb45e820465a98e6eed95603ba56`.
- All wholly retained source triangles remain exhaustively identical: 88,698 organic, 88,000 100k, 442,000 500k. This is a full face-membership/coordinate comparison, not a sample.

Standalone CPU-profile observations (same algorithms, before packaging): organic preview 5.104 → 2.075 s, 500k 24.608 → 8.823 s. These are not final user-facing packaged latency claims. Profiles and each measured iteration are retained under `.codex-run/geometry9/{baseline,optimized1,optimized2,optimized3,optimized4,optimized5}`. All required surface passes still run. Candidate counts, completed coverage, thickness values/warnings and topology match .8.

## Evidence housekeeping

Legacy finishing unit helpers originally wrote secondary reports and a regenerated synthetic project into `.codex-run/finishing8`. During early .9 tests those secondary helper outputs were superseded. They are excluded from the .9 baseline; the accepted packaged .8 reports, preserved release and original captured STL sources were not overwritten. Test outputs now use a separate configurable evidence directory, and benchmark input copies are read-only. Final packaged controls rerun .8 on those exact same files before comparison with .9.

## Remaining release work

Finish the .9 package, run the same packaged cohort and interaction sequence, validate cancellation/stale replies, record peak working set and GPU buffer reuse, exercise a safe larger stress model, rerun the packaged native/export/smoothing/SCAD regressions, and record final executable/installer paths, hashes and local commits. No production-ready claim is made at this checkpoint.
