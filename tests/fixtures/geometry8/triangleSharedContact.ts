import { orient2d, orient3d } from "robust-predicates";
import type { ExtendedTriangle } from "three-mesh-bvh";
import type { Vector3 } from "three";

type Point = readonly [number, number, number];
const point = (p: Vector3): Point => [p.x, p.y, p.z];
const same = (a: Point, b: Point) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const opposite = (a: number, b: number) => (a < 0 && b > 0) || (a > 0 && b < 0);
const side = (a: Point, b: Point, c: Point, p: Point) =>
  orient3d(...a, ...b, ...c, ...p);

/** Ignore only the expected shared simplex, never an entire shared-vertex triangle pair. */
export function intersectsBeyondSharedContact(
  a: ExtendedTriangle,
  b: ExtendedTriangle,
  shared: readonly Point[],
) {
  const p = [point(a.a), point(a.b), point(a.c)],
    q = [point(b.a), point(b.b), point(b.c)];
  // BVH leaf boxes can overlap while individual triangles are disjoint.
  // Reject strict interval separation before the approximate triangle predicate,
  // which can misclassify separated coplanar triangles with parallel edges.
  for (let axis = 0; axis < 3; axis++) {
    if (Math.max(p[0][axis], p[1][axis], p[2][axis]) < Math.min(q[0][axis], q[1][axis], q[2][axis]) ||
        Math.max(q[0][axis], q[1][axis], q[2][axis]) < Math.min(p[0][axis], p[1][axis], p[2][axis])) return false;
  }
  if (!shared.length) return a.intersectsTriangle(b);
  if (shared.length === 3) return true;
  if (
    new Set(p.map((p) => p.join(","))).size < 3 ||
    new Set(q.map((p) => p.join(","))).size < 3
  )
    return a.intersectsTriangle(b);
  if (shared.length === 2) {
    const [s, t] = shared,
      u = p.find((p) => !same(p, s) && !same(p, t))!,
      v = q.find((p) => !same(p, s) && !same(p, t))!;
    if (side(s, t, u, v) !== 0) return false; // Two distinct planes meet only along their shared edge.
    // Coplanar neighbors must lie on opposite sides of the common edge.
    const edge = t.map((x, i) => x - s[i]),
      du = u.map((x, i) => x - s[i]),
      dv = v.map((x, i) => x - s[i]);
    const n = [
      edge[1] * du[2] - edge[2] * du[1],
      edge[2] * du[0] - edge[0] * du[2],
      edge[0] * du[1] - edge[1] * du[0],
    ];
    const m = [
      edge[1] * dv[2] - edge[2] * dv[1],
      edge[2] * dv[0] - edge[0] * dv[2],
      edge[0] * dv[1] - edge[1] * dv[0],
    ];
    return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 0;
  }
  const s = shared[0],
    [u, v] = p.filter((p) => !same(p, s)),
    [c, d] = q.filter((p) => !same(p, s));
  const su = side(s, c, d, u),
    sv = side(s, c, d, v),
    sc = side(s, u, v, c),
    sd = side(s, u, v, d);
  if (
    (su > 0 && sv > 0) ||
    (su < 0 && sv < 0) ||
    (sc > 0 && sd > 0) ||
    (sc < 0 && sd < 0)
  )
    return false;
  if (su === 0 && sv === 0 && sc === 0 && sd === 0)
    return coplanarOverlap(p, q, s);
  const cutDirection = (a: Point, b: Point, da: number, db: number) => {
    if (da === 0) return a.map((x, i) => x - s[i]);
    if (db === 0) return b.map((x, i) => x - s[i]);
    if (!opposite(da, db)) return [0, 0, 0];
    const t = da / (da - db);
    return a.map((x, i) => x - s[i] + t * (b[i] - x));
  };
  const x = cutDirection(u, v, su, sv),
    y = cutDirection(c, d, sc, sd),
    lx = Math.hypot(...x),
    ly = Math.hypot(...y);
  return (
    lx > 0 &&
    ly > 0 &&
    x.reduce((sum, v, i) => sum + (v / lx) * (y[i] / ly), 0) > 0
  );
}

function coplanarOverlap(p: Point[], q: Point[], shared: Point) {
  const u = p[1].map((x, i) => x - p[0][i]),
    v = p[2].map((x, i) => x - p[0][i]);
  const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ],
    drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const axes = [0, 1, 2].filter((i) => i !== drop),
    project = (p: Point) =>
      [p[axes[0]] - shared[axes[0]], p[axes[1]] - shared[axes[1]]] as [
        number,
        number,
      ];
  const a = p.map(project),
    b = q.map(project),
    orientation = (a: number[], b: number[], c: number[]) =>
      orient2d(a[0], a[1], b[0], b[1], c[0], c[1]);
  const on = (a: number[], b: number[], p: number[]) =>
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
  const notShared = (p: number[]) => p[0] !== 0 || p[1] !== 0;
  const strictlyInside = (p: number[], t: number[][]) => {
    const signs = t.map((a, i) => orientation(a, t[(i + 1) % 3], p));
    return signs.every((v) => v > 0) || signs.every((v) => v < 0);
  };
  if (
    a.some((p) => strictlyInside(p, b)) ||
    b.some((p) => strictlyInside(p, a))
  )
    return true;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x = a[i],
        y = a[(i + 1) % 3],
        u = b[j],
        v = b[(j + 1) % 3],
        o1 = orientation(x, y, u),
        o2 = orientation(x, y, v),
        o3 = orientation(u, v, x),
        o4 = orientation(u, v, y);
      if (opposite(o1, o2) && opposite(o3, o4)) return true;
      if (
        (o1 === 0 && on(x, y, u) && notShared(u)) ||
        (o2 === 0 && on(x, y, v) && notShared(v)) ||
        (o3 === 0 && on(u, v, x) && notShared(x)) ||
        (o4 === 0 && on(u, v, y) && notShared(y))
      )
        return true;
    }
  return false;
}
