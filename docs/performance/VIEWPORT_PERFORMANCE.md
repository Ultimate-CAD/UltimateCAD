# Ultimate .7 measured viewport and interaction performance

Baseline release: Ultimate 1.114.0-ultimate.6, source 507cb5ce, validated checkpoint
ee321d59. Branch: codex/viewport-performance. Recovery tag:
checkpoint-ultimate6-ee321d59. Complete rollback app, installer, source archive,
metadata and acceptance artifacts are in .codex-run/preserved-ultimate6.

## Measurement and baseline

The packaged application is tested at 1424x900, device pixel ratio 1, on the
same workstation/display. The observed refresh interval is approximately 6.06 ms
(165 Hz). Binary closed collar fixtures contain exactly 100,000, 500,000 and
2,000,000 triangles. They passed independent STLLoader/Manifold preflight:
closed topology, consistent winding, no degenerate facets, positive volume.
Original organic and manufacturing fixtures are untouched.

The harness records independent rAF samples, long tasks, action-specific frame
intervals, CDP CPU profiles, worker message timings, process memory, WebGL call
and explicit-allocation proxies, and repeated open/close sessions. It samples
payload size without scanning full arrays. Profiler startup occurs **before**
the action timing boundary. Early reports polluted by startup pauses are marked
invalid for action FPS and are excluded from comparisons.

Valid baseline reports: `.codex-run/viewport7/baseline-corrected/`.
Compact measurements: `.codex-run/viewport7/compactbaseline-summary.json`.
Headless fixture preflight: `.codex-run/viewport7/fixture-preflight/`.

| Triangles | Orbit mean FPS | Pan mean FPS | Zoom mean FPS | Main idle mean FPS |
| ---: | ---: | ---: | ---: | ---: |
| 100,000 | 128.4 | 164.7 | 164.5 | near 165 |
| 500,000 | 128.3 | 165.3 | 163.9 | near 165 |
| 2,000,000 | 123.9 | 164.9 | 165.3 | 165.0 |

These short fixed pointer paths contain roughly 14–15 orbit frames, so percentile
precision is limited. Baseline orbit P95 is approximately 30.2 ms, pan/zoom P95
approximately 6.2 ms. There is one frame above 16.67 ms in the orbit samples;
pan/zoom have zero dropped frames against the explicit 60 Hz target. This is
not a sustained FPS guarantee. Native viewport interaction already meets the
initial 60 FPS goal; it is preserved rather than broadly rewritten.

At 100k, baseline Smooth Mesh selection roundtrip is **56.5 ms** and preview
roundtrip **2283.5 ms**. Source surface QA refuses 500k and 2M before painting;
that outcome is recorded as a capability limitation, not a successful brush test.
The corrected 2M all-run snapshot still contains import/initialization spikes;
global timings also include profiling overhead and cannot substitute for clean
action intervals. WebGL, OpenGL and GPU compositing are enabled. This alone
does not identify the physical GPU or measure GPU execution time.

## Reproducible bottlenecks and focused changes

1. **Linear Smooth Mesh picking.** The actual tool used Three's unaccelerated
   indexed mesh traversal. Renderer CPU profiling includes about 6 ms of the
   raycast subtree during the short 100k brush action. In 20-probe controlled
   tests at 101,760 / 499,848 / 1,996,568 triangles, baseline queries take
   46.68 / 218.17 / 951.45 ms. Indirect BVH queries take 2.26 / 0.30 / 0.18 ms
   after one-time builds of 35.6 / 102.7 / 442.6 ms. Every tested nearest point
   and face index matches; original indices are unchanged. These are query
   microbenchmarks, not end-to-end application speedup percentages.
   The tool now prepares its indirect BVH and display normals in its existing
   worker, refits there for previews, and transfers snapshots to the renderer.

2. **Full selection transport/color allocation.** Every stroke cloned the whole
   Float64 weight array and rebuilt/replaced the entire color attribute.
   Twenty 1M-vertex color reconstructions take **343.3 ms** in the measured
   loop (~17 ms/stroke). Sparse 1,000-vertex updates preserve identical Float32
   colors and reduce a representative selection payload from 8 MB to 12 KB.
   The worker retains exact weights and sends only changed indices/Float64
   values. Position, normal, index and color attribute objects are reused.
   Exact geometry uses transferred Float64 positions, not display Float32 data;
   large nested mesh clones and Apply's intermediate flatMap arrays are avoided.

3. **Unnecessary tool rendering and deferred resource release.** The tool rendered
   continuously even while idle; baseline profiles include renderer work in
   Smooth Mesh idle. Repeated closes leave positive create-minus-delete texture
   and framebuffer proxy counts, which by themselves do not prove a native leak
   because context GC is invisible to those hooks. The tool now draws only when
   camera/buffers/size change, disposes its resources, and explicitly loses its
   own context on close. The main viewport context is not touched.

