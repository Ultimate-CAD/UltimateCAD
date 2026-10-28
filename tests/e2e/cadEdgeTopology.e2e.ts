import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OcctKernel, type ShapeHandle } from "occt-wasm";
import { buildCadEdgeFaceMap } from "@/lib/cadEdgeTopology";

function facetSphereStl(latitudeBands: number, longitudeSegments: number) {
  const point = (latitude: number, longitude: number): [number, number, number] => {
    const phi = Math.PI * latitude / latitudeBands;
    const theta = 2 * Math.PI * longitude / longitudeSegments;
    return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
  };
  const facets: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];
  for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
    const next = (longitude + 1) % longitudeSegments;
    facets.push([[0, 1, 0], point(1, longitude), point(1, next)]);
    facets.push([[0, -1, 0], point(latitudeBands - 1, next), point(latitudeBands - 1, longitude)]);
  }
  for (let latitude = 1; latitude < latitudeBands - 1; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const next = (longitude + 1) % longitudeSegments;
      const a = point(latitude, longitude);
      const b = point(latitude, next);
      const c = point(latitude + 1, longitude);
      const d = point(latitude + 1, next);
      facets.push([a, c, b], [b, c, d]);
    }
  }
  const lines = ["solid sphere"];
  for (const [a, b, c] of facets) {
    lines.push("facet normal 0 0 0", "outer loop", `vertex ${a.join(" ")}`, `vertex ${b.join(" ")}`, `vertex ${c.join(" ")}`, "endloop", "endfacet");
  }
  lines.push("endsolid sphere");
  return { stl: lines.join("\n"), triangles: facets.length };
}

describe("CAD edge-face topology map", () => {
  let cad: OcctKernel;

  beforeAll(async () => {
    const wasm = join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm");
    cad = await OcctKernel.init({ wasm });
  });

  it("matches OCCT's edgeToFaceMap on a faceted sphere and avoids its nested traversal", () => {
    const { stl, triangles } = facetSphereStl(20, 40);
    const shape = cad.importStl(stl);
    let faces: ShapeHandle[] = [];
    try {
      faces = cad.getSubShapes(shape, "face");
      const startedOld = performance.now();
      const oldPairs = cad.edgeToFaceMap(shape, 2_147_483_647);
      const oldMs = performance.now() - startedOld;

      const startedNew = performance.now();
      const mapped = buildCadEdgeFaceMap(cad, faces, 2_147_483_647);
      const newMs = performance.now() - startedNew;
      const oldMap = new Map<number, number[]>();
      for (let index = 0; index + 1 < oldPairs.length;) {
        const edgeHash = oldPairs[index++];
        const count = oldPairs[index++];
        oldMap.set(edgeHash, oldPairs.slice(index, index + count));
        index += count;
      }
      const normalize = (map: Map<number, number[]>) => [...map.entries()]
        .map(([edge, adjacent]) => [edge, [...adjacent].sort((a, b) => a - b)] as const)
        .sort(([a], [b]) => a - b);

      expect(faces.length).toBeGreaterThan(triangles * 0.9);
      expect(normalize(mapped)).toEqual(normalize(oldMap));
      console.info(`[cadEdgeTopology] ${triangles} STL facets, ${faces.length} faces: edgeToFaceMap ${oldMs.toFixed(1)} ms; per-face hash map ${newMs.toFixed(1)} ms`);
    } finally {
      for (const face of faces) cad.release(face);
      cad.release(shape);
    }
  }, 120_000);

  it("preserves single-face seam edges and two-face cylinder rims", () => {
    const cylinder = cad.makeCylinder(10, 20);
    let faces: ShapeHandle[] = [];
    try {
      faces = cad.getSubShapes(cylinder, "face");
      const oldPairs = cad.edgeToFaceMap(cylinder, 2_147_483_647);
      const oldMap = new Map<number, number[]>();
      for (let index = 0; index + 1 < oldPairs.length;) {
        const edgeHash = oldPairs[index++];
        const count = oldPairs[index++];
        oldMap.set(edgeHash, oldPairs.slice(index, index + count));
        index += count;
      }
      const mapped = buildCadEdgeFaceMap(cad, faces, 2_147_483_647);
      const normalize = (map: Map<number, number[]>) => [...map.entries()]
        .map(([edge, adjacent]) => [edge, [...adjacent].sort((a, b) => a - b)] as const)
        .sort(([a], [b]) => a - b);

      expect(normalize(mapped)).toEqual(normalize(oldMap));
      expect([...mapped.values()].some((adjacent) => adjacent.length === 1)).toBe(true);
      expect([...mapped.values()].some((adjacent) => adjacent.length === 2)).toBe(true);
    } finally {
      for (const face of faces) cad.release(face);
      cad.release(cylinder);
    }
  });

  it("builds face adjacency for a 15,600-facet imported sphere", () => {
    const { stl, triangles } = facetSphereStl(79, 100);
    const shape = cad.importStl(stl);
    let faces: ShapeHandle[] = [];
    try {
      faces = cad.getSubShapes(shape, "face");
      const started = performance.now();
      const mapped = buildCadEdgeFaceMap(cad, faces, 2_147_483_647);
      const elapsed = performance.now() - started;
      expect(triangles).toBe(15_600);
      expect(faces.length).toBe(triangles);
      expect(mapped.size).toBeGreaterThan(triangles);
      console.info(`[cadEdgeTopology] ${triangles} STL facets, ${faces.length} faces: per-face hash map ${elapsed.toFixed(1)} ms (quadratic baseline skipped)`);
    } finally {
      for (const face of faces) cad.release(face);
      cad.release(shape);
    }
  }, 120_000);
});
