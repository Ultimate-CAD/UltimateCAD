# Ultimate .9 — high-speed geometry engine

Completed **Ultimate 1.114.0-ultimate.9**, validated on 2026-10-29. Both exact-preview targets are met in the packaged application, with byte-identical saved mesh assets and complete applicable manufacturing checks. Ready for regular use on the supported mesh workflows; existing thickness warnings still require review and prevent an automatic print-ready label.

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

## Final matched packaged comparison

The final .8 controls are `.codex-run/geometry9/control8-organic` and `control8-500k`; .9 reports are `dist/ultimate/windows/geometry9-organic` and `geometry9-500k`. Both versions read the identical read-only project files, use the same physical dimensions, local axes/positions and retained side, and run the same interaction sequence with a fresh isolated profile. All network requests outside loopback are blocked and PATH contains only System32. No development installation is required.

| Metric | Organic .8 | Organic .9 | 500k .8 | 500k .9 |
| --- | ---: | ---: | ---: | ---: |
| Initial worker ready | 402.6 ms | 204.0 ms | 2,475.3 ms | 891.7 ms |
| First uncached worker round trip | 4,586.5 ms | 2,145.3 ms | 22,881.1 ms | 8,446.7 ms |
| Request → verified UI enabled | 4,631.4 ms | **2,189.8 ms** | 22,980.8 ms | **8,561.5 ms** |
| Receive → verified UI enabled | 44.9 ms | 44.5 ms | 99.7 ms | 114.8 ms |
| Peak app process working set | 1,276,896 KiB | 1,216,504 KiB | 3,461,508 KiB | 3,671,040 KiB |
| Identical-cache extra upload calls | 4 | **0** | 4 | **0** |

User-perceived first-preview latency fell **52.7% organic / 62.7% 500k**. The original .8 observations of approximately 4.6 and 22.8 seconds were reproduced. The final table includes UI installation/observation; worker timings alone exclude that cost. One run is not a latency guarantee for every geometry or future machine state. No general FPS or all-CAD-operation speedup is claimed.

The organic peak working set fell 4.7%; the 500k whole-workflow peak increased **6.1%** (about 3.30 → 3.50 GiB). This includes opening, cancellation/restart, history, persistence and export, not just the isolated geometry calculation. The packed 447k result cache retains 32,184,000 bytes (30.69 MiB), alongside one bounded GPU result; GC scheduling and other workflow allocations also affect the measured peak. The measurement does not establish that caching alone caused the entire difference. No general memory-saving claim is made.

### Actual .9 precise-request cost

Exclusive stage totals below come from the first uncached packaged worker reply. Wrapper totals are not added again. They are wall-clock stage observations, not hardware CPU-utilization counters. The pre-optimization stage profile used the same algorithm inputs but also includes initial source preparation; consult its scope rather than treating every individual row as a matched microbenchmark.

| Stage | Organic | 500k |
| --- | ---: | ---: |
| Vertex classification / triangle clipping | 0.9 / 11.5 ms | 2.5 / 74.3 ms |
| Contours / rim triangulation | 8.4 / 2.4 ms | 15.9 / 11.8 ms |
| Exact indexing | 91.7 ms | 571.4 ms |
| Topology, excluding indexing | 180.1 ms | 1,220.0 ms |
| BVH construction / exact bounds | 76.0 / 15.4 ms | 386.8 / 43.0 ms |
| Self-intersection searches | 1,619.0 ms | 5,861.9 ms |
| Containment / thickness diagnostics | 0.8 / 79.3 ms | 0.6 / 90.0 ms |
| Transform-input packing / rebase | 6.0 / 35.7 ms | 18.6 / 104.0 ms |
| Response copy for transfer | 1.0 ms | 4.3 ms |

The first result's UI buffer installation measured 10.4 / 52.5 ms. Its associated render submission measured 25.5 / 47.0 ms. These CPU/API measurements do not measure GPU completion and should not be summed with cumulative render totals spanning source initialization and plane movement.

## Interaction, repeated editing and stress

Both the matched .8 and .9 plane sequences processed 120 input events in approximately 2.07 seconds (**about 58 updates/s**) with no precise worker requests during movement, Apply disabled, no motion long tasks and no geometry buffer uploads. Each source-idle observation lasted approximately one second with **zero target-canvas draw calls and uploads**. rAF median delivery was approximately 144.9 Hz on this display; that is not a claim of GPU-completed 144 FPS. The pre-existing visual clipping approach was already responsive; .9 makes its verification state explicit and accelerates the precise stage.

