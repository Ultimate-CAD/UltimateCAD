type P = readonly [number, number, number];
type I = [bigint, bigint, bigint];

const sub = (a: I, b: I): I => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: I, b: I): I => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: I, b: I) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const zero = (a: I) => a.every((x) => x === 0n);

/**
 * Test-only independent SAT oracle: losslessly lift IEEE doubles to integers,
 * then evaluate separating axes entirely with BigInt, without tolerances.
 */
export function exactTriangleSat(p: P[], q: P[]): boolean | null {
  const view = new DataView(new ArrayBuffer(8));
  const parts = [...p, ...q].flat().map((x) => {
    view.setFloat64(0, x);
    const bits = view.getBigUint64(0),
      e = Number((bits >> 52n) & 2047n),
      fraction = bits & ((1n << 52n) - 1n);
    return {
      n: ((bits >> 63n) ? -1n : 1n) * (e ? fraction + (1n << 52n) : fraction),
      e: e ? e - 1075 : -1074,
    };
  });
  const power = Math.min(...parts.filter((x) => x.n !== 0n).map((x) => x.e));
  if (!Number.isFinite(power)) return null;
  const values = parts.map((x) => (x.n === 0n ? 0n : x.n << BigInt(x.e - power))),
    points = Array.from({ length: 6 }, (_, i) =>
      values.slice(i * 3, i * 3 + 3),
    ) as I[],
    a = points.slice(0, 3),
    b = points.slice(3),
    ae = a.map((v, i) => sub(a[(i + 1) % 3], v)),
    be = b.map((v, i) => sub(b[(i + 1) % 3], v)),
    an = cross(ae[0], ae[1]),
    bn = cross(be[0], be[1]);
  if (zero(an) || zero(bn)) return null;
  const axes = [
    an,
    bn,
    ...ae.flatMap((x) => be.map((y) => cross(x, y))),
    ...ae.map((x) => cross(an, x)),
    ...be.map((x) => cross(bn, x)),
  ];
  for (const axis of axes) {
    if (zero(axis)) continue;
    const ap = a.map((x) => dot(x, axis)),
      bp = b.map((x) => dot(x, axis)),
      min = (v: bigint[]) => v.reduce((x, y) => (x < y ? x : y)),
      max = (v: bigint[]) => v.reduce((x, y) => (x > y ? x : y));
    if (max(ap) < min(bp) || max(bp) < min(ap)) return false;
  }
  return true;
}
