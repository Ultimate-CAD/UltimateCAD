# Organic mesh hollowing checkpoint

Branch: codex/organic-mesh-hollowing. Base release: 8247044a.
The previous release improved CAD/planar geometry but still sent an organic OBJ
through faceted OCCT offsets, producing the reported cannot-hollow error.

Actual source captured read-only from the installed app's authenticated loopback
connection. Original OBJ child: 14772 triangles. Base-cut group: 4812 triangles,
47.578 x 39.387 x 120.45 mm. Private fixture/project are in .codex-run/organic-repro;
user geometry is not committed or sent elsewhere. The live project is unchanged.

## Implementation
- meshHollow.ts: validated Manifold input, BVH nearest distance and oriented-ray
  inside tests, Manifold marching tetrahedra, adaptive cavity resolution and
  memory-bounded overlapping slabs. Inward hollowing retains the original outside.
- meshHollowWorker.ts / meshHollow.worker.ts: dedicated cancellable worker,
  five-minute bound, progress messages, no blocking main-thread fallback.
- LayerlingEditor.tsx: mesh-only dispatch, exact CAD path retained, source/history
  snapshot, stable object ID, cancellation and stale-result guards.
- ShellPanel.tsx: explicit mesh accuracy, default closed cavity for mesh inputs.

Accuracy means sampled cavity surface deviation from the source-distance offset,
measured at vertices, edge midpoints and face centroids. It is not exact B-Rep or
a global analytical thickness certificate. Narrow features may remain solid;
secondary isolated cavity regions are omitted and counted. Flat base openings
are supported. Outward mesh hollowing currently requires a closed cavity.

## Milestones
- [x] Capture the actual failing model without modifying the live project.
- [x] Implement and test worker cancellation, progress, timeout and buffer ownership.
- [x] Add mesh/CAD dispatch, explicit mesh precision and source-preserving history.
- [x] Pass actual-model 2 mm hollowing and independent manufacturing checks.
- [ ] Verify save/reopen/Undo/Redo and packaged UI against the captured project.
- [ ] Preserve previous releases, commit locally and build the private installer.

Node proof on the actual captured model: closed 2 mm cavity, 0.223607 mm grid,
measured error 0.092865 mm, Manifold NoError, source volume 85465.3475 mm3,
hollow volume 24232.0634 mm3. The fine cavity is generated in six slabs.
Bounded cavity-only decimation reduced 1245576 cavity triangles to 45088 at
0.025 mm simplification, with the same measured maximum error. Outer source
geometry is retained. Packaged output/serialization verification follows.
No live project or installed application has been modified. Previous installer
is preserved at .codex-run/preserved-ultimate-precision.
