# Ultimate .8 Hollow-Body Finishing

Completed and packaged as **1.114.0-ultimate.8**, validated on 2026-10-29. Ready for regular use on the supported closed mesh workflows below. A successful finishing operation is not a blanket printing certificate: sampled wall concerns remain visible and prevent Precision Mesh Studio from marking a body print-ready.

Select one unlocked imported mesh, choose **Open Hollow Base**, adjust the local axis, position and retained side, then **Preview → Apply**. Orange shows removed material during plane adjustment; the validated result displays its rim in gold. Preview faces the opening so a bottom rim is visible without manually orbiting underneath. Moving the plane invalidates Apply immediately. Cancel preview terminates its worker; Cancel leaves the document unchanged. Apply uses the existing object identity and one Undo transaction. The result uses the existing lossless LYL mesh asset and STL/3MF pipelines.

## Geometry and safeguards

The double-precision clipping kernel reuses each crossing by its original undirected edge identity. Unaffected retained triangles and coordinates are copied exactly. Directed planar boundary edges become closed contours; nesting and winding classify material and cavity loops. The bundled Manifold polygon triangulator creates the planar rim with holes. This operation does not recompute SDF hollowing, reconstruct a surface, simplify, smooth, thicken, or repair the source.

Only one connected material body is accepted. Multiple cavity openings are supported when nesting, orientation and final topology are consistent. Coplanar faces, touching/branching contours, missed cavities, float32 collapse, disconnected results, or remaining sealed cavities produce explicit refusals. The UI operates on local, unrotated axes; existing rotation and mirrors are preserved when the result is rebased to its actual bounds. New dimensions and location are computed together to retain world position.

Apply requires closed edge/vertex-manifold topology, consistent winding, no duplicate/degenerate faces, positive reduced volume, expected solid-component count, complete applicable self-intersection checking and shell-containment probes. Both the cut mesh and its final transformed float32 manufacturing coordinates are checked. Thickness is the existing sampled normal-ray diagnostic, not a certified global minimum; warnings are displayed without changing the geometry.

The existing 30-second / 5-million candidate surface-check limits remain. A conservative broad-phase improvement rejects strictly disjoint double-precision triangle bounding boxes before the narrow-phase candidate budget. This duplicates the existing narrow-phase rejection earlier; it does not ignore shared-vertex or shared-edge pairs. Incomplete checking still blocks Apply.

## Responsiveness and resources

Plane dragging updates clipping uniforms and a plane quad, without clipping or validating the full mesh. Preview runs in a dedicated worker. The source topology and completed source surface validation are reused. The last fully validated cut is cached by exact settings. A 180-second request timeout terminates the worker; stale replies are rejected by session identity and revision. Worker memory, preview buffers, WebGL resources and context are released when closing the tool. The isolated viewport draws only on camera, geometry or size changes; .7 Smooth Mesh and main viewport code are unchanged.

Input budget is 2 million triangles, checked before worker mesh allocation/indexing and viewport construction. The 100k and 500k deterministic performance tests are representative resource checks; they do not imply every geometry at that size will finish validation. No larger stress test was needed: the 500k run exercised dense contours, complete validation, history, serialization and both export formats without approaching the workstation's RAM capacity.

## Focused evidence

- **30 focused tests passed**, including the organic and 100k/500k opt-in fixtures; no skips in the final focused run. Coverage includes all three axes, both retained directions, a plane through an existing vertex ring, a near-cavity-end plane, genuine thin-wall warnings, float32-collapse refusal, two cavity openings, missed/coplanar/empty cuts, invalid input, tilted/mirrored/scaled world placement, exact retained geometry, worker caching/revisions and .7 smoothing regressions.
- **15 integration tests passed**: 14 existing Precision Mesh Studio tests and one new finishing → lossless LYL → Precision STL/3MF → independent topology check. Three unrelated optional Precision fixtures were skipped. Native analytic and STEP tests passed without changes to their geometry paths.
- **68 packaged checks passed, zero reported renderer or acceptance errors**: four finishing runs × 8 checks, 3 smoothing checks, 11 native/organic/precision export checks, and 22 SCAD checks. Every finishing run verifies cancellation actually terminates the active worker, stale preview invalidation, identical-preview caching, same-ID Apply, three Undo/Redo cycles, distinct-project LYL reopen, independent STL/3MF topology audits and editor reimport. The packaged app used a System32-only PATH with external requests blocked; no development runtime was needed.
- Captured organic source SHA256: `10ed4ed5f04d4332583f710d33859074606517ac67660f165ff6adcb6983de18`. The original `.codex-run/organic-repro/hollowed-organic-manifold-fixed.stl` was explicitly decoded from manufacturing Z-up into a **new** `.codex-run/finishing8/organic-upright.lyl`. The legacy STL orientation heuristic would otherwise place this particular file on its side. Original files were not edited. The obsolete 171,914-triangle LYL with known defects was not used as a valid source.
- Organic cut: local Y=5.123 mm, 92,396 → 89,926 triangles, 493 rim triangles, one opening and one connected material component. No boundary edges, non-manifold edges/vertices, winding mismatches, degenerate or duplicate faces. Complete applicable double and float32 surface checks found no intersections. Three tiny **nonzero** faces remain; nothing was silently removed or repaired. No SDF operation was run.

