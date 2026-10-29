# Ultimate .9 execution checkpoint

Baseline 263fec0a; packaged source a2275206. Branch codex/high-speed-geometry-engine.
Rollback .codex-run/preserved-ultimate8 and tag checkpoint-ultimate8-263fec0a, verified installer/executable hashes.
User explicitly authorizes continuous implementation, verification and packaging; no push.

## Surgical context
- apps/web/src/lib/hollowFinishing.ts:19 source prepare; :82 cut; :299 complete validation
- apps/web/src/lib/manufacturingMesh.ts:24 indexing; :59 topology
- apps/web/src/lib/meshManufacturingQa.ts:133 BVH, self-intersections, containment and thickness
- apps/web/src/lib/triangleSharedContact.ts:14 exact shared-contact narrow phase
- apps/web/src/workers/hollowFinishing.worker.ts:39 source; :61 preview/cached reply
- apps/web/src/components/workplane/HollowFinishingPanel.tsx:185 demand-rendered view; :294 result installation
- desktop/validate-hollow-finishing.mjs:210 packaged acceptance and worker instrumentation

## Milestones
- [x] Preserve clean .8 baseline and captured fixtures.
- [x] Reproduce exact packaged organic /500k fixtures; profile stage costs and CPU before optimizing.
- [x] Implement highest-value safe optimization, compare correctness/geometry hashes, remeasure.
- [x] Responsive visual-only plane manipulation, precise final preview gate; resource/stale/cancel tests.
- [x] Final focused/package regressions, .9 executable/installer, report and local commits.

## State
COMPLETE. Runtime 62d9dfad56f3020dfc6d3300270660b01ce24aa4. Packaged UI-ready preview organic4.631→2.190s,500k22.981→8.562s; byte-identical applied F64 assets and unchanged complete QA. 55 focused/integration tests and78 packaged checks pass. 2M visual/cancel and20 repeated-cache probes pass;500k workflowpeakWS+6.1% reported. See HIGH_SPEED_GEOMETRY_ENGINE.md for exact evidence/paths/hashes/limits. .8 rollback preserved; no installed-app replacement or push.
