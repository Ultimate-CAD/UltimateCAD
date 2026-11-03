# Ultimate CAD master campaign — .16 Constrained Sketcher in progress

Current checkpoint: packaged .16 verified. Runtime da185c36d5602ed57e6a7017275a23e3dc13d10b; branch codex/constrained-sketcher-16. Earlier permission and reopening failures below are historical. Git metadata write probe succeeded. The packaging directory alone received the inheritable ALL APPLICATION PACKAGES read/execute grant. Prior directory DACL is recorded in .codex-run/sketch16/gui-package-acl-before.txt.

The corrected project transition wait passed. Reloaded source/constraints, zero DOF, dimensions, original identity and exact B-rep bytes matched. Independently reimported volume 30960.39560112742 mm� (expected 30960.395601127413). Standalone point sketch and solid coexist after reload. Cancellation intercepted the actual constrained CAD request, verified termination of that worker, confirmed unchanged B-rep and retried successfully. Two workstation AdGuard injector requests failed, zero external responses, zero renderer errors. Final packaged suite exit 0, 16 checks. Report: .codex-run/sketch16/packaged-2026-11-03T04-21-36.192Z/report.json. Existing focused .16 solver/persistence and packaged OpenSCAD, native and manufacturing regression evidence is recorded below.

Preserved .16 installer (283849035 bytes), unpacked application, legal/source and metadata under .codex-run/preserved-ultimate16. SHA256 installer ED241528204E56433321437DEBCFB0E38CFFA5E762359003A87CA70A82657A30, executable 67EA4CD1C8A63497D8A5006E1D3897B501B0C667C1989EC08C2C54661A5025D7. Existing installation and .13 rollback preserved. Use git rev-parse checkpoint-ultimate16-sketcher for verification revision. Next: .17 feature history. Later assembly, FEM, offline library, lithophane, optional GPU and final installation verification remain outstanding.

## Historical implementation record


Resume 2026-11-02 23:02 local: candidate packaged reopening harness race fix is in place; current 6 solver/OCCT tests, 47 persistence/worker tests and TypeScript pass. Packaged rerun is blocked before startup by Electron AppContainer directory read permissions; its requested read-only ACL grant was denied. .16 stays unverified. See the latest section of `docs/roadmap/CODEX_CONTINUATION.md` for exact evidence and rerun command. Do not disable Chromium sandboxing or advance the release ledger from source-test success.

The latest user directive (see `docs/roadmap/CODEX_CONTINUATION.md`) supersedes the earlier isolated-OpenVDB handoff. Continue autonomously through integrated, validated features in this order: **.16 Sketcher -> .17 Feature History -> .18 Assemblies -> .19 FEM -> .20 Offline Library/Migration -> .15 GPU evaluation -> final integrated verification**.

## Verified baseline and guardrails

- Branch: `codex/constrained-sketcher-16`, based on `9ab6ab7923d6750f3980cd76045a49ede17a3ea2`. The shared tree has active uncommitted .16 work; preserve it.
- Latest validated baseline remains .13 runtime `811ddc16936593e08a3c551565a374acf69bd800`, verification commit `7b7d49fe7fbc68f713fdb4ca6d1cec88b50af994`, installer SHA-256 `f9438e5435b8ea6e3c040ccb7cb6ad079e8bd1eb1e1599b34aedb8770b54cae8`. Rollback: `.codex-run/preserved-ultimate13`.
- .14 OpenVDB was evaluated and not adopted. It is closed; do not restart its benchmarks or integrate it without a demonstrated dependency.
- Do not push/publish or overwrite the installed app or preserved rollback artifacts. Keep all release validation offline and bundled.

## Current milestone: .16 Constrained Sketcher

Status: **in progress**. Six actual WASM/OCCT tests, 47 persistence/cancellation unit tests and 88 existing sketch/localization tests pass. Final typecheck and development editor save/reopen/Undo/cancellation/retry pass. Packaging remains pending. Do not mark .16 complete until the integrated save/edit/Undo/Redo/downstream-geometry flow passes in the packaged app.

PlaneGCS is pinned to `@salusoft89/planegcs` 1.3.0, Git `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7`, npm integrity `sha512-ugIkFCPnKRK1Yed+5297S/RmmfgEhIp5Xxx8PYhgfbcS+AxYV3chZ8LMGlEbEqrkbK6fwmNVLtEpLFq5KDl2lw==`. `scripts/stage-planegcs.mjs` verifies and stages the offline WASM dependency and required notices; no separately installed FreeCAD runtime is needed.

Implementation in progress includes new `constraintSketch.ts`, `constraintSketchShape.ts`, `constraintSketchWorker.ts`, `constraintSketch.worker.ts`, `ConstraintSketchWorkbench.tsx`/`.css`, `scripts/stage-planegcs.mjs`, and `tests/e2e/constraintSketch16.e2e.ts`, plus integration edits to editor/toolbar/rendering/OCCT wire/LYL persistence/types/locales/package staging. Preserve these shared changes.

