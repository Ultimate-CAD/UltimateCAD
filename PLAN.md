# Master campaign — .13 dense manufacturing certification

User authorizes ordered engineering releases through implementation, tests, independent verification and packaging, then later milestones while resources permit. Do not stop at a proposal. Master record: `docs/roadmap/ULTIMATE_MASTER_ROADMAP.md`.

## Current surgical context
- `apps/web/src/lib/meshManufacturingQa.ts:133-291,292-371`: paired BVH traversal, exact bounds, robust contacts, budgets, shell/thickness checks and result.
- `apps/web/src/lib/triangleSharedContact.ts:31-120`, `robustTriangleIntersection.ts`: .11 robust predicates and shared-simplex handling; retain correctness.
- `apps/web/src/lib/geometryTiming.ts`: opt-in per-stage profiling; no per-triangle logging.
- `apps/web/src/lib/precisionExport.ts:300-450`, `precisionExportWorker.ts`: encoded-coordinate checks, readiness, isolation/deadline/cancel.
- Saved cone/native source/build/test paths: audit in progress; record exact repeatable validation-only command in master roadmap.

## Current milestones
- [x] Verify clean .12 source/config/artifact hashes and recorded packaged evidence; preserve complete .12 rollback; create branch.
- [x] Read campaign and create master roadmap with A–H status/dependencies/recovery actions.
- [x] Profile saved cone and small correctness fixtures; research established acceleration/contact implementations.
- [x] Implement bounded scalable checks and explicit verified/inconclusive/cancel/error outcomes without changing geometry or weakening checks.
- [x] Obtain defensible independent dense-cone verdict; plate, intentional intersections, STL/3MF, worker cancellation/resource regressions; practical inherited i18n fix.
- [x] Runtime commit, .13 Windows package, offline packaged validation, report/verification commit and preserved rollback.
- [ ] Continue B in dependency order with isolated prototype and measured acceptance; maintain later statuses honestly.

## Current handoff
Validated .13 runtime `811ddc16936593e08a3c551565a374acf69bd800`; 30 unit tests, 23 integration tests (three old optional skips), TypeScript, Windows build and 59 packaged checks pass. Independent CGAL confirms cached native/STL/3MF and actual downloaded 3MF complete with zero contacts. Surface verdict is scoped; 0.028632 mm wall concern keeps ready=false. Imported placement Float32 loss is diagnosed and STL blocked; 3MF retains geometry. Public BVH range traversal reduces cached STL surface check 3.953→3.244 s with identical counts/hashes. Full rollback `.codex-run/preserved-ultimate13`; .12 preserved separately. Current manifest `dist/ultimate/windows/release-verification.json`. Next B: isolated OpenVDB native prototype, identical-input accuracy/memory/time comparison before integration. Main report `docs/performance/DENSE_MANUFACTURING_CERTIFICATION.md`; campaign master roadmap records A–H states. Installed app untouched; no push.

---

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
