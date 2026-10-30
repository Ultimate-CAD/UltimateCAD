# Ultimate .10 scientific adaptive geometry engine

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
