import { orient2d, orient3d } from "robust-predicates";
import type { ExtendedTriangle } from "three-mesh-bvh";
import type { Vector3 } from "three";
import { robustTriangleIntersection } from "@/lib/robustTriangleIntersection";

type Point = readonly [number, number, number];
const point = (p: Vector3): Point => [p.x, p.y, p.z];
const same = (a: Point, b: Point) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const opposite = (a: number, b: number) => (a < 0 && b > 0) || (a > 0 && b < 0);
const side = (a: Point, b: Point, c: Point, p: Point) =>
  orient3d(
    a[0],
    a[1],
    a[2],
    b[0],
    b[1],
    b[2],
    c[0],
    c[1],
    c[2],
    p[0],
    p[1],
    p[2],
  );

/** Ignore only the expected shared simplex, never an entire shared-vertex pair. */
export function intersectsBeyondSharedContact(
  a: ExtendedTriangle,
  b: ExtendedTriangle,
  shared: readonly Point[],
  p = [point(a.a), point(a.b), point(a.c)],
  q = [point(b.a), point(b.b), point(b.c)],
) {
  for (let axis = 0; axis < 3; axis++) {
    if (
      Math.max(p[0][axis], p[1][axis], p[2][axis]) <
        Math.min(q[0][axis], q[1][axis], q[2][axis]) ||
      Math.max(q[0][axis], q[1][axis], q[2][axis]) <
        Math.min(p[0][axis], p[1][axis], p[2][axis])
    )
      return false;
  }
  return intersectsOverlappingTrianglesBeyondSharedContact(a, b, shared, p, q);
}

/** Caller first rejects strictly separated exact triangle AABBs.
 * Same predicates/arithmetic as .8, borrowing canonical coordinates and scalar scratch.
 */
export function intersectsOverlappingTrianglesBeyondSharedContact(
  a: ExtendedTriangle,
  b: ExtendedTriangle,
  shared: readonly Point[],
  p: Point[],
  q: Point[],
) {
  if (!shared.length)
    return robustTriangleIntersection(p, q) ?? a.intersectsTriangle(b);
  if (shared.length === 3) return true;
  if (
    same(p[0], p[1]) ||
    same(p[1], p[2]) ||
    same(p[2], p[0]) ||
    same(q[0], q[1]) ||
    same(q[1], q[2]) ||
    same(q[2], q[0])
  )
    return a.intersectsTriangle(b);
  if (shared.length === 2) {
    const s = shared[0],
      t = shared[1];
    const u =
      !same(p[0], s) && !same(p[0], t)
        ? p[0]
        : !same(p[1], s) && !same(p[1], t)
          ? p[1]
          : p[2];
    const v =
      !same(q[0], s) && !same(q[0], t)
        ? q[0]
        : !same(q[1], s) && !same(q[1], t)
          ? q[1]
          : q[2];
    if (side(s, t, u, v) !== 0) return false;
    const ex = t[0] - s[0],
      ey = t[1] - s[1],
      ez = t[2] - s[2];
    const ux = u[0] - s[0],
      uy = u[1] - s[1],
      uz = u[2] - s[2];
    const vx = v[0] - s[0],
      vy = v[1] - s[1],
      vz = v[2] - s[2];
    const nx = ey * uz - ez * uy,
      ny = ez * ux - ex * uz,
      nz = ex * uy - ey * ux;
    const mx = ey * vz - ez * vy,
      my = ez * vx - ex * vz,
      mz = ex * vy - ey * vx;
    return nx * mx + ny * my + nz * mz > 0;
  }
  const s = shared[0],
    u = same(p[0], s) ? p[1] : p[0],
    v = same(p[2], s) ? p[1] : p[2];
  const c = same(q[0], s) ? q[1] : q[0],
    d = same(q[2], s) ? q[1] : q[2];
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
  let x0 = 0,
    x1 = 0,
    x2 = 0,
    y0 = 0,
    y1 = 0,
    y2 = 0;
  if (su === 0) {
    x0 = u[0] - s[0];
    x1 = u[1] - s[1];
    x2 = u[2] - s[2];
  } else if (sv === 0) {
    x0 = v[0] - s[0];
    x1 = v[1] - s[1];
    x2 = v[2] - s[2];
  } else if (opposite(su, sv)) {
    const t = su / (su - sv);
    x0 = u[0] - s[0] + t * (v[0] - u[0]);
    x1 = u[1] - s[1] + t * (v[1] - u[1]);
    x2 = u[2] - s[2] + t * (v[2] - u[2]);
  }
  if (sc === 0) {
    y0 = c[0] - s[0];
    y1 = c[1] - s[1];
    y2 = c[2] - s[2];
  } else if (sd === 0) {
    y0 = d[0] - s[0];
    y1 = d[1] - s[1];
    y2 = d[2] - s[2];
  } else if (opposite(sc, sd)) {
    const t = sc / (sc - sd);
    y0 = c[0] - s[0] + t * (d[0] - c[0]);
    y1 = c[1] - s[1] + t * (d[1] - c[1]);
    y2 = c[2] - s[2] + t * (d[2] - c[2]);
  }
  const lx = Math.hypot(x0, x1, x2),
    ly = Math.hypot(y0, y1, y2);
  return (
    lx > 0 &&
    ly > 0 &&
    0 + (x0 / lx) * (y0 / ly) + (x1 / lx) * (y1 / ly) + (x2 / lx) * (y2 / ly) >
      0
  );
}

