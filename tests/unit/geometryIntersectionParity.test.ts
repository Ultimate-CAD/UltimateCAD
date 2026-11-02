import { expect, it } from "vitest";
import { Vector3 } from "three";
import { ExtendedTriangle } from "three-mesh-bvh";
import { intersectsBeyondSharedContact as baseline } from "../fixtures/geometry8/triangleSharedContact";
import { intersectsBeyondSharedContact as optimized } from "@/lib/triangleSharedContact";
import { intersectsCanonicalTrianglesBeyondSharedContact } from "@/lib/triangleSharedContact";
import { exactTriangleSat } from "../helpers/exactTriangleSat";

it("preserves shared-topology semantics and checks unshared triangles against independent exact SAT", () => {
  let seed = 918273;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  type Point = [number, number, number];
  const point = (scale: number, shift: number): Point =>
    [0, 1, 2].map(
      () => (Math.floor(random() * 9) - 4) * scale + shift,
    ) as Point;
  let checked = 0,
    intersections = 0;
  for (const scale of [1e-6, 1, 1e6])
    for (const shift of [0, 1e9])
      for (let sharedCount = 0; sharedCount <= 3; sharedCount++)
        for (let i = 0; i < 500; i++) {
          const p = [
              point(scale, shift),
              point(scale, shift),
              point(scale, shift),
            ],
            q = [point(scale, shift), point(scale, shift), point(scale, shift)];
          if (i % 3 === 0) {
            p.forEach((v) => (v[2] = shift));
            q.forEach((v) => (v[2] = shift));
          }
          for (let j = 0; j < sharedCount; j++) q[j] = p[j];
          const unique = new Map(p.map((v) => [v.join(","), v])),
            other = new Set(q.map((v) => v.join(","))),
            shared = [...unique]
              .filter(([key]) => other.has(key))
              .map(([, v]) => v);
          const a = new ExtendedTriangle(
              ...(p.map((v) => new Vector3(...v)) as [
                Vector3,
                Vector3,
                Vector3,
              ]),
            ),
            b = new ExtendedTriangle(
              ...(q.map((v) => new Vector3(...v)) as [
                Vector3,
                Vector3,
                Vector3,
              ]),
            );
          const expected = !shared.length
            ? exactTriangleSat(p, q) ?? baseline(a, b, shared)
            : baseline(a, b, shared);
          expect(optimized(a, b, shared, p, q)).toBe(expected);
          expect(optimized(a, b, shared)).toBe(expected);
          const separated = [0, 1, 2].some(axis =>
            Math.max(...p.map(v => v[axis])) < Math.min(...q.map(v => v[axis])) ||
            Math.max(...q.map(v => v[axis])) < Math.min(...p.map(v => v[axis])),
          );
          if (separated) expect(expected).toBe(false);
          else expect(intersectsCanonicalTrianglesBeyondSharedContact(p, q, shared, () => a.intersectsTriangle(b))).toBe(expected);
          if (expected) intersections++;
          checked++;
        }
  expect(checked).toBe(12000);
  expect(intersections).toBeGreaterThan(100);
});
