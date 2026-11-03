# Constrained Sketcher (.16)

Status: implementation and focused tests pass; packaged acceptance is pending.

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
