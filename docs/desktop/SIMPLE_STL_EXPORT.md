# Ordinary STL export

Implemented on `codex/simple-stl-export`, following verified .21. Installed application, installer and rollback directories are unchanged; no installer build was run for this source change.

Export -> STL -> Export STL writes binary STL at Standard quality. Choose the destination during the click; existing linked-file / Save as behavior is retained. Download/server delivery and local MCP use the same worker-backed `exportStlDesign` implementation. UI and file header identify ordinary output as unverified.

| Preset | Requested OCCT deviation (mm) | Angular tolerance (degrees) |
| --- | ---: | ---: |
| Standard (default) | 0.1 | 15 |
| High | 0.025 | 8 |
| Ultra | 0.005 | 7.5 |
| Custom | positive user value | user value, >0 and <=90 |

These are meshing controls, not tolerance certification. Exact CAD surfaces are tessellated from source in one pass. Stored meshes keep their source detail. Exact geometry and project data are unchanged.

## Optional analysis

Precision Mesh Studio is inside collapsed Advanced / Analyze. Ordinary STL export runs no manufacturing audit, self-intersection check, wall-thickness check, deviation certification, smoothing or repair. `integrityPassed` and manufacturing verdicts do not participate in ordinary byte generation. Existing analysis/certification remains available when explicitly selected; its failures do not disable normal Export STL.

Existing visible-solid, group, overlap-union and loose-hole semantics are reused. Every resulting shell and tiny component is retained. Ordinary serialization retains zero-area and Float32-collapsed facets rather than conditioning them silently. When a mesh union fails, original surfaces are exported with an informational warning. Failed hole conversion is an actual conversion failure and never silently exports an uncut replacement. Missing/incomplete geometry, failed exact conversion, non-finite/unencodable coordinates, invalid indices, allocation errors or binary-format limits can still prevent a file.

## Verification - 2026-11-04

- TypeScript passed: `.codex-run/simple-stl/typecheck-final.log`.
- Full unit suite: 3557 passed, 7 existing skips: `.codex-run/simple-stl/unit.log`.
- Export/analytic/loose-hole regressions: 10 passed, 1 opt-in million-triangle benchmark skipped: `.codex-run/simple-stl/export-regression.log`. Includes unchanged optional analysis rejecting genuine crossings and High/Ultra/Custom analytic plate checks.
- Extended ordinary suite: 4 passed: `.codex-run/simple-stl/final-geometry.log`. Covers boxes/spheres/cylinders, groups, overlap-union volume, holes, multiple shells, tiny components, open/crossing/zero-area facets, source preservation, Custom high resolution and conversion errors. A projection guard fails if ordinary export attempts analytic deviation certification.
- Actual development-browser acceptance: `.codex-run/simple-stl/gui-1793854295035/report.json`, complete, zero renderer errors. Grouped box/cylinder default picker path: 204 triangles in 915 ms; independent reimport found zero boundary, non-manifold edge or vertex defects. Ultra download path: 512 triangles in 129 ms. Timings are warm development-workstation observations, not packaged performance guarantees. Custom 0.002 mm / 3 degrees produces 972 triangles; decimal-comma entry works. UI/MCP Standard and Custom outputs are byte-identical. No precision-analysis worker starts; Advanced remains accessible. The native picker is represented by a test handle to capture its write; actual download is also tested.
- On a 20 mm exact sphere, Standard/High/Ultra produce 1222/4218/19952 triangles. Independent maximum triangle-centroid distance from the sphere: 0.134116/0.040975/0.003807 mm. This verifies better curve fidelity; requested deflections are not certified bounds. `.codex-run/simple-stl/sphere-fidelity.json`.

Packaged .21 evidence remains historical for its original runtime. This follow-up is verified from source in browser/worker/MCP paths; a new packaged application was not generated or installed. No FEM source or installer configuration changed.