## Measured packaged performance

Wall times below come from actual worker messages in the final packaged application. Preview round trips end when the worker result arrives; they exclude installing buffers in the viewport. Cached timings include packing/transferring the cached result and repeat no geometry or surface calculations. Initial validation includes the original surface; later different cuts reuse that completed source check.

| Fixture | Input → output triangles | Rim triangles | Init → ready | First preview | Geometry / validation | Identical cached preview | Peak app process working set |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Closed cylinder | 512 → 768 | 256 | 61 ms | 121 ms | 7 / 103 ms | 6.7 ms | 303 MiB |
| Captured organic | 92,396 → 89,926 | 493 | 412 ms | 4,570 ms | 544 / 3,982 ms | 9.4 ms | 1,187 MiB |
| Closed flared 100k | 100,000 → 90,500 | 1,000 | 429 ms | 4,341 ms | 489 / 3,797 ms | 5.7–6.4 ms | 1,026 MiB |
| Closed flared 500k | 500,000 → 447,000 | 2,000 | 2,507 ms | 22,765 ms | 4,482 / 18,116 ms | 14.0–14.1 ms | 3,115 MiB |

Memory values are the highest process working set reported by Electron across the complete acceptance workflow, including save/reopen and exports. They are not GPU VRAM or the summed working sets of all processes. Standalone kernel benchmarks additionally record Node peak RSS and before/after heap/array-buffer data in `.codex-run/finishing8/benchmark.json`; those process peaks are upper bounds spanning multiple fixture checks. Timing varies with geometry, JIT, sampling and other machine work.

Before conservative triangle-box pruning, the 500k source exhausted the existing candidate budget and was correctly refused. It now passes complete applicable checks with the same limits. There is no matched timing for the former improvised Boolean workflow, so no general before/after speedup is claimed. Re-hollowing would be a different operation and was not used as a performance baseline.

The .7 100k Smooth Mesh benchmark reached Ready in **613, 555 and 576 ms**, within the prior 560–630 ms range. All three sessions succeeded; brush selection latency at the harness level was 64.6 ms and no errors were recorded. Observed rAF delivery was about 144 Hz, versus the old test's 165 Hz display state; FPS values are therefore not a matched comparison. Main viewport and Smooth Mesh production code were not modified. The first smoothing regression's test shutdown was blocked by its unsaved-project unload handler; its isolated process tree was cleaned up and the harness was corrected to allow unload only after recording results. The final smoothing run closed normally.

## Fidelity, dimensions and manufacturing results

An independent exhaustive face-membership check verifies every source triangle wholly on the retained side still exists with identical coordinates and orientation. The organic check covers **88,698 triangles**, with **0 mm** retained-triangle displacement. The 100k/500k checks cover **88,000 / 442,000 triangles**, likewise unchanged; this is not just a vertex sample. This comparison excludes deliberately removed geometry and the newly created planar rim.

Final manufacturing vertex-rounding displacement was measured exhaustively: cylinder 0.000001153 mm, organic 0.000001966 mm, 100k 0.000001101 mm, 500k 0.000001079 mm. These are vertex encoding measurements, not certified analytic-surface error bounds. Intersection coordinates are computed in double precision; no global symbolic roundoff proof is claimed. World placement roundoff is tested below 1e-12 mm on the deterministic tilted, mirrored, scaled fixtures.

