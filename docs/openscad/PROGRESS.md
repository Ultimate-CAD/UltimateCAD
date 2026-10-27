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
- Prior full unit suite: 416 files / 3485 tests passed.
- Prior full integration suite: 68 files / 598 tests passed.
- Final targeted native suite: 10 tests passed, including a new forward-reference case:
  width declared before depth, depth overridden to 45, width equation depth*2, bounds 90x45x1.
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

Final release validation (2026-10-27):
- Existing package source commit: e21b44b01dd2f65ac98e94aa4e5c750fdde5bc1c.
- `npm run ultimate:validate` completed all 22 checks twice after the shutdown repair.
  Both launches in each run closed gracefully; no process-tree fallback was required.
- Controls, equations, presets, Undo/Redo, complete LYL roundtrip, direct source editing and
  stable object identity passed. Native Layerling and SCAD objects saved together.
- Manufacturing STL: 1928 finite triangles, volume 47706.957754 mm3, zero unmatched edges.
- Five unchanged regenerations all hit one geometry cache key. Malformed scripts, missing
  libraries, bundled MCAD dependency capture and canceled native renders passed.
- External network blocked; application launched with System32-only PATH and a nonexistent
  development OpenSCAD installation. Bundled engine and bundled MCP runtime passed.
- Current machine-readable evidence: dist/ultimate/windows/validation/results.json;
  regeneration-benchmark.json and shutdown-<runId>-<index>.jsonl are beside it.

Validator shutdown defect and repair:
- The old final `await app.close()` blocked before results.json was written, leaving an older
  failure report despite all functional checks passing. The managed server had already exited.
- Main-process tracing reproduced `before-quit -> will-prevent-unload`; the renderer's
  pending-autosave guard canceled the quit. One later graceful retry produced
  `before-quit -> will-quit`. No pending JavaScript dialog was present.
- The validator now retries graceful quit within a deadline, logs lifecycle events and
  always refreshes the report, including cleanup failures. A required fallback fails the run;
  it verifies the captured main PID, parent, executable and command before targeting its tree.
- Removed temporary preset/source diagnostic dumps and the fixed 2.5-second delay. Preset
  details are still opened explicitly; source comparisons normalize textarea newlines while
  geometry-change and identity assertions remain mandatory.

Release preservation:
- No packaged application code changed during this final repair; installer was not rebuilt.
- Installer: dist/ultimate/windows/Layerling-Ultimate-OpenSCAD-Setup-x64.exe.
  SHA256 ee32e2a317001029b3774f091d657abb30fcb88b412656e095954a9971cc48e5.
- Original Desktop setup/portable SHA256 values still match the preserved release manifest.
  Baseline tag desktop-v1-working remains at 469dcc172d485ce326924f13f9140759be50147c.
- Everything remains local and private; no publishing, push, upload or existing installation change.

Known expression-override limits:
- Forward-reference lowering is lexical substitution over main-source top-level assignments,
  not a replacement SCAD parser. It indexes the first assignment per name, not included-file
  declarations or nested scopes. Function-call names colliding with later global variables and
  advanced binding syntax are not fully modeled. Ordinary source remains native OpenSCAD.
- Saved user source is preserved separately; lowering changes only temporary evaluation source.
  OpenSCAD output remains tessellated mesh, separate from OCCT exact solids. A dimensional
  sketch solver and native parametric feature history remain separate future work.