const strictlyInside = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) => {
  const a = orient2d(ax, ay, bx, by, px, py),
    b = orient2d(bx, by, cx, cy, px, py),
    c = orient2d(cx, cy, ax, ay, px, py);
  return (a > 0 && b > 0 && c > 0) || (a < 0 && b < 0 && c < 0);
};
const on = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
) =>
  px >= Math.min(ax, bx) &&
  px <= Math.max(ax, bx) &&
  py >= Math.min(ay, by) &&
  py <= Math.max(ay, by);
function coplanarOverlap(p: Point[], q: Point[], shared: Point) {
  const ux = p[1][0] - p[0][0],
    uy = p[1][1] - p[0][1],
    uz = p[1][2] - p[0][2];
  const vx = p[2][0] - p[0][0],
    vy = p[2][1] - p[0][1],
    vz = p[2][2] - p[0][2];
  const nx = Math.abs(uy * vz - uz * vy),
    ny = Math.abs(uz * vx - ux * vz),
    nz = Math.abs(ux * vy - uy * vx);
  const maximum = Math.max(nx, ny, nz);
  const drop =
      nx === maximum ? 0 : ny === maximum ? 1 : nz === maximum ? 2 : -1,
    a = drop === 0 ? 1 : 0,
    b = drop === 0 || drop === 1 ? 2 : 1;
  const p0x = p[0][a] - shared[a],
    p0y = p[0][b] - shared[b],
    p1x = p[1][a] - shared[a],
    p1y = p[1][b] - shared[b],
    p2x = p[2][a] - shared[a],
    p2y = p[2][b] - shared[b];
  const q0x = q[0][a] - shared[a],
    q0y = q[0][b] - shared[b],
    q1x = q[1][a] - shared[a],
    q1y = q[1][b] - shared[b],
    q2x = q[2][a] - shared[a],
    q2y = q[2][b] - shared[b];
  if (
    strictlyInside(p0x, p0y, q0x, q0y, q1x, q1y, q2x, q2y) ||
    strictlyInside(p1x, p1y, q0x, q0y, q1x, q1y, q2x, q2y) ||
    strictlyInside(p2x, p2y, q0x, q0y, q1x, q1y, q2x, q2y) ||
    strictlyInside(q0x, q0y, p0x, p0y, p1x, p1y, p2x, p2y) ||
    strictlyInside(q1x, q1y, p0x, p0y, p1x, p1y, p2x, p2y) ||
    strictlyInside(q2x, q2y, p0x, p0y, p1x, p1y, p2x, p2y)
  )
    return true;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const ax = i === 0 ? p0x : i === 1 ? p1x : p2x,
        ay = i === 0 ? p0y : i === 1 ? p1y : p2y;
      const bx = i === 0 ? p1x : i === 1 ? p2x : p0x,
        by = i === 0 ? p1y : i === 1 ? p2y : p0y;
      const cx = j === 0 ? q0x : j === 1 ? q1x : q2x,
        cy = j === 0 ? q0y : j === 1 ? q1y : q2y;
      const dx = j === 0 ? q1x : j === 1 ? q2x : q0x,
        dy = j === 0 ? q1y : j === 1 ? q2y : q0y;
      const o1 = orient2d(ax, ay, bx, by, cx, cy),
        o2 = orient2d(ax, ay, bx, by, dx, dy),
        o3 = orient2d(cx, cy, dx, dy, ax, ay),
        o4 = orient2d(cx, cy, dx, dy, bx, by);
      if (opposite(o1, o2) && opposite(o3, o4)) return true;
      if (
        (o1 === 0 && on(ax, ay, bx, by, cx, cy) && (cx !== 0 || cy !== 0)) ||
        (o2 === 0 && on(ax, ay, bx, by, dx, dy) && (dx !== 0 || dy !== 0)) ||
        (o3 === 0 && on(cx, cy, dx, dy, ax, ay) && (ax !== 0 || ay !== 0)) ||
        (o4 === 0 && on(cx, cy, dx, dy, bx, by) && (bx !== 0 || by !== 0))
      )
        return true;
    }
  return false;
}
