import {
  BufferGeometry,
  BufferAttribute,
  Vector3,
  Ray,
  DoubleSide,
  Matrix4,
} from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { StlExportMesh } from "@/lib/stlExport";
import { indexManufacturingMesh } from "@/lib/manufacturingMesh";
import { intersectsOverlappingTrianglesBeyondSharedContact } from "@/lib/triangleSharedContact";
import { startGeometryTiming, withGeometryTiming } from "@/lib/geometryTiming";

function acceleration(mesh: StlExportMesh) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(Float64Array.from(mesh.vertices.flat()), 3),
  );
  geometry.setIndex(mesh.faces.flat());
  return { geometry, bvh: new MeshBVH(geometry, { indirect: true }) };
}
export function sampledMeshDeviation(from: StlExportMesh, to: StlExportMesh) {
  const { geometry, bvh } = acceleration(to),
    q = new Vector3();
  let max = 0,
    samples = 0,
    normalDeg = 0;
  try {
    const check = (p: readonly number[]) => {
      q.set(p[0], p[1], p[2]);
      const hit = bvh.closestPointToPoint(q);
      if (hit) max = Math.max(max, hit.distance);
      samples++;
    };
    const stride = Math.max(1, Math.ceil(from.faces.length / 100000));
    for (let i = 0; i < from.faces.length; i += stride) {
      const p = from.faces[i].map((i) => from.vertices[i]);
      p.forEach(check);
      const center = [0, 1, 2].map((j) => (p[0][j] + p[1][j] + p[2][j]) / 3);
      check(center);
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ])
        check(p[a].map((v, j) => (v + p[b][j]) / 2));
      const hit = bvh.closestPointToPoint(
        q.set(center[0], center[1], center[2]),
      );
      if (hit) {
        const r = to.faces[hit.faceIndex].map((i) => to.vertices[i]);
        const normal = (p: readonly (readonly number[])[]) =>
          new Vector3(
            p[1][0] - p[0][0],
            p[1][1] - p[0][1],
            p[1][2] - p[0][2],
          ).cross(
            new Vector3(
              p[2][0] - p[0][0],
              p[2][1] - p[0][1],
              p[2][2] - p[0][2],
            ),
          );
        const a = normal(p),
          b = normal(r);
        if (a.lengthSq() && b.lengthSq())
          normalDeg = Math.max(
            normalDeg,
            (Math.acos(
              Math.min(1, Math.abs(a.dot(b) / a.length() / b.length())),
            ) *
              180) /
              Math.PI,
          );
      }
    }
    return { mm: max, samples, normalDeg };
  } finally {
    geometry.dispose();
  }
}
export function smoothManufacturingMesh(
  input: StlExportMesh,
  strength: number,
  sharpAngleDeg: number,
  maxDeviationMm: number,
) {
  if (!strength) return input;
  const { vertices, faces } = indexManufacturingMesh(input),
    neighbors = vertices.map(() => new Set<number>()),
    edges = new Map<string, { triangles: number[] }>();
  const normals = faces.map((f) => {
    const [a, b, c] = f.map((i) => new Vector3(...vertices[i]));
    return b.sub(a).cross(c.sub(a)).normalize();
  });
  faces.forEach((f, i) => {
    for (const [a, b] of [
      [f[0], f[1]],
      [f[1], f[2]],
      [f[2], f[0]],
    ]) {
      neighbors[a].add(b);
      neighbors[b].add(a);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`,
        e = edges.get(key) ?? { triangles: [] };
      e.triangles.push(i);
      edges.set(key, e);
    }
  });
  const pinned = new Set<number>();
  for (const [key, e] of edges)
    if (
      e.triangles.length !== 2 ||
      normals[e.triangles[0]].angleTo(normals[e.triangles[1]]) >
        (sharpAngleDeg * Math.PI) / 180
    )
      key.split(":").forEach((v) => pinned.add(+v));
  const result = vertices.map((p, i) => {
    if (pinned.has(i) || !neighbors[i].size) return p;
    const q = [0, 0, 0];
    for (const j of neighbors[i])
      p.forEach((_, k) => (q[k] += vertices[j][k] / neighbors[i].size));
    const delta = q.map((v, k) => (v - p[k]) * strength),
      len = Math.hypot(...delta),
      factor = Math.min(1, maxDeviationMm / 4 / (len || 1));
    return p.map((v, k) => v + delta[k] * factor) as [number, number, number];
  });
  return { vertices: result, faces };
}

/** Bounded BVH check; shared pairs are checked beyond the common simplex. */
export function manufacturingSurfaceChecks(
  mesh: StlExportMesh,
  checkIntersections: boolean,
  minWallMm: number,
  shellSeeds: { position: number[]; normal: number[] }[] = [],
) {
  return indexedSurfaceChecks(
    indexManufacturingMesh(mesh),
    checkIntersections,
    minWallMm,
    shellSeeds,
    mesh,
  );
}

/** Only for a fresh canonical index owned by the calling geometry operation. */
export function manufacturingIndexedSurfaceChecks(
  mesh: StlExportMesh,
  checkIntersections: boolean,
  minWallMm: number,
  shellSeeds: { position: number[]; normal: number[] }[] = [],
) {
  return indexedSurfaceChecks(
    mesh,
    checkIntersections,
    minWallMm,
    shellSeeds,
    mesh,
  );
}

function indexedSurfaceChecks(
  indexed: StlExportMesh,
  checkIntersections: boolean,
  minWallMm: number,
  shellSeeds: { position: number[]; normal: number[] }[],
  mesh: StlExportMesh,
) {
  const { geometry, bvh } = withGeometryTiming("surface.bvh", () =>
      acceleration(indexed),
    ),
    started = performance.now();
  // Leaf BVH boxes overlap for many triangle pairs whose exact boxes are disjoint.
  // Reject those pairs before shared-contact allocation and the candidate budget.
  // This is the same strict separation already checked by the narrow phase.
  const endBounds = startGeometryTiming("surface.bounds");
  const triangleBounds = new Float64Array(
    checkIntersections ? indexed.faces.length * 6 : 0,
  );
  if (checkIntersections)
    indexed.faces.forEach((face, i) => {
      const [a, b, c] = face.map((j) => indexed.vertices[j]);
      for (let axis = 0; axis < 3; axis++) {
        triangleBounds[i * 6 + axis] = Math.min(a[axis], b[axis], c[axis]);
        triangleBounds[i * 6 + axis + 3] = Math.max(a[axis], b[axis], c[axis]);
      }
    });
  endBounds();
  let pairs = 0,
    boundsRejectedPairs = 0,
    intersections = 0,
    complete = checkIntersections,
    minSampledThicknessMm = Infinity,
    thicknessSamples = 0;
  const intersectionFaces: number[][] = [];
  // Refinement increases legitimate local contacts even on a simple analytic
  // surface. Scale coverage with mesh size; retain hard work/time bounds and
  // keep readiness false whenever the search cannot complete.
  const candidatePairBudget = Math.max(
    5_000_000,
    Math.min(50_000_000, indexed.faces.length * 32),
  );
  const notes: string[] = [];
  let shellOrientationConcerns = 0;
  // Borrow canonical coordinate tuples; these scratch lists are consumed synchronously.
  // Avoid millions of transient point arrays, coordinate strings and Sets per validation.
  const triangleA = new Array<readonly [number, number, number]>(3);
  const triangleB = new Array<readonly [number, number, number]>(3);
  const shared: (readonly [number, number, number])[] = [];
  try {
    const endIntersections = startGeometryTiming("surface.intersections");
    if (checkIntersections)
      bvh.bvhcast(bvh, new Matrix4(), {
        intersectsTriangles: (a, b, i, j) => {
          if (i >= j) return false;
          const ti = bvh.resolveTriangleIndex(i),
            tj = bvh.resolveTriangleIndex(j);
          for (let axis = 0; axis < 3; axis++) {
            if (
              triangleBounds[ti * 6 + axis + 3] <
                triangleBounds[tj * 6 + axis] ||
              triangleBounds[tj * 6 + axis + 3] < triangleBounds[ti * 6 + axis]
            ) {
              boundsRejectedPairs++;
              // Enforce the time budget even when a dense broad phase is disjoint.
              if (
                (boundsRejectedPairs & 4095) === 0 &&
                performance.now() - started > 30000
              ) {
                complete = false;
                return true;
              }
              return false;
            }
          }
          if (++pairs > candidatePairBudget || performance.now() - started > 30000) {
            complete = false;
            return true;
          }
          const fa = indexed.faces[ti],
            fb = indexed.faces[tj];
          for (let k = 0; k < 3; k++) {
            triangleA[k] = indexed.vertices[fa[k]];
            triangleB[k] = indexed.vertices[fb[k]];
          }
          shared.length = 0;
          if (fa[0] === fb[0] || fa[0] === fb[1] || fa[0] === fb[2])
            shared.push(triangleA[0]);
          if (
            fa[1] !== fa[0] &&
            (fa[1] === fb[0] || fa[1] === fb[1] || fa[1] === fb[2])
          )
            shared.push(triangleA[1]);
          if (
            fa[2] !== fa[0] &&
            fa[2] !== fa[1] &&
            (fa[2] === fb[0] || fa[2] === fb[1] || fa[2] === fb[2])
          )
            shared.push(triangleA[2]);
          if (
            intersectsOverlappingTrianglesBeyondSharedContact(
              a,
              b,
              shared,
              triangleA,
              triangleB,
            )
          ) {
            intersections++;
            intersectionFaces.push([ti, tj]);
            return true;
          }
          return false;
        },
      });
    endIntersections();
    if (!checkIntersections)
      notes.push(
        "Self-intersection checking was disabled; manufacturing readiness is unverified.",
      );
    if (!complete && checkIntersections)
      notes.push(
        `Self-intersection search reached its 30 s / ${(candidatePairBudget / 1_000_000).toFixed(2)} million candidate budget; result is incomplete.`,
      );
    const endContainment = startGeometryTiming("surface.containment");
    const direction = new Vector3(0.389, 0.739, 0.547).normalize();
    const parity = (p: Vector3) => {
      const hits = bvh
        .raycast(new Ray(p, direction), DoubleSide)
        .map((h) => h.distance)
        .sort((a, b) => a - b);
      let count = 0,
        previous = -Infinity;
      for (const distance of hits)
        if (distance - previous > 1e-7) {
          count++;
          previous = distance;
        }
      return count % 2;
    };
    for (const seed of shellSeeds) {
      const p = new Vector3(...(seed.position as [number, number, number])),
        n = new Vector3(...(seed.normal as [number, number, number]));
      if (
        parity(p.clone().addScaledVector(n, 1e-5)) !== 0 ||
        parity(p.clone().addScaledVector(n, -1e-5)) !== 1
      )
        shellOrientationConcerns++;
    }
    if (shellOrientationConcerns)
      notes.push(
        `${shellOrientationConcerns} shell orientation/containment probes disagree with a positive solid and negative cavity convention.`,
      );
    endContainment();
    const endThickness = startGeometryTiming("surface.thickness");
    const stride = Math.max(1, Math.ceil(mesh.faces.length / 10000));
    for (let i = 0; i < mesh.faces.length; i += stride) {
      const p = mesh.faces[i].map((i) => new Vector3(...mesh.vertices[i])),
        center = p[0]
          .clone()
          .add(p[1])
          .add(p[2])
          .multiplyScalar(1 / 3);
      const n = p[1]
        .clone()
        .sub(p[0])
        .cross(p[2].clone().sub(p[0]))
        .normalize()
        .negate();
      if (!n.lengthSq()) continue;
      const epsilon = 1e-5;
      const hit = bvh.raycastFirst(
        new Ray(center.addScaledVector(n, epsilon), n),
        DoubleSide,
        epsilon,
      );
      if (hit && hit.distance > epsilon) {
        minSampledThicknessMm = Math.min(
          minSampledThicknessMm,
          hit.distance + epsilon,
        );
        thicknessSamples++;
      }
    }
    endThickness();
    const wallConcern =
      Number.isFinite(minSampledThicknessMm) &&
      minSampledThicknessMm < minWallMm;
    if (wallConcern)
      notes.push(
        `Sampled normal-ray thickness ${minSampledThicknessMm.toFixed(4)} mm is below ${minWallMm} mm. Inspect thin or acute regions.`,
      );
    return {
      selfIntersections: {
        found: intersections,
        complete,
        candidatePairs: pairs,
        candidatePairBudget,
        timeBudgetMs: 30000,
        boundsRejectedPairs,
        exampleFaces: intersectionFaces,
        method:
          "BVH candidates with adaptive exact-sign triangle contact on supplied coordinates; shared topology checked beyond its expected simplex; degenerate faces rejected separately",
      },
      shellOrientationConcerns,
      minSampledThicknessMm: Number.isFinite(minSampledThicknessMm)
        ? minSampledThicknessMm
        : null,
      thicknessSamples,
      wallConcern,
      notes,
    };
  } finally {
    geometry.dispose();
  }
}