Surface validation is deferred from selection initialization to the first
Preview, then cached for that immutable source. This permits painting large
sources without waiting for a global surface check. **Apply still requires
complete source and result surface validation**, with the original budgets and
manufacturing checks. A refused/incomplete source check never produces an
applicable preview. This changes where validation latency is paid, not its rigor.

Request revisions reject stale preview/error responses before changing state
or timers. Strength/iteration changes invalidate Apply. Cancellation terminates
the worker, and error/timeout paths disable it. Unselected source coordinates
are copied exactly when reconstructing the saved triangle soup.

## Correctness checkpoint

TypeScript and **74 focused unit tests** pass. **19 manufacturing/export
integration tests** pass; three opt-in fixture/benchmark tests were skipped in
that run. Additional identity tests compare frozen .6 and new worker outputs.
The original 4,812-triangle organic fixture has byte-identical algorithm weights,
result mesh and scalar statistics after identical add/subtract strokes:
geometry SHA256 **82c03aff1f2dd04089e4747533b3b52974d899357c9c998b1c3d1d545fbed24d**;
weights SHA256 **ea4bcc413227b1fd4734ed5098db97f5b87200fea23df5e43e150b208c26db00**.
The tetrahedron comparison is also byte-identical. Snapshot-transfer tests prove
that transferring display data does not detach the worker's retained BVH/cache.
An intersecting closed source can be selected but is rejected before any preview
is returned. No geometry-kernel, manufacturing threshold, export tolerance or
stored mesh resolution is reduced.

## Final packaged comparison

The single final .7 Windows build passed the same corrected workload at all
three tiers with zero renderer/harness errors and no OOM. Source commit:
**7d07188fa389dfc5bebcebb37295ef1e3b606f28**.
Reports: `.codex-run/viewport7/final/`; complete comparisons:
`.codex-run/viewport7/comparison.json` and `comparison.md`.

| Triangles | Build | Orbit mean rAF/s | Orbit P95/max ms | Pan mean rAF/s | Zoom mean rAF/s | Tool idle draws / 2s |
| ---: | :---: | ---: | ---: | ---: | ---: | ---: |
| 100,000 | .6 | 128.4 | 30.2 / 30.2 | 164.7 | 164.5 | 332 |
| 100,000 | .7 | 135.7 | 24.1 / 24.1 | 150.4 | 165.0 | 0 |
| 500,000 | .6 | 128.3 | 30.4 / 30.4 | 165.3 | 163.9 | unavailable |
| 500,000 | .7 | 128.2 | 30.2 / 30.2 | 165.0 | 164.5 | 0 |
| 2,000,000 | .6 | 123.9 | 30.2 / 30.2 | 164.9 | 165.3 | unavailable |
| 2,000,000 | .7 | 137.6 | 24.2 / 24.2 | 164.9 | 164.4 | 0 |

These differences do **not** establish a general native-viewport FPS improvement.
The main rendering code was deliberately preserved. Mean rAF delivery is not
GPU-completion or compositor-present FPS, and on-demand idle views intentionally
do not redraw despite continuing to receive rAF callbacks. The short brush frame
intervals cover input dispatch; result-feedback latency is reported separately.

| Brush action | P50 ms | P95 ms | P99 ms | Max ms | Samples / dropped at 60 Hz |
| --- | ---: | ---: | ---: | ---: | ---: |
| .6, 100k | 6.1 | 6.2 | 6.2 | 6.2 | 6 / 0 |
| .7, 100k | 6.1 | 6.1 | 6.1 | 6.1 | 5 / 0 |
| .7, 2M | 6.0 | 6.2 | 6.2 | 6.2 | 5 / 0 |

The 500k .7 brush P95/P99/max is 6.2 ms, also with five samples and no dropped
intervals. Full action frame distributions, long tasks, and CPU profiles are in
the JSON artifacts; five samples cannot establish a sustained tail-latency bound.
Orbit has one interval above 16.67 ms in each short action. Pan/zoom have none.
No long tasks were observed inside the final timed actions. Whole-run startup,
import and validation periods still show spikes (2M: ~764 ms frame / ~769 ms
long task), with profiler startup outside action boundaries; those global maxima
are not pure interaction or GPU measurements.

### Opening, feedback and preview tradeoffs

The independent 100k resource workload measured tool-open readiness at
**2382 / 2257 / 2222 ms** in .6 versus **626 / 560 / 555 ms** in .7. Most of the
change comes from deferring global surface validation until Preview, rather
than eliminating that work. At 2M, .7 reached ready in **28.8 seconds**; .6
refused during initialization. This is not a faster high-density open claim.

At 100k, worker selection feedback is **56.5 -> 65.2 ms**, so this run demonstrates
**no improvement in end-to-end selection roundtrip**. Separate picker and color
microbenchmarks establish lower renderer work, while scheduling/worker roundtrip
still dominates this small workload. Selection replies shrink from approximately
**400 KB to 11 KB**. At 500k and 2M, .7 permits painting and returns selection in
**53.4 / 65.1 ms**; comparable .6 timings are unavailable because it refused entry.