The separate 20-preview 500k resource probe used 20/20 cache hits from the same worker. Worker round trips were 6.3–7.3 ms (median 6.75 ms), with **zero GPU uploads** for every repeat and in aggregate. The source asset hash was unchanged. Peak app process working set was 3,654,140 KiB, similar to the primary .9 workflow. Sampled renderer used JS heap was 347,410,117 bytes before the probe and 321,187,489 bytes at the end. The last two five-request checkpoints were 344,080,262 and 344,130,798 bytes. This run showed no monotonic accumulation; it does not prove unlimited-session leak freedom.

That optional resource probe explicitly forces **page/renderer GC** after requests 5/10/15/20. It does not force collection of the worker heap; `performance.memory` is a renderer estimate and can update coarsely. Forced-GC results are not mixed into the normal matched performance comparison. Context-loss events in the reports coincide with detached tool canvases during teardown; no active snapshot showed context loss. Context-creation counts and a post-process-close resource census were not collected, so those are not claimed.

The larger stress case uses the existing **2,000,000-triangle collar STL**, with full-density visual feedback. Worker readiness was 3,609 ms initially and 3,717 ms after cancellation/restart. It processed 120 plane events in 2,073.5 ms (57.87/s), no motion long tasks, no idle draws/uploads and no precise regeneration per input. Cancellation terminated the original worker; replacement readiness, injected late/stale replies and full Cancel preserved source identity/asset hash. Peak app process working set was 6,423,456 KiB (6.13 GiB), without OOM. **Final manufacturing geometry was deliberately not evaluated or certified in this stress-only run.** The two-million-triangle input ceiling and existing complete-validation limits are unchanged.

The initial 2M automation attempt selected a stale editor while importing. It timed out before the tool ran. The harness now waits for the fixture's exact project name and fresh registration. That failed diagnostic capture is retained in `geometry9-stress-2m` and excluded from accepted counts; the routed run is `geometry9-stress-2m-routed`. No engine timeout or geometry safeguard was increased.

## Precision and regression acceptance

The saved applied Float64 mesh assets match the .8 controls byte-for-byte:

- Organic: `c440e8857cb90a22b2c842023fd8922d056e642eb2e55b31bf0f4a96980ee7e7`.
- 500k: `1a23fecbae789b740a9a73169de0ccb360f55158178f7b72f28bf6eac1c87224`.

Organic remains 89,926 triangles with a 493-triangle rim; 100k remains 90,500 with a 1,000-triangle rim; 500k remains 447,000 with a 2,000-triangle rim. Retained-face deviation is exhaustively **0 mm**. Dimensions, winding, material volume, cavity/rim topology and final float32 checks match .8. Complete applicable searches find no self-intersections. Independent STL/3MF audits and editor reimports report no boundaries, non-manifold edges/vertices, winding mismatches, duplicate or degenerate faces.

Thin/acute-region sampled warnings remain approximately 0.0002 / 0.0107 / 0.0842 mm for organic /100k /500k against the unchanged 0.8 mm threshold. Those cases remain **not automatically print-ready**; their reviewed exports passing topology checks does not erase wall concerns. The straight cylinder is marked ready. No repair, smoothing, resolution reduction or thickening was introduced.

**55 focused/integration tests passed**: 33 focused tests and 22 manufacturing/native/STEP/repair integration tests. Four unrelated optional integration fixtures were skipped. **78 packaged checks passed with zero recorded errors**:

| Final report directory under `dist/ultimate/windows` | Checks |
| --- | ---: |
| `geometry9-synthetic` | 8 |
| `geometry9-organic` | 8 |
| `geometry9-100k` | 8 |
| `geometry9-500k` | 8 |
| `geometry9-repeat-500k` | 8 |
| `geometry9-stress-2m-routed` | 2 |
| `geometry9-smoothing` | 3 |
| `geometry9-precision` | 11 |
| `geometry9-scad` | 22 |

These cover real Apply, same object identity, three Undo/Redo cycles, distinct-project LYL reopen, cancellation followed by restart/new Preview, rapid plane changes, stale replies, complete validation, STL/3MF, exact native/STEP export, cached organic hollowing, offline execution and native SCAD/library/cancellation/MCP behavior. Expensive organic SDF hollowing was not repeated.