| Fixture | Result dimensions, local XYZ mm | STL bytes / 3MF bytes | Export material volume mm³ |
| --- | --- | ---: | ---: |
| Cylinder | 20 × 16.9 × 20 | 38,484 / 8,642 | 2,309.754 |
| Organic | 47.578 × 115.327 × 38.616 | 4,496,384 / 1,207,380 | 21,155.868 |
| 100k | 27.574 × 16.877 × 27.572 | 4,525,084 / 798,223 | 3,165.037 |
| 500k | 27.574 × 16.877 × 27.574 | 22,350,084 / 3,489,086 | 3,165.279 |

Each independent exported-file audit found zero boundary/non-manifold edges, non-manifold vertices, winding mismatches, duplicate or degenerate faces, with positive finite volume. Counts match the actual result triangles. STL and 3MF volumes agree within encoding precision. The cylinder's material volume also matches the independently calculated polygonal cylinder-minus-cavity volume.

Precision Mesh Studio marks the cylinder ready. It deliberately leaves the other three cases **not print-ready**, retaining sampled thickness warnings of approximately 0.0002 / 0.0107 / 0.0842 mm against the 0.8 mm threshold. Acute opening regions can dominate a normal-ray sample; this diagnostic is not a certified global minimum wall thickness. These warnings were neither disabled nor removed, and no geometry was thickened. Their exports were tested as reviewed geometry with concerns, not presented as automatically print-ready output.

## Evidence and limits

Final accepted report folders under `dist/ultimate/windows/`:

- `finishing8-final-synthetic`
- `finishing8-final-organic`
- `finishing8-final-100k-warning`
- `finishing8-final-500k-accepted`
- `finishing8-smoothing-regression-clean`
- `finishing8-precision-regression`
- `finishing8-scad-regression`

Each contains `results.json`; finishing folders also include `measurements.json`, `mesh-audits.json`, saved projects, actual exported files and screenshots. Earlier diagnostic/harness attempts are retained separately and excluded from the 68 accepted checks. `.codex-run/finishing8` retains standalone fixtures, comparison evidence and performance reports. `.codex-run/finishing8/viewport-regression` retains the measured interaction regression.

Unsupported or ambiguous cuts fail without editing the source. The tool supports local axis-aligned planes, one material body and safely classifiable contours. It does not offer arbitrary tilted planes, explicit selection among sealed cavities, automatic mesh repair, a thickness certificate, or a new parametric feature-history system. Two-million-triangle input support is a resource ceiling, not a guaranteed completion time. Complete applicable validation can refuse difficult meshes at any size. Existing exact OCCT, SCAD, hollowing and viewport engines remain separate.

## Release checkpoint

Branch: `codex/hollow-body-finishing`. Baseline: `538b102e` / release source `7d07188f`.
Recovery tag: `checkpoint-ultimate7-538b102e`.
Complete .7 application, installer, source ZIP and metadata: `.codex-run/preserved-ultimate7`.
Executable SHA256: `32f2ff6fbd5996296ffb71561a4f5a7e0e196d559720c86f1c9f2b4ae387914a`.
Installer SHA256: `4df40ece5bb061140e8396aad9d1fd2c786e6863efabf75cb4151f56d39f7f00`.

Feature commit: `bd87731ba0101259793f1c2159653530c1693a67`.
Final packaged runtime source: `a227520661a90f545c8a6542320aee40d27825d4` (opening camera and early resource guards).
Subsequent local changes are validation/report files only. `release-metadata.json` and the accompanying source ZIP identify the packaged runtime checkpoint.

Executable: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\win-unpacked\Layerling Ultimate.exe`.
SHA256: `81662c6f695c5ab5f86665f70e15ae027469c44da58e8dcc3c682c957e75ccb4`.
Installer: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\Layerling-Ultimate-OpenSCAD-Setup-x64.exe`.
Size: 212,800,198 bytes. SHA256: `47bc147e5ab5d6586a18b82ff3024898286320c254810eafd938a77304dbc144`.
Source archive: `dist/ultimate/windows/sources/Layerling-Ultimate-Source.zip`.

The complete packaged application directory is required with the executable. The host EXE hash alone does not fingerprint the external runtime assets; installer hash and source provenance identify the release. The final installer was generated; acceptance ran against its packaged application payload without replacing the working installed release. No push or publication was performed.