The first 100k preview is **2283.5 -> 3997 ms** because .7 pays the source surface
check there and prepares display data off-thread. This is not a preview-speedup
claim. Source validation is cached after a complete successful check. At 500k
and 2M, Preview still returns the existing named source-validation refusal and
Apply remains disabled. No validation budgets or tolerances were weakened to
obtain these interaction results.

### Memory, hardware and cleanup

The actual device string is **ANGLE / NVIDIA GeForce RTX 5070 / D3D11**, verified
from the live WebGL contexts, with GPU compositing/WebGL enabled. No rendering
backend or dependency was replaced. CPU profiles describe the renderer thread;
worker roundtrips are wall times, not isolated worker CPU times. GPU execution
timestamps, VRAM allocation and hardware GPU-engine utilization were not captured.

| 2M process observation | .6 | .7 |
| --- | ---: | ---: |
| Tab working set, GiB | 3.535 | 4.150 |
| Tab peak working set, GiB | 5.547 | 4.722 |
| GPU-process working set, MiB | 327.34 | 422.02 |

The final endpoint retains a usable 2M tool/display cache, whereas .6 is in a
refused state; do not treat these as identical cache-residency comparisons or
claim general memory savings. Working sets include native/worker allocations
and are not JS heap or VRAM measurements. All tiers stayed within this machine's
practical resource capacity, with cancellation available.

Resource acceptance intentionally holds closed canvas/context references for
three cycles. In .6 all three closed contexts remain live; in .7 **all three are
explicitly lost**, while the main context stays live and the DOM returns to one
canvas every time. This proves explicit context release under retained references,
not that .6 had an unconditional native leak. Final forced-GC JS used sizes are
**37.53 / 37.68 / 38.48 MB** across the held-reference .7 cycles. CPU backing
storage grows while those references are deliberately held; the test does not
certify arbitrarily long sessions or full CPU-buffer reclamation. WebGL
create-minus-delete counters are only allocation proxies and cannot account for
all driver/context-GC behavior. Reports: `.codex-run/viewport7/resources-baseline/`
and `resources-final/`.

## Final correctness and release acceptance

- **74 unit tests**, **19 relevant manufacturing/export integration tests**, plus
  the focused saved-smoothed-LYL export/reimport test pass. Expensive original
  hollowing benchmarks were not rerun.
- **36 packaged checks** pass: smoothing (3), precision/hollow/export (11) and
  OpenSCAD compatibility (22), with zero renderer errors. Three actual Undo/Redo
  cycles restore identical coordinate arrays; selection changes around preview,
  changed-iteration invalidation, cancellation and real LYL readback pass.
- Saved .6 and .7 painted-collar mesh assets are **byte-identical**, SHA256
  **50ac05e29f38aed69c59fb03719e584632c3f97ea04edfe5e71b2093c0ced8d2**;
  all coordinates match with **0 mm** deviation. The .7 saved model passes
  Precision Mesh Studio QA and independently reimports as a manifold 2016-face
  STL. The preview screenshot was visually inspected.
- Offline packaged tests use isolated profiles, System32-only PATH and blocked
  external network requests. Native engine cancellation and mixed source storage
  remain covered by the compatibility checks.

Acceptance reports are in `dist/ultimate/windows/viewport7-smoothing-final-validation`,
`viewport7-precision-validation`, and `viewport7-scad-validation` (`results.json`
within each). Readback mesh/report: `.codex-run/viewport7/manufacturing/`.

### Verified artifacts

- Executable: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\win-unpacked\Layerling Ultimate.exe`.
  SHA256: `32f2ff6fbd5996296ffb71561a4f5a7e0e196d559720c86f1c9f2b4ae387914a`.
- Installer: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\Layerling-Ultimate-OpenSCAD-Setup-x64.exe`.
  Size **212,714,672 bytes**. SHA256:
  `4df40ece5bb061140e8396aad9d1fd2c786e6863efabf75cb4151f56d39f7f00`.
- Source: `dist/ultimate/windows/sources/Layerling-Ultimate-Source.zip` and
  `release-metadata.json`. Packaged production commit: **7d07188f**. Later commits
  contain final test/report evidence only. All commits remain local.
- Rollback: `.codex-run/preserved-ultimate6` and
  `checkpoint-ultimate6-ee321d59`. Acceptance runs the unpacked packaged app;
  the installer is generated without replacing the installed working application.

## Remaining limits and next target

High-density painting is usable, but source/preview validation still prevents
applying the 500k and 2M fixtures under existing safety budgets. The most valuable
next target is scalable, cancellable complete surface validation: profile and
reduce broad-phase/shared-contact candidate work while retaining every required
intersection check. Do not simply raise/disable validation limits or label an
incomplete result safe. Import/indexing and 2M tool startup are the next measured
responsiveness costs; moving remaining decode/copy work into the existing worker
and reducing adjacency-memory overhead should be investigated before a backend
switch. The present microbenchmarks and short fixed paths are a reproducible
checkpoint, not a guarantee for every mesh, longer session or system load.