### Next checks

After current integration edits settle, run focused scenario then typecheck:

```powershell
npm run test:e2e -- tests/e2e/constraintSketch16.e2e.ts
npm run typecheck
```

Fix failures and repeat. Use the six-hole circular mounting plate to verify constraints, dimensions, DOF/conflict diagnostics, editing, Undo/Redo, LYL save/reopen and downstream OCCT output. Before completing .16, package and test the actual application; release packaging requires committed, verified sources. Keep the installed app untouched at this checkpoint.

## Remaining sequence

- .17 Parametric Feature History: not started; editor snapshots are not a parametric feature graph.
- .18 Mechanical Assemblies: not started; retain separate components and persisted joints.
- .19 Local FEM: not started; include solver, mesh, boundary, residual/reaction and stale-result checks.
- .20 Offline Design Library and migration: not started.
- Additional Native Lithophane and Bas-Relief Designer: planned after .20, before .15. Flat offline PNG/JPEG/WebP with editable source/parameters, bounded cancellable generation, closed manifold geometry, backlit/3D preview and existing manufacturing export; validate flat before curved/cylindrical. Full acceptance is recorded in CODEX_CONTINUATION.md.
- .15 Bounded GPU evaluation: not started; last, with CPU comparison and fallback.
- Final integrated release verification: not started.

Detailed continuation and evidence are in `docs/roadmap/CODEX_CONTINUATION.md`. The campaign ledger `docs/roadmap/ULTIMATE_MASTER_ROADMAP.md` records the current campaign order and evidence.

# Historical private desktop identity and offline UI (.12)

User authorizes implementation, local commits and packaged validation; continue through milestones.

## Current surgical context
- `apps/web/src/config/productBranding.json`: single display/build definition; storage/protocol identifiers excluded.
- `apps/web/src/lib/productBranding.ts`, `i18n.ts:198-217`: brand display templates before user-value interpolation; preserve URLs/notices.
- `AppFooter.tsx:124+`, dashboard and SecondaryToolbar mastheads: private footer, local help/About and product name.
- `desktop/main.cjs:8-17,121-170`: display identity independent of existing profile/app ID; native local Help/About menu.
- `desktop/branding.cjs`, `stage-branding.mjs`, `stage-local-docs.mjs`, build scripts/config: shared identity, generated assets and local legal/source views.
- `desktop/validate-branding.mjs`: isolated packaged acceptance; existing OpenSCAD/native validators reused.

## Current milestones
- [x] Verify clean .11 checkpoint, preserve complete .11 package, create `codex/private-desktop-branding`.
- [x] Trace branding, public navigation, update hooks, documentation and compatibility identities.
- [x] Implement central definition, private UI/navigation and local legal/source access without geometry changes.
- [x] Focused branding/storage/serialization/help tests and type checking.
- [x] Commit runtime; build Windows package and validate branding, shortcuts, persistence, native workers, OpenSCAD and MCP offline.
- [x] Record evidence, final local commit, clean working tree; no push or installation over baseline.

## Current handoff
Complete: `Ultimate CAD`, release `1.114.0-ultimate.12`, runtime `b3ad46924c662be462fe471b9b231dace2f3a58c`. Single definition `apps/web/src/config/productBranding.json`. Internal executable, package/app IDs/storage/MCP/LYL unchanged. TypeScript and full Windows build pass; 123 focused tests pass with one inherited static-label scan excluded/documented; 16 branding + 22 OpenSCAD packaged checks pass, zero errors. Installer wizard title and temporary Windows shortcut tested. Acceptance `.codex-run/branding12/packaged-1793625240483`, OpenSCAD `packaged-openscad`; report `docs/desktop/PRIVATE_BRANDING.md`. Rollback `.codex-run/preserved-ultimate11` checksum unchanged. Existing installed app/profile and .11 geometry/export work are untouched. No push.

---

# Historical high-precision export reliability (.11)

User authorizes autonomous investigation, implementation, tests and packaging. Continue through milestones; do not stop at a planning-only handoff.

## Current surgical context
- `apps/web/src/lib/triangleSharedContact.ts:49-100`: no-shared narrow phase delegates to rounded-plane library predicate; shared-edge cases use orientation tests.
- `apps/web/src/lib/meshManufacturingQa.ts:205-269`: BVH candidate pairs, exact AABB rejection and shared topology; stops at first detected intersection.
- `apps/web/src/lib/stepExport.ts:540-601`: OCCT analytic tessellation, fidelity samples and numerical stitching.
- `apps/web/src/lib/precisionExport.ts:184-317`: exact source, optional repair, aspect/refinement, actual file-coordinate QA.
- `apps/web/src/lib/precisionMesh.ts:128-205`: conforming maximum-edge subdivision.
- `tests/e2e/analyticPlateExport.e2e.ts`: real Group seven-hole plate reproduction and stage captures.

