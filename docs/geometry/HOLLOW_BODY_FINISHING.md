# Ultimate .8 Hollow-Body Finishing

Implementation checkpoint; packaged acceptance is still pending at this commit.

Select one unlocked imported mesh, choose **Open Hollow Base**, adjust the local axis, position and retained side, then **Preview → Apply**. Orange shows removed material during plane adjustment; the validated result displays its rim in gold. Moving the plane invalidates Apply immediately. Cancel preview terminates its worker; Cancel leaves the document unchanged. Apply uses the existing object identity and one Undo transaction. The result uses the existing lossless LYL mesh asset and STL/3MF pipelines.

## Geometry and safeguards

The double-precision clipping kernel reuses each crossing by its original undirected edge identity. Unaffected retained triangles and coordinates are copied exactly. Directed planar boundary edges become closed contours; nesting and winding classify material and cavity loops. The bundled Manifold polygon triangulator creates the planar rim with holes. This operation does not recompute SDF hollowing, reconstruct a surface, simplify, smooth, thicken, or repair the source.

Only one connected material body is accepted. Multiple cavity openings are supported when nesting, orientation and final topology are consistent. Coplanar faces, touching/branching contours, missed cavities, float32 collapse, disconnected results, or remaining sealed cavities produce explicit refusals. The UI operates on local, unrotated axes; existing rotation and mirrors are preserved when the result is rebased to its actual bounds. New dimensions and location are computed together to retain world position.

Apply requires closed edge/vertex-manifold topology, consistent winding, no duplicate/degenerate faces, positive reduced volume, expected solid-component count, complete applicable self-intersection checking and shell-containment probes. Both the cut mesh and its final transformed float32 manufacturing coordinates are checked. Thickness is the existing sampled normal-ray diagnostic, not a certified global minimum; warnings are displayed without changing the geometry.

The existing 30-second / 5-million candidate surface-check limits remain. A conservative broad-phase improvement rejects strictly disjoint double-precision triangle bounding boxes before the narrow-phase candidate budget. This duplicates the existing narrow-phase rejection earlier; it does not ignore shared-vertex or shared-edge pairs. Incomplete checking still blocks Apply.

## Responsiveness and resources

Plane dragging updates clipping uniforms and a plane quad, without clipping or validating the full mesh. Preview runs in a dedicated worker. The source topology and completed source surface validation are reused. The last fully validated cut is cached by exact settings. A 180-second request timeout terminates the worker; stale replies are rejected by session identity and revision. Worker memory, preview buffers, WebGL resources and context are released when closing the tool. The isolated viewport draws only on camera, geometry or size changes; .7 Smooth Mesh and main viewport code are unchanged.

Input budget is 2 million triangles, checked before indexing. The 100k and 500k deterministic performance tests are representative resource checks; they do not imply every geometry at that size will finish validation. No larger stress test is justified until the packaged and organic checks finish.

## Focused evidence

- 25 focused unit tests passed, including finishing, source/result identity, float32 refusal, two cavity openings, tilted/mirrored placement, worker caching/revisions and .7 smoothing regressions; two opt-in fixtures skipped in that run.
- 14 Precision Mesh Studio integration tests passed; three opt-in fixtures skipped. Native analytic and STEP geometry remain separate and unchanged.
- Captured organic fixture: `.codex-run/organic-repro/hollowed-organic-manifold-fixed.stl`, explicitly decoded from manufacturing Z-up, cut at local Y=5.123 mm. 92,396 → 89,926 triangles, including 493 rim triangles, one opening, one connected material component, no boundaries/non-manifold edges/vertices/winding mismatches/degenerate/duplicate faces. Complete surface checks passed. Three tiny nonzero faces remain; the original acute-region thickness warning is retained. Kernel time approximately 0.58 seconds; validation approximately 5.11 seconds before the broad-phase optimization. No SDF was run.
- Synthetic flared closed hollow fixtures: 100k input → 90,500 output; 500k → 442,000 output (final values will be transcribed from retained reports). First-cut preparation/cut/validation measured separately. Before pruning, 500k source validation refused at the existing budget. After pruning it completed; no validation limit was raised.

Measurements, reports and original fixtures remain in `.codex-run/finishing8`. Timings are wall-clock observations, not guaranteed latency. Retained local triangle deviation is exhaustively zero before coordinate rebasing/encoding. Final float32 vertex rounding is measured separately and is not reported as exact geometry. World placement roundoff is tested below 1e-12 mm on tilted, mirrored, scaled fixtures.

## Release checkpoint

Branch: `codex/hollow-body-finishing`. Baseline: `538b102e` / release source `7d07188f`.
Recovery tag: `checkpoint-ultimate7-538b102e`.
Complete .7 application, installer, source ZIP and metadata: `.codex-run/preserved-ultimate7`.
Executable SHA256: `32f2ff6fbd5996296ffb71561a4f5a7e0e196d559720c86f1c9f2b4ae387914a`.
Installer SHA256: `4df40ece5bb061140e8396aad9d1fd2c786e6863efabf75cb4151f56d39f7f00`.

Target: `1.114.0-ultimate.8`. Executable and installer will be generated under `dist/ultimate/windows`. Existing installed release is preserved. No remote publishing or pushing is authorized.
