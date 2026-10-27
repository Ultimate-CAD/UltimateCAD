# OpenSCAD integration checkpoint

Branch: codex/openscad-parametric-engine. Preserved baseline: 469dcc17.
Original release executables copied to .codex-run/preserved-desktop-release; original installed
Layerling Desktop and dist/windows executable artifacts remain untouched.

Completed implementation: native engine service and bounded queue/processes, dependency
snapshots/cache invalidation, parser reuse, SCAD mesh representation, LYL/history persistence,
source/parameter workbench with 700 ms regeneration, presets, source draft retention, import
dispatch, native selected-file path bridge and three additional MCP tools (77 total).

Executed checks:
- TypeScript passed repeatedly after implementation changes.
- Full unit suite: 416 files / 3484 tests passed after fixing numeric field conventions and
  adding all new MCP tools to the existing guide chapter lists. Additional orientation test passed.
- Full integration suite: 68 files / 597 tests passed, including eight new native CLI tests.
- Native expression-scope regression added: nine targeted native tests now pass.
- Production Next standalone build and Ultimate unpacked x64 packaging passed.
- Bundled engine version probe passed with System32-only PATH.
- Packaged dashboard import of the upstream parameterized box detected 18 Customizer controls,
  preserved the actual selected-file base directory, exposed 77 MCP tools, and regenerated a
  changed width without replacing the object ID. Parameter Undo/Redo passed.

Actual defects caught and repaired:
- Initial workbench selection could create a new object instead of editing a dashboard import;
  use an explicit selection or the only SCAD object as fallback.
- CLI -D expression overrides cannot reference root source variables in OpenSCAD 2021.01.
  Substitute override assignments by established scanner spans, then let OpenSCAD evaluate them
  in the original lexical scope. Preserve the original source separately and native line numbers.
- UI synchronization now distinguishes its own completed renders from external Undo/Redo, so
  a successful commit cannot cancel its own result/status update.
- Native process cleanup covers the complete managed server/render descendant tree on shutdown.

Next step: rebuild with the expression-scope repair, complete packaged end-to-end persistence,
manufacturing mesh/export, cache benchmark, cancellation and coexistence checks; create and
validate the separate private Ultimate installer.
