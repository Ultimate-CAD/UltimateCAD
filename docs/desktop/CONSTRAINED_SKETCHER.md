# Constrained Sketcher (.16)

Current checkpoint: packaged .16 verified. Runtime da185c36d5602ed57e6a7017275a23e3dc13d10b; branch codex/constrained-sketcher-16. Earlier permission and reopening failures below are historical. Git metadata write probe succeeded. The packaging directory alone received the inheritable ALL APPLICATION PACKAGES read/execute grant. Prior directory DACL is recorded in .codex-run/sketch16/gui-package-acl-before.txt.

The corrected project transition wait passed. Reloaded source/constraints, zero DOF, dimensions, original identity and exact B-rep bytes matched. Independently reimported volume 30960.39560112742 mm� (expected 30960.395601127413). Standalone point sketch and solid coexist after reload. Cancellation intercepted the actual constrained CAD request, verified termination of that worker, confirmed unchanged B-rep and retried successfully. Two workstation AdGuard injector requests failed, zero external responses, zero renderer errors. Final packaged suite exit 0, 16 checks. Report: .codex-run/sketch16/packaged-2026-11-03T04-21-36.192Z/report.json. Existing focused .16 solver/persistence and packaged OpenSCAD, native and manufacturing regression evidence is recorded below.

Preserved .16 installer (283849035 bytes), unpacked application, legal/source and metadata under .codex-run/preserved-ultimate16. SHA256 installer ED241528204E56433321437DEBCFB0E38CFFA5E762359003A87CA70A82657A30, executable 67EA4CD1C8A63497D8A5006E1D3897B501B0C667C1989EC08C2C54661A5025D7. Existing installation and .13 rollback preserved. Use git rev-parse checkpoint-ultimate16-sketcher for verification revision. Next: .17 feature history. Later assembly, FEM, offline library, lithophane, optional GPU and final installation verification remain outstanding.

## Historical implementation record


Status: validated, including 16 packaged GUI checks.

Open **Constrained Sketcher** in the editor toolbar. The initial six-hole mounting plate is a fully constrained example. Change Plate radius, Bolt circle radius, Hole radius or extrusion depth, then choose **Build solid**. The result is an analytic OpenCascade body, with the editable sketch retained. Reopening the sketch and rebuilding replaces the same object, preserving its ID. The regular editor Undo/Redo restores committed bodies and their source. Sketch-local Undo/Redo changes the uncommitted draft.

**New sketch** creates an empty draft. Add points, lines, circles and arcs in Geometry, then add constraints. Geometry marked Construction participates in solving but does not bound a solid. Save sketch preserves planar geometry without inventing a solid; Build solid requires closed, valid regions. Existing CAD operations accept a built solid through the existing OCCT boundary. Lengths are millimeters, persisted angular dimensions are degrees; reported angular residuals are radians.

The workbench reports degrees of freedom, conflicting constraint IDs, redundant IDs and independently checked residuals. Underconstrained sketches may be saved or built if the current regions are valid. Invalid dimensions, solver failures and failed solid builds retain the last committed body. Closing the panel or cancelling a build terminates the active work; solver jobs have a 20-second deadline. The existing sketch CAD worker enforces its own build deadline. Controls lock during a commit to prevent a pending build from overtaking another draft edit.

## Local engine and preservation

The solver is established FreeCAD PlaneGCS through pinned `@salusoft89/planegcs` 1.3.0, source commit `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7`. The WASM runtime is 484,003 bytes (SHA-256 `af9d1874fc895726bd267703a698a86c82d35b7415a02fe5184ebf65ddbc04af`) and runs in isolated local browser workers. No external FreeCAD, compiler, Python, MCP service or network connection is required by this solver at runtime.

`scripts/stage-planegcs.mjs` verifies pinned npm integrity, source archive and WASM hashes. Release packaging retains the actual license, package metadata declarations, original npm archive and pinned upstream source archive. The upstream npm metadata says LGPL-2.0-or-later; the included license and source declarations are preserved separately rather than treating those strings as identical.

Constraint source and exact circular-arc construction metadata survive LYL save/reopen. Projects using this capability require reader format 5, preventing older readers from silently dropping constraints or displaying a planar sketch as a placeholder solid. Projects without the new data continue to use their prior format. Internal package names, file identifiers, IPC, storage paths and the existing native backend remain unchanged.

## Verification

Focused artifacts: `.codex-run/sketch16/`.

- `solver-final.log`: six actual PlaneGCS WASM/OCCT tests. Full plate solves with zero DOF; radius/pitch/hole changes preserve IDs. OCCT volume agrees with the analytic plate formula within `1e-6 mm³`. Arc/line closed profiles use real circular edges; the circular segment volume also meets `1e-6 mm³`.
- `unit-final.log`: 47 tests for persistence, legacy projects, reader gating and worker cancellation/deadline/late-result handling. Worker deadline tests use a simulated stalled worker; actual WASM solves are exercised separately.
- `ui-regression.log`: 88 localization and existing sketch-profile/deflection tests.
- Development and packaged workflow reports are produced by `desktop/validate-sketcher16.mjs`; a development pass is not a packaged pass.

Initial scope uses the existing base sketch plane and existing CAD operations. It does not implement the .17 authoritative feature graph, assemblies or FEM. Locale catalogs contain explicit English fallbacks for the new controls; translated catalogs remain otherwise intact. Solver residual checks are numerical constraint checks, not a manufacturing certificate or physical-fit guarantee.
