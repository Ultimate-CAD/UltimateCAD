import { expect, it, vi } from "vitest";
import manifoldModule from "manifold-3d";
import { PrecisionExportEngine } from "@/lib/precisionExport";
import { DEFAULT_PRECISION } from "@/lib/precisionMesh";
import type { WorkplaneShape } from "@/types/layerling";

vi.mock("@/lib/brepKernel", () => ({
  loadBrepWithOcct: () => {
    throw new Error("Mesh encoding must not retessellate B-rep");
  },
}));

it(
  "diagnoses float32 topology collapse at placement and preserves the full-precision source",
  async () => {
    const points = [
      [0, 0, 0],
      [0, 2, 0],
      [0.0000004, 0, 0],
      [0, 0, 2],
    ];
    const faces = [
      [0, 1, 2],
      [0, 3, 1],
      [0, 2, 3],
      [1, 3, 2],
    ];
    const shape: WorkplaneShape = {
      id: "float32-placement",
      name: "Thin precise tetrahedron",
      kind: "mesh",
      color: "#0169cc",
      x: 10,
      z: 0,
      elevation: 0,
      size: 3,
      width: 3,
      depth: 3,
      height: 3,
      rotation: 0,
      importedMesh: {
        positions: faces.flatMap((f) => f.flatMap((i) => points[i])),
        baseWidth: 3,
        baseHeight: 3,
        baseDepth: 3,
        triangleCount: 4,
        sourceFormat: "json",
      },
    };
    const original = JSON.stringify(shape);
    const runtime = await manifoldModule();
    runtime.setup();
    const engine = new PrecisionExportEngine(runtime);
    const stl = await engine.run([shape], "stl", {
      ...DEFAULT_PRECISION,
      minWallMm: 0,
    });
    expect(stl.bytes).toBeNull();
    expect(stl.report.verification.status).toBe("verified-invalid");
    expect(stl.report.bodies[0].encoding.topologyBeforeEncoding?.valid).toBe(true);
    expect(stl.report.bodies[0].encoding.introducedTopologyDefects).toBe(true);
    expect(
      stl.report.bodies[0].encoding.maxVertexDisplacementMm,
    ).toBeGreaterThan(0);
    expect(stl.report.bodies[0].audit.degenerateFaces).toBeGreaterThan(0);
    expect(
      stl.report.warnings.some((w) =>
        /float32 encoding changed topology/.test(w),
      ),
    ).toBe(true);
    const three = await engine.run([shape], "3mf", {
      ...DEFAULT_PRECISION,
      minWallMm: 0,
    });
    expect(three.bytes).not.toBeNull();
    expect(three.report.verification.status).toBe("verified-valid");
    expect(three.report.bodies[0].encoding.coordinates).toBe("float64");
    expect(three.report.bodies[0].encoding.maxVertexDisplacementMm).toBe(0);
    expect(three.report.bodies[0].audit.valid).toBe(true);
    expect(JSON.stringify(shape)).toBe(original);
  },
);
