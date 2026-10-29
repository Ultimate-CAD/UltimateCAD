import { expect, it } from "vitest";
import { auditManufacturingMesh as baseline } from "../fixtures/geometry8/manufacturingMesh";
import {
  auditManufacturingMesh as optimized,
  auditIndexedManufacturingMesh,
  indexManufacturingMesh,
} from "@/lib/manufacturingMesh";
import type { StlExportMesh } from "@/lib/stlExport";

it("preserves .8 topology diagnostics, shell probes, volume and vertex fans", () => {
  let seed = 771128;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  for (let iteration = 0; iteration < 500; iteration++) {
    const vertices = Array.from(
      { length: 4 + (iteration % 25) },
      () =>
        [
          Math.floor(random() * 6),
          Math.floor(random() * 6),
          Math.floor(random() * 6),
        ] as [number, number, number],
    );
    const faces = Array.from(
      { length: 1 + (iteration % 80) },
      () =>
        [
          Math.floor(random() * vertices.length),
          Math.floor(random() * vertices.length),
          Math.floor(random() * vertices.length),
        ] as [number, number, number],
    );
    if (iteration % 2 === 0) vertices.push(vertices[0]);
    const mesh: StlExportMesh = { vertices, faces };
    expect(optimized(mesh)).toEqual(baseline(mesh));
    expect(auditIndexedManufacturingMesh(indexManufacturingMesh(mesh))).toEqual(
      baseline(mesh),
    );
    expect(optimized(mesh, true)).toEqual(baseline(mesh, true));
  }
  const vertices: [number, number, number][] = [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
    [0, 0, 2],
    [-2, 0, 0],
    [0, -2, 0],
    [0, 0, -2],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 1, 3],
    [1, 2, 3],
    [2, 0, 3],
    [0, 4, 5],
    [0, 6, 4],
    [4, 6, 5],
    [5, 6, 0],
  ];
  expect(optimized({ vertices, faces })).toEqual(baseline({ vertices, faces }));
  expect(optimized({ vertices, faces }).nonManifoldVertices).toBeGreaterThan(0);
});
