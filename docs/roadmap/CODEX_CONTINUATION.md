# Codex continuation checkpoint

Updated 2026-11-02 during .16 implementation. This record captures the live state; continue execution from it rather than stopping after this plan.

## User directive and ordered campaign

The current directive is `.codex/attachments/dc368f6a-81ac-4441-ba6a-a47be3176916/Pasted text.txt` (physical attachment: `C:\Users\Justin\.codex\attachments\dc368f6a-81ac-4441-ba6a-a47be3176916\Pasted text.txt`). It supersedes the earlier isolated-OpenVDB-only handoff. Continue through useful, integrated features in this order:

1. .16 Constrained Sketcher.
2. .17 Parametric Feature History.
3. .18 Mechanical Assemblies.
4. .19 Local FEM.
5. .20 Offline Design Library and Tinkercad migration.
6. Additional Native Lithophane and Bas-Relief Designer (flat first).
7. .15 Bounded GPU evaluation.
8. Final integrated release verification.

Do not push or publish. Preserve the installed application, personal files and rollback builds. The user authorizes reasonable implementation, tests, justified local dependencies, commits, packaging and autonomous progress between milestones.

## Current repository state

- Repository: `C:\Users\Justin\layerling-desktop`.
- Branch: `codex/constrained-sketcher-16`.
- Base/current HEAD at checkpoint: `9ab6ab7923d6750f3980cd76045a49ede17a3ea2`.
- The working tree contains active, uncommitted .16 changes from the root agent. Continue in place and preserve them; do not reset, revert or overwrite them.
- Latest validated baseline is the .13 runtime `811ddc16936593e08a3c551565a374acf69bd800`, verification commit `7b7d49fe7fbc68f713fdb4ca6d1cec88b50af994`, installer SHA-256 `f9438e5435b8ea6e3c040ccb7cb6ad079e8bd1eb1e1599b34aedb8770b54cae8`. Rollback copy: `.codex-run/preserved-ultimate13`; prior installer manifest: `dist/ultimate/windows/release-verification.json`.
- .14 OpenVDB was evaluated and not adopted. It is closed; do not restart its benchmarks or integrate it absent a demonstrated dependency.
- The master campaign ledger is `docs/roadmap/ULTIMATE_MASTER_ROADMAP.md`. Do not update it during this .16 checkpoint; the root agent will reconcile it after release.

## .16 status and evidence

Status: **in progress**. PlaneGCS core solver and development editor workflow pass, including save/reopen, Undo/Redo and injected CAD-worker stall cancellation/retry. Packaged validation is pending. Do not mark the milestone complete based on a solver wrapper, source presence or a standalone test.

The current validation artifact directory is `.codex-run/sketch16/`. `solver-tests.log` records 3 passing tests in `tests/e2e/constraintSketch16.e2e.ts`. `typecheck-current.log` is empty; it is not a successful typecheck record. `solver-probe.json` contains the focused solver probe. No packaged .16 verification has been completed.

PlaneGCS dependency state:

- npm package: `@salusoft89/planegcs` 1.3.0.
- Git source revision: `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7`.
- Pinned npm integrity: `sha512-ugIkFCPnKRK1Yed+5297S/RmmfgEhIp5Xxx8PYhgfbcS+AxYV3chZ8LMGlEbEqrkbK6fwmNVLtEpLFq5KDl2lw==`.
- `scripts/stage-planegcs.mjs` verifies the npm integrity and source archive hash and stages the WASM runtime and release notices. Keep the bundled notices/source obligations. No separately installed FreeCAD runtime is required by the staged WASM package.

Current implementation footprint (shared uncommitted worktree):

- New solver/model/worker modules: `apps/web/src/lib/constraintSketch.ts`, `constraintSketchShape.ts`, `constraintSketchWorker.ts`, and `apps/web/src/workers/constraintSketch.worker.ts`.
- New workbench: `apps/web/src/components/workplane/ConstraintSketchWorkbench.tsx` and `.css`.
- New focused scenario: `tests/e2e/constraintSketch16.e2e.ts`.
- New staging helper: `scripts/stage-planegcs.mjs`.
- Integration edits: `apps/web/src/components/LayerlingEditor.tsx`, `apps/web/src/components/workplane/SecondaryToolbar.tsx`, `apps/web/src/components/workplane/viewportShapeObjects.ts`, `apps/web/src/lib/editorMeshCore.ts`, `editorSketchCad.ts`, `sketchCadWire.ts`, `sketchSmoothHandles.ts`, `workplaneShapes.ts`, `lylProject.ts`, `apps/web/src/types/layerling.ts`, localized `messages.*.ts`, `.gitignore`, `desktop/build-ultimate.mjs`, `package.json`, and `package-lock.json`.

Use the six-hole circular mounting plate as the reference fixture. Validate point/line/circle/arc creation; coincident, concentric, horizontal, vertical, parallel, perpendicular, tangent and equal constraints; dimensional edits; degrees of freedom; conflict/redundancy diagnostics; interactive solving; undo/redo; LYL save/reopen; and downstream OCCT geometry. The sketch workbench must remain usable offline and compatible with existing projects.

## Next executable step

After the current integration edits settle, run the focused scenario, then typecheck:

```powershell
npm run test:e2e -- tests/e2e/constraintSketch16.e2e.ts
npm run typecheck
```

Fix any failures and repeat the focused checks. Then build and verify the packaged application, including sketch creation/edits, undo/redo, save/reopen and downstream OCCT geometry. `desktop/build-ultimate.mjs` requires a clean committed tree for release packaging; after the implementation is verified and checkpointed, create the unpacked Ultimate package with `npm run ultimate:release -- --dir`, then test it with:

```powershell
npm run desktop:test -- "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe"
```

Do not replace the installed app during this checkpoint. Record development tests, packaged-app tests and installation evidence separately. Do not label .16 complete until the functional workflow and packaged checks pass.

## Remaining work after .16

- .17 Parametric Feature History is **not started**. Editor snapshots are not a parametric feature graph. Implement persistent operation definitions, stable IDs, explicit dependencies, parameter expressions, incremental recomputation and repairable topology-reference errors; preserve last-known-good output on invalid edits.
- .18 Mechanical Assemblies is **not started**. Keep components independent and persist fixed/revolute/slider joints; do not fuse components to simulate an assembly.
- .19 Local FEM is **not started**. Prefer a justified bundled solver integration; verify mesh/boundary/load handling, residuals/reactions, convergence and result staleness.
- .20 Offline Design Library and migration is **not started**. Keep the local library useful without automated account retrieval.
- Native Lithophane and Bas-Relief Designer is **not started**, added by the user on 2026-11-02. Offline PNG/JPEG/WebP; flat luminance-driven thickness or surface elevation; dimensions/aspect lock, min/max thickness, gamma/brightness/contrast/inversion, sampling, smoothing/borders. Preserve original image and settings in LYL; interactive 3D/backlit preview, cancellable bounded generation and existing manufacturing-validated STL/3MF. Validate mapping/orientation/topology/dimensions/save-reopen/offline package. Reuse existing tools for frames, holes and stands. Curved/cylindrical only after flat validation; no new heavyweight engine/external-runtime requirement.
- .15 GPU evaluation is **not started** and stays last. Compare a bounded candidate with the CPU path including transfer, synchronization, memory, cancellation and numerical quality; retain CPU fallback.
- Final integrated release verification is **not started**. Recheck packaged workflows and offline behavior after the feature sequence.

Keep this continuation record and `PLAN.md` current at milestone boundaries and before interruption. If one capability is blocked, record evidence and continue independent work rather than stopping the entire campaign.
