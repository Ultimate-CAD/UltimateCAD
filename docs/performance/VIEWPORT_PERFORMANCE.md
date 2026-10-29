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

Packaged before/after performance, resource acceptance, final regression results
and exact release hashes will be appended after the .7 build passes.
