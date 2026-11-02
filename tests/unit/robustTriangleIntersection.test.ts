import { expect, it } from "vitest";
import { Vector3 } from "three";
import { ExtendedTriangle } from "three-mesh-bvh";
import { intersectsBeyondSharedContact } from "@/lib/triangleSharedContact";
import { robustTriangleIntersection } from "@/lib/robustTriangleIntersection";
import { exactTriangleSat } from "../helpers/exactTriangleSat";

type P = [number, number, number];

const triangle = (p: P[]) =>
  new ExtendedTriangle(
    ...(p.map((x) => new Vector3(...x)) as [Vector3, Vector3, Vector3]),
  );

const captured: P[][] = [
  [
    [-29.98192596435547, 0.75, -26.459205627441406],
    [-29.652000427246094, 1.5, -26.833057403564453],
    [-29.81696319580078, 0.75, -26.64613151550293],
  ],
  [
    [-29.98192596435547, 1.5, -26.459205627441406],
    [-29.98192596435547, 2.25, -26.459205627441406],
    [-29.81696319580078, 2.25, -26.64613151550293],
  ],
];

it("rejects the captured coplanar false positive without moving any coordinate", () => {
  expect(triangle(captured[0]).intersectsTriangle(triangle(captured[1]))).toBe(
    true,
  );
  expect(exactTriangleSat(captured[0], captured[1])).toBe(false);
  expect(
    intersectsBeyondSharedContact(triangle(captured[0]), triangle(captured[1]), []),
  ).toBe(false);
});

it("retains real noncoplanar crossings, coplanar overlaps and nonadjacent point contacts across scales", () => {
  const p: P[] = [
      [0, 0, 0],
      [4, 0, 0],
      [0, 4, 0],
    ],
    cases: { q: P[]; hit: boolean }[] = [
      { q: [[1, 1, -1], [1, 1, 1], [3, 1, 0]], hit: true },
      { q: [[1, 1, 0], [5, 1, 0], [1, 5, 0]], hit: true },
      { q: [[3, 3, 0], [5, 3, 0], [3, 5, 0]], hit: false },
      { q: [[1, 1, 0], [1, 1, 1], [2, 1, 1]], hit: true },
      { q: [[0, 0, 1], [4, 0, 1], [0, 4, 1]], hit: false },
    ];
  for (const scale of [1e-6, 1, 1e6])
    for (const shift of [0, 1e9])
      for (const { q, hit } of cases) {
        const move = (v: P[]) => v.map((p) => p.map((x) => x * scale + shift) as P),
          a = move(p),
          b = move(q);
        expect(exactTriangleSat(a, b)).toBe(hit);
        expect(robustTriangleIntersection(a, b)).toBe(hit);
        expect(robustTriangleIntersection(b, a)).toBe(hit);
      }
});

it("ignores only the shared simplex, never overlapping area or a crossing beyond a shared vertex", () => {
  const p: P[] = [
      [0, 0, 0],
      [4, 0, 0],
      [0, 4, 0],
    ],
    cases: { q: P[]; shared: P[]; hit: boolean }[] = [
      { q: [[0, 0, 0], [4, 0, 0], [0, -4, 0]], shared: [p[0], p[1]], hit: false },
      { q: [[0, 0, 0], [4, 0, 0], [1, 1, 0]], shared: [p[0], p[1]], hit: true },
      { q: [[0, 0, 0], [-1, 0, 0], [0, -1, 0]], shared: [p[0]], hit: false },
      { q: [[0, 0, 0], [2, 1, -1], [2, 1, 1]], shared: [p[0]], hit: true },
      { q: [[0, 0, 0], [4, 0, 0], [0, 0, 4]], shared: [p[0], p[1]], hit: false },
    ];
  for (const { q, shared, hit } of cases)
    expect(intersectsBeyondSharedContact(triangle(p), triangle(q), shared)).toBe(
      hit,
    );
});