## Current milestones
- [x] Preserve .10 and create dedicated local branch.
- [x] Reproduce failure and capture independent exact separation certificate.
- [x] Trace B-rep validity/face relationships and retain geometry fingerprints.
- [x] Replace confirmed unreliable narrow phase with robust orientation-based contact tests; keep defect gates.
- [x] Focused adjacent/coplanar/real-defect regression and High/Ultra/Custom/cache/export reimport tests.
- [x] Packaged Windows acceptance, documentation, local commit and clean tree.

## Current handoff
Complete: High + 1 mm maximum edge length, 353,884 triangles now passes without geometry changes. Triangle 4361/4369 was a confirmed coplanar false hit; exact BigInt projection proves disjointness. Focused integration: 17 passing, 3 optional tests skipped; unit: 13 passing; TypeScript and full Windows build pass. Packaged .11: 13 checks, zero errors, eight valid plate exports and both real-defect formats blocked. Runtime `cbbdeb2f16b735f63f1d777109174c9cf3e9c2b8`; acceptance `.codex-run/export11/packaged-1793617770339`. See `docs/performance/EXPORT_RELIABILITY.md` for measured fidelity, rollback and limits.

---

# Historical Ultimate .10 scientific adaptive geometry engine

User authorizes continued autonomous implementation through validation and packaging; this overrides the skill template's one-milestone stopping rule. Current desktop release plan below remains as historical context.

## .10 surgical context map
- `apps/web/src/lib/meshHollow.ts:24-165`: source validation, distance callback, domain/slabs, extraction, sampled error, Boolean.
- `apps/web/src/lib/meshSignedDistance.ts:12-130`: immutable face records and sign/distance BVH queries.
- `apps/web/src/lib/meshHollowWorker.ts:24-109`: copied input transport, cancellation and timeout.
- `tests/e2e/meshHollowBenchmark.e2e.ts:11-126`: profiling and retained organic fixture.
- `.codex-run/adaptive10/manifold/src/sdf.cpp:480-529`: encoded dense sample allocation.

## .10 milestones
- [x] Inspect clean baseline, verify .9 installer checksum, preserve .9.1, create dedicated branch.
- [x] A: establish reproducible focused baseline and sampling/resource measurements.
- [x] B: C++20 native query/hollowing proof of concept and dependency comparison.
- [x] C/D: integrate only validated native/adaptive improvements; retain fallback and safeguards.
- [x] E: geometry, exports, cancellation, crash and performance verification.
- [x] F: package only a stable verified release; otherwise retain an explicit development checkpoint.

## .10 state handoff
COMPLETE for the validated .10 scope. Runtime source 8decfb88690cb3072c9daed2a9c7dfcbad8b6377. 51 packaged checks pass (native UI, precision/OCCT/STEP, SCAD, 500k finishing). Final cavity delivery conditioning resolves numeric slivers/fans before cutting the unchanged source; all 4,812 original organic exterior triangles retained exactly. Organic 152.858 s → 7.499 s; million-triangle cone 22.082 s, independent sampled wall deviation 0.08017 mm. Raw STL/3MF topology passes; warnings retained. Cone intersection coverage remains incomplete and print-ready stays false. Aggregate memory target/full sparse storage/Bunny tiers remain unproved; CUDA deferred. Executable/installer and rollback paths/checksums in `docs/performance/ADAPTIVE_GEOMETRY_ENGINE.md`. No installer run against the working installed copy, no push. Evidence retained in `.codex-run/adaptive10`.

---

# Historical Windows desktop release

Upstream: b211101dd0650a7461318a3ef73253cf9f0a801b (1.114.0).
User authorization: implement, test, package and locally commit; continue through milestones.

## 1. Architecture
Electron hosts the original Next standalone production server in a managed utility process.
All runtime assets are local. A persistent per-user origin preserves IndexedDB/localStorage.
Loopback requests require a random per-launch secret. Existing authenticated MCP is retained.

## 2. SURGICAL CONTEXT MAP
- apps/web/next.config.ts:28-40 production build settings
- apps/web/src/app/api/layerling-mcp/route.ts:17-36 production bridge authorization
- apps/web/src/components/LayerlingEditor.tsx:11630-11670 editor bridge registration
- package.json:14-41 build/test scripts
- desktop/ new main process, server, packaging and validation scripts

## 3. Milestones
- [x] Inspect upstream and choose runtime architecture.
- [x] Implement desktop runtime, authenticated server and release staging.
- [x] Run upstream checks and build production assets.
- [x] Package executable, portable release and per-user NSIS installer.
- [x] Validate installed release, CAD, file operations, offline, persistence and MCP.
- [x] Finalize reports, licenses, source, checksums and local commits.

## 4. STATE HANDOFF
COMPLETE. Final runtime source commit 38c5c1008bac232eac28be89e6993bc49b8f5446.
Installed app: %LOCALAPPDATA%/Programs/Layerling Desktop/Layerling Desktop.exe.
Release artifacts: dist/windows. See docs/desktop/BUILD_REPORT.md and validation-final evidence.