The existing 100k viewport benchmark also reports zero errors. Smooth Mesh reached Ready in **369 /341 /340 ms**, with selection latency 65.5 ms. This preserves the .7 interaction behavior; no main viewport or brush algorithm was changed. Overall rAF was about 144 Hz; whole-run maxima include startup/import/profiling work, so they are not represented as sustained interaction or GPU frame times. Evidence: `.codex-run/geometry9/viewport/100000-1793304889696/report.json`.

## Reproduction and artifacts

Matched input file SHA256 values:

- `.codex-run/geometry9/fixtures/organic-upright.lyl`: `97b5a5dcb0fb8b6143c1777e764dc6228ac201c6dff44438d379da4eaac94df4`.
- `.codex-run/geometry9/fixtures/closed-hollow-500000.lyl`: `6c6e9594ade51bf17c75350a6e68ee52dea47ef3b2e9c407b5d9f6d504e10866`.

Each accepted finishing directory contains `results.json`, `measurements.json`, `interaction.json`, actual saved projects/exports and screenshots where applicable. `mesh-audits.json` holds independent exported-file topology counts. `HIGH_SPEED_GEOMETRY_BASELINE.md` and the staged CPU profiles preserve the pre-optimization evidence and cost ranking. The test helpers now write generated evidence to `.codex-run/geometry9/evidence` (override with `LAYERLING_FINISH_EVIDENCE_DIR`), separate from read-only input fixtures.

For packaged comparisons set `LAYERLING_EXPECTED_APP_VERSION` exactly, `LAYERLING_FINISH_FIXTURE`, `LAYERLING_FINISH_POSITION`, `LAYERLING_FINISH_EXPECT_THIN_WARNING=1` for the flagged fixtures, a fresh `LAYERLING_HOLLOW_FINISHING_VALIDATION_DIR`, and `LAYERLING_GEOMETRY_INTERACTION=1`; then run `node desktop/validate-hollow-finishing.mjs <absolute-executable-path>`. The .8 executable is in `.codex-run/preserved-ultimate8/win-unpacked`. Resource probing uses `LAYERLING_GEOMETRY_REPEAT_PREVIEWS=20`; larger visual/cancel testing uses `LAYERLING_GEOMETRY_STRESS_ONLY=1`. These modes are separate and explicitly labeled. CPU profiling is opt-in through `LAYERLING_GEOMETRY_PROFILE` / `LAYERLING_GEOMETRY_CPU=1` with `tests/unit/highSpeedGeometryProfile.test.ts`.

## Release and limits

Packaged runtime source commit: **`62d9dfad56f3020dfc6d3300270660b01ce24aa4`** on `codex/high-speed-geometry-engine`. Later commits contain validation harness/report updates only. Release metadata and the accompanying source ZIP identify the runtime checkpoint.

Executable: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\win-unpacked\Layerling Ultimate.exe`.
SHA256: `e8180ccadb100a3b8ad6f30a97e7d8a7d7a83214f84f4535707630adb61040da`.
Installer: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\Layerling-Ultimate-OpenSCAD-Setup-x64.exe`.
Size: **212,830,253 bytes**. SHA256: `0324013dd00ce7c17d7711f80a982009163869d66930ba19da89df75ef0db7f4`.
Source ZIP: `dist/ultimate/windows/sources/Layerling-Ultimate-Source.zip`.

The entire packaged directory is required with the unpacked executable. Its host EXE hash alone does not fingerprint the external runtime assets; installer hash plus source provenance identify the release. The installer was generated; acceptance used the packaged payload without replacing the installed working application. The complete .8 rollback remains intact, with installer SHA256 `47bc147e5ab5d6586a18b82ff3024898286320c254810eafd938a77304dbc144`. No push or publication was performed.

Performance remains geometry-dependent. The complete 30 s /5 million candidate policy can refuse difficult meshes at any size; .9 never labels incomplete results verified. Two-million-triangle stress evidence covers interaction/cancellation, not a completed manufacturing result. The 20-repeat probe is bounded, not an hours-long session certification. GPU utilization, VRAM and GPU-completed frame times were not measured. More parallelism or GPU geometry compute was not justified after the measured algorithm/allocation improvements met the targets.
