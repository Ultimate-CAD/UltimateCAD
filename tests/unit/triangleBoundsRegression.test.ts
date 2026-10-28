import { it, expect } from "vitest";
import { Vector3 } from "three";
import { ExtendedTriangle } from "three-mesh-bvh";
import { intersectsBeyondSharedContact } from "@/lib/triangleSharedContact";

it("rejects separated coplanar collar facets without suppressing actual overlap", () => {
  const triangle = (y: number) => new ExtendedTriangle(
    new Vector3(-9.914448738098145, y, -1.3052619695663452),
    new Vector3(-9.914448738098145, y + 1, -1.3052619695663452),
    new Vector3(-9.659257888793945, y, -2.5881905555725098),
  );
  expect(intersectsBeyondSharedContact(triangle(15), triangle(17), [])).toBe(false);
  expect(intersectsBeyondSharedContact(triangle(15), triangle(15.25), [])).toBe(true);
});
