import { orient2d, orient3d } from "robust-predicates";

type Point = readonly [number, number, number];

const side = (a: Point, b: Point, c: Point, d: Point) =>
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
    d[0],
    d[1],
    d[2],
  );

const opposite = (a: number, b: number) => (a < 0 && b > 0) || (a > 0 && b < 0);
const oneSide = (a: number, b: number, c: number) =>
  (a > 0 && b > 0 && c > 0) || (a < 0 && b < 0 && c < 0);

function projected(a: Point, b: Point, c: Point, drop: number) {
  const x = drop === 0 ? 1 : 0,
    y = drop === 2 ? 1 : 2;
  return orient2d(a[x], a[y], b[x], b[y], c[x], c[y]);
}

function projection(p: Point[]) {
  const u0 = p[1][0] - p[0][0],
    u1 = p[1][1] - p[0][1],
    u2 = p[1][2] - p[0][2],
    v0 = p[2][0] - p[0][0],
    v1 = p[2][1] - p[0][1],
    v2 = p[2][2] - p[0][2];
  const x = Math.abs(u1 * v2 - u2 * v1),
    y = Math.abs(u2 * v0 - u0 * v2),
    z = Math.abs(u0 * v1 - u1 * v0);
  let drop = x >= y && x >= z ? 0 : y >= z ? 1 : 2;
  if (projected(p[0], p[1], p[2], drop) !== 0) return drop;
  for (drop = 0; drop < 3; drop++)
    if (projected(p[0], p[1], p[2], drop) !== 0) return drop;
  return -1;
}

function separatedProjection(p: Point[], q: Point[], drop: number) {
  for (let direction = 0; direction < 2; direction++) {
    const a = direction ? p : q,
      b = direction ? q : p,
      own = projected(a[0], a[1], a[2], drop);
    if (own === 0) continue;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3,
        s0 = projected(a[i], a[j], b[0], drop);
      if (!opposite(s0, own)) continue;
      const s1 = projected(a[i], a[j], b[1], drop);
      if (!opposite(s1, own)) continue;
      if (opposite(projected(a[i], a[j], b[2], drop), own)) return true;
    }
  }
  return false;
}

function containsPoint(p: Point[], q: Point, drop: number) {
  const a = projected(p[0], p[1], q, drop),
    b = projected(p[1], p[2], q, drop),
    c = projected(p[2], p[0], q, drop);
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
}

function onSegment(a: Point, b: Point, q: Point, drop: number) {
  const x = drop === 0 ? 1 : 0,
    y = drop === 2 ? 1 : 2;
  return (
    q[x] >= Math.min(a[x], b[x]) &&
    q[x] <= Math.max(a[x], b[x]) &&
    q[y] >= Math.min(a[y], b[y]) &&
    q[y] <= Math.max(a[y], b[y])
  );
}

function coplanarSegment(a: Point, b: Point, p: Point[], drop: number) {
  if (containsPoint(p, a, drop) || containsPoint(p, b, drop)) return true;
  for (let i = 0; i < 3; i++) {
    const c = p[i],
      d = p[(i + 1) % 3],
      s0 = projected(a, b, c, drop),
      s1 = projected(a, b, d, drop),
      t0 = projected(c, d, a, drop),
      t1 = projected(c, d, b, drop);
    if (opposite(s0, s1) && opposite(t0, t1)) return true;
    if (
      (s0 === 0 && onSegment(a, b, c, drop)) ||
      (s1 === 0 && onSegment(a, b, d, drop)) ||
      (t0 === 0 && onSegment(c, d, a, drop)) ||
      (t1 === 0 && onSegment(c, d, b, drop))
    )
      return true;
  }
  return false;
}

function edgeHits(
  a: Point,
  b: Point,
  da: number,
  db: number,
  p: Point[],
  drop: number,
) {
  if ((da > 0 && db > 0) || (da < 0 && db < 0)) return false;
  if (da === 0 && db === 0) return coplanarSegment(a, b, p, drop);
  if (da === 0) return containsPoint(p, a, drop);
  if (db === 0) return containsPoint(p, b, drop);
  // Oriented line/triangle edge tests. No rounded plane, normalized normal,
  // line intersection construction, division, or geometric epsilon is needed.
  const s0 = side(a, b, p[0], p[1]),
    s1 = side(a, b, p[1], p[2]),
    s2 = side(a, b, p[2], p[0]);
  return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
}

/**
 * Inclusive contact for triangles with no shared topology. Exact signs refer
 * to the supplied floating-point coordinates, not an unknown analytic surface.
 * Null leaves degenerate inputs to the existing fallback/topology rejection.
 */
export function robustTriangleIntersection(
  p: Point[],
  q: Point[],
): boolean | null {
  const pd = projection(p),
    qd = projection(q);
  if (pd < 0 || qd < 0) return null;
  if (separatedProjection(p, q, pd)) return false;
  const q0 = side(p[0], p[1], p[2], q[0]),
    q1 = side(p[0], p[1], p[2], q[1]),
    q2 = side(p[0], p[1], p[2], q[2]);
  if (oneSide(q0, q1, q2)) return false;
  if (q0 === 0 && q1 === 0 && q2 === 0) return true; // Coplanar convex SAT already ran.
  const p0 = side(q[0], q[1], q[2], p[0]),
    p1 = side(q[0], q[1], q[2], p[1]),
    p2 = side(q[0], q[1], q[2], p[2]);
  if (oneSide(p0, p1, p2)) return false;
  return (
    edgeHits(q[0], q[1], q0, q1, p, pd) ||
    edgeHits(q[1], q[2], q1, q2, p, pd) ||
    edgeHits(q[2], q[0], q2, q0, p, pd) ||
    edgeHits(p[0], p[1], p0, p1, q, qd) ||
    edgeHits(p[1], p[2], p1, p2, q, qd) ||
    edgeHits(p[2], p[0], p2, p0, q, qd)
  );
}
