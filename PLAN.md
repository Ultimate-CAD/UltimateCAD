# EXECUTION PLAN — .17 editable feature history

## 1. Objective and locked decisions

Continue from the validated .16 runtime da185c36d5602ed57e6a7017275a23e3dc13d10b and verification 7e2e01a3a69fa1e7e1f36d58c7efd4e7485800c2. Keep .16 rollback and installed application. The .17 branch is local and pre-release. Preserve exact constrained sketches and OCCT geometry. All future milestones, including the image workbench, remain in the master ledger.

Persist references by stable operation and role ID (and stable instance ID for patterns). A hole top rim is the shared edge of its producing wall face and supporting cap. Keep OCCT handles/hash values scoped to a single evaluation. Never select the nearest candidate when a reference is missing, split or ambiguous. Surface a repairable failure and retain last-good output. A cut result may be a compound; resolve the unique owning solid before calling fillet. Keep unaffected solids in the result.

## 2. Surgical context map

- apps/web/src/lib/featureEdgeLineage.ts — cutWithNamedFaces, resolveFeatureEdge; numerical implementation for the first cut/edge transaction. Release the evaluation arena at transaction end.
- tests/e2e/featureEdgeLineage.e2e.ts:4 — actual WASM regression for suppression and a fillet on the surviving hole.
- apps/web/src/workers/cadModifier.worker.ts:659 and :859 — transient display edge indices and existing local edge/owner mapping; retain for immediate edits.
- apps/web/src/lib/lylProject.ts:920, :1103, :1787 — derived descriptive features, writer, validation. Add authoritative history separately and require a new minimum reader only for projects containing it.
- apps/web/src/components/LayerlingEditor.tsx:4434 — worker lifecycle, source revision guard and atomic editor commit.
- apps/web/src/workers/sketchCad.worker.ts:46 — analytic region/face construction, extrusion, validity and tessellation.
- apps/web/src/lib/measurementUnits.ts:177 and fieldFormulas.ts:1 — existing scalar input math and units. Keep display-unit parsing separate from named dimension evaluation.

## 3. Milestone checklist

- [x] Validate runtime face correspondence for boolean holes, detect suppression, resolve unique incident edge and apply real fillet. One OCCT e2e test passes; TypeScript passes. This is a kernel slice, not a workbench.
- [ ] Author a real sketch-to-pad transaction in the editor. Define stable feature IDs, typed named length/angle/scalar expressions, AST reference extraction and deterministic topological order. Test diamond updates, replaced/removed dependencies, cycles, domain failures and blocked descendants. Last-good output must explicitly show stale status on failure.
- [ ] Build/edit the feature tree; save graph, variables, links, suppression and diagnostic/output states in project snapshots and LYL. Use the existing .16 sketch, worker and exact output. Test dimensions, stable ID, Undo/Redo, actual reopen and unchanged independent branches.
- [ ] Add pocket, revolve, hole, linear/circular patterns, fillet and chamfer. Label faces at feature creation. Verify split/merge ambiguity, invalidated roles and unaffected branches. Pattern references require a persistent instance identity.
- [ ] Package and verify .17 offline before updating release status. Continue .18, .19, .20, image workbench, optional bounded .15, then final isolated installer acceptance. No OpenVDB benchmarking.

## 4. State handoff

First executable geometry check: npm.cmd run test:e2e -- tests/e2e/featureEdgeLineage.e2e.ts. See .codex-run/feature17/edge-lineage-test.log and typecheck.log. Existing .16 package requires no rebuild for this branch. Next implementation is the integrated Sketch -> Pad graph with editable named depth; add persistence and application-level tests before treating it as delivered.
