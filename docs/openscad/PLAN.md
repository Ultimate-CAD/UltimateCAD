# OpenSCAD workbench checkpoint

Branch: codex/openscad-parametric-engine. Baseline desktop: 469dcc17.
Private single-user workstation build; preserve dist/windows and installed Layerling Desktop.

## Architecture
Use a bundled native OpenSCAD 2021.01 CLI in a bounded, cancellable subprocess. The existing
Next authenticated loopback server brokers evaluation; geometry parsing uses the existing
geometry worker. SCAD source, overrides, expressions, presets and dependency snapshots live
in WorkplaneShape.openScad and therefore existing LYL project/history storage. Output is a
triangle mesh with explicit OpenSCAD provenance, never an exact OCCT B-rep.

## Surgical context map
- apps/web/src/lib/openScadServer.ts: isolated native evaluation/cache service
- apps/web/src/lib/openScadTypes.ts: persisted representation contract
- apps/web/src/lib/openScadClient.ts: stable SCAD-to-mesh boundary
- apps/web/src/lib/modelImport.ts: import dispatch
- apps/web/src/lib/lylProject.ts:759 serialization retains extra definition fields
- apps/web/src/components/LayerlingEditor.tsx:4350 history commit, 9529 MCP and 13441 UI
- desktop/main.cjs:40 resource/runtime environment

## Milestones
- [x] Inspect four upstream implementations; record source pins.
- [ ] Engine service + native cancellation, timeout and dependency-aware cache tests.
- [ ] Workbench controls, source editor, import, presets, history and MCP.
- [ ] Bundle native engine in a separate Ultimate installer and profile.
- [ ] Packaged end-to-end persistence, edits, export, offline and benchmark validation.

## State handoff
Native engine work and main UI integration are in progress. Existing desktop release copied
to .codex-run/preserved-desktop-release; no existing installation changed.
