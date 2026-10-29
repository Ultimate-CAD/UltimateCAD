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
- [ ] Responsive visual-only plane manipulation, precise final preview gate; resource/stale/cancel tests.
- [ ] Final focused/package regressions, .9 executable/installer, report and local commits.

## State
Optimized predicates/typed vertex fans/canonical indexing; CPU-profiled preview 2.075s organic /8.823s 500k, both geometry hashes identical to baseline. Topology and intersection differential tests pass. Packed response and GPU cache reuse implemented. Interaction baseline and focused regressions precede the .9 package; no validation policy/resolution change.
