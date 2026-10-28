import { describe, it, expect, beforeAll } from "vitest";
import module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";
import {
  manufacturingSurfaceChecks,
  sampledMeshDeviation,
} from "@/lib/meshManufacturingQa";

const tetra = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as [number, number, number][],
  faces: [
    [0, 2, 1],
    [0, 1, 3],
    [1, 2, 3],
    [2, 0, 3],
  ] as [number, number, number][],
};
let rt: ManifoldToplevel;
beforeAll(async () => {
  rt = await module();
  rt.setup();
});
function solidMesh(solid: Manifold) {
  const m = solid.getMesh();
  return {
    vertices: Array.from(
      { length: m.numVert },
      (_, i) =>
        Array.from(
          m.vertProperties.subarray(i * m.numProp, i * m.numProp + 3),
        ) as [number, number, number],
    ),
    faces: Array.from(
      { length: m.numTri },
      (_, i) =>
        Array.from(m.triVerts.subarray(i * 3, i * 3 + 3)) as [
          number,
          number,
          number,
        ],
    ),
  };
}
describe("manufacturing reliability boundaries", () => {
  it("distinguishes closed cavities, intentional bottom openings and thin walls without altering them", () => {
    const outer = rt.Manifold.cube([20, 20, 20]),
      closedTool = rt.Manifold.cube([16, 16, 16]).translate([2, 2, 2]),
      openTool = rt.Manifold.cube([16, 19, 16]).translate([2, -1, 2]),
      thinTool = rt.Manifold.cube([19.6, 19.6, 19.6]).translate([
        0.2, 0.2, 0.2,
      ]);
    const closed = outer.subtract(closedTool),
      open = outer.subtract(openTool),
      thin = outer.subtract(thinTool);
    try {
      for (const [solid, shells, wallConcern] of [
        [closed, 2, false],
        [open, 1, false],
        [thin, 2, true],
      ] as const) {
        const mesh = solidMesh(solid),
          before = JSON.stringify(mesh),
          audit = auditManufacturingMesh(mesh),
          surface = manufacturingSurfaceChecks(
            mesh,
            true,
            0.8,
            audit.shellSeeds,
          );
        expect(audit.valid).toBe(true);
        expect(audit.shells).toBe(shells);
        expect(audit.solidComponents).toBe(1);
        expect(surface.selfIntersections.found).toBe(0);
        expect(surface.shellOrientationConcerns).toBe(0);
        expect(surface.wallConcern).toBe(wallConcern);
        expect(JSON.stringify(mesh)).toBe(before);
      }
    } finally {
      [closed, open, thin, outer, closedTool, openTool, thinTool].forEach((s) =>
        s.delete(),
      );
    }
  });
  it("reports multiple distinct material shells without deleting components", () => {
    const mesh = {
      vertices: [
        ...tetra.vertices,
        ...tetra.vertices.map(
          (p) => [p[0] + 3, p[1], p[2]] as [number, number, number],
        ),
      ],
      faces: [
        ...tetra.faces,
        ...tetra.faces.map(
          (f) => f.map((i) => i + 4) as [number, number, number],
        ),
      ],
    };
    const audit = auditManufacturingMesh(mesh),
      surface = manufacturingSurfaceChecks(mesh, true, 0, audit.shellSeeds);
    expect(audit.valid).toBe(true);
    expect(audit.solidComponents).toBe(2);
    expect(audit.cavityShells).toBe(0);
    expect(surface.shellOrientationConcerns).toBe(0);
    expect(surface.selfIntersections.found).toBe(0);
  });
  it("detects a closed connected vertex star crossing itself beyond shared vertices", () => {
    const mesh = {
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
        [0.5, 0.5, 2],
        [3, 0.5, 1],
      ] as [number, number, number][],
      faces: [
        [3, 0, 1],
        [3, 1, 2],
        [3, 2, 0],
        [4, 1, 0],
        [4, 2, 1],
        [4, 0, 2],
      ] as [number, number, number][],
    };
    expect(auditManufacturingMesh(mesh).valid).toBe(true);
    expect(
      manufacturingSurfaceChecks(mesh, true, 0).selfIntersections.found,
    ).toBeGreaterThan(0);
  });
  it("allows proper shared-edge and shared-vertex surface contacts on a valid closed tetrahedron", () => {
    expect(
      manufacturingSurfaceChecks(tetra, true, 0).selfIntersections.found,
    ).toBe(0);
  });
  it("checks 3MF-sized double coordinates without float32 collapse", () => {
    const offset = 1e8,
      a = tetra.vertices.map(
        (p) => p.map((v) => v + offset) as [number, number, number],
      );
    const clear = tetra.vertices.map(
      (p) =>
        [p[0] + offset + 1.01, p[1] + offset, p[2] + offset] as [
          number,
          number,
          number,
        ],
    );
    const overlap = tetra.vertices.map(
      (p) => p.map((v) => v + offset + 0.1) as [number, number, number],
    );
    const faces = [
      ...tetra.faces,
      ...tetra.faces.map(
        (f) => f.map((i) => i + 4) as [number, number, number],
      ),
    ];
    expect(
      manufacturingSurfaceChecks({ vertices: [...a, ...clear], faces }, true, 0)
        .selfIntersections.found,
    ).toBe(0);
    expect(
      manufacturingSurfaceChecks(
        { vertices: [...a, ...overlap], faces },
        true,
        0,
      ).selfIntersections.found,
    ).toBeGreaterThan(0);
    expect(
      sampledMeshDeviation(
        { vertices: a, faces: tetra.faces },
        { vertices: a, faces: tetra.faces },
      ).mm,
    ).toBeLessThan(5e-8);
    const translatedAudit = auditManufacturingMesh({
      vertices: a,
      faces: tetra.faces,
    });
    expect(translatedAudit.valid).toBe(true);
    expect(translatedAudit.signedVolumeMm3).toBeCloseTo(1 / 6, 12);
  });
});
