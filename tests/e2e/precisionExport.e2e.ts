import { beforeAll, describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import module, { type ManifoldToplevel } from "manifold-3d";
import type { WorkplaneShape } from "@/types/layerling";
import { unzipSync, strFromU8 } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";
import {
  DEFAULT_PRECISION,
  subdivideManufacturingMesh,
  meshTriangleMetrics,
  improvePlanarAspect,
} from "@/lib/precisionMesh";
import { manufacturingSurfaceChecks } from "@/lib/meshManufacturingQa";

vi.mock("@/lib/brepKernel", async () => {
  const brep = await import("brepjs"),
    { OcctKernel } = await import("occt-wasm");
  let raw: Awaited<ReturnType<typeof OcctKernel.init>> | null = null;
  const ready = (async () => {
    raw = await OcctKernel.init({
      wasm: join(
        dirname(fileURLToPath(import.meta.resolve("occt-wasm"))),
        "occt-wasm.wasm",
      ),
    });
    brep.registerKernel("occt-wasm", brep.OcctWasmAdapter.fromKernel(raw));
    return brep;
  })();
  return { occtKernel: () => raw, loadBrepWithOcct: () => ready };
});
let rt: ManifoldToplevel;
const shape = (patch: Partial<WorkplaneShape> = {}): WorkplaneShape => ({
  id: "test",
  name: "Test",
  kind: "box",
  color: "#0098c7",
  x: 0,
  z: 0,
  size: 20,
  width: 20,
  depth: 20,
  height: 20,
  rotation: 0,
  ...patch,
});
beforeAll(async () => {
  rt = await module();
  rt.setup();
});
describe("precision manufacturing export", () => {
  it("keeps defective STL/OBJ topology blocked even when optional surface checking is disabled", async () => {
    const { PrecisionExportEngine } = await import("@/lib/precisionExport");
    const solid = rt.Manifold.cube([20, 20, 20]),
      m = solid.getMesh();
    const positions = Array.from(m.triVerts).flatMap((i) =>
      Array.from(m.vertProperties.subarray(i * m.numProp, i * m.numProp + 3)),
    );
    solid.delete();
    for (const sourceFormat of ["stl", "obj"] as const) {
      const bad = shape({
        kind: "mesh",
        importedMesh: {
          positions: positions.slice(9),
          baseWidth: 20,
          baseHeight: 20,
          baseDepth: 20,
          triangleCount: positions.length / 9 - 1,
          sourceFormat,
        },
      });
      const result = await new PrecisionExportEngine(rt).run([bad], "stl", {
        ...DEFAULT_PRECISION,
        selfIntersections: false,
        minWallMm: 0,
      });
      expect(result.report.ready).toBe(false);
      expect(result.report.bodies[0].audit.boundaryEdges).toBeGreaterThan(0);
      expect(result.bytes).toBeNull();
    }
  });
  it("subdivides conformingly without changing tetrahedron volume or adding source fidelity", () => {
    const mesh = {
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ] as [number, number, number][],
      faces: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ] as [number, number, number][],
    };
    const fine = subdivideManufacturingMesh(mesh, 2, 10000);
    expect(auditManufacturingMesh(fine).valid).toBe(true);
    expect(auditManufacturingMesh(fine).signedVolumeMm3).toBeCloseTo(
      1000 / 6,
      8,
    );
    expect(meshTriangleMetrics(fine).maxEdgeMm).toBeLessThanOrEqual(2);
    expect(() => subdivideManufacturingMesh(mesh, 0.01, 1000)).toThrow(
      /budget/,
    );
  });
  it("detects non-adjacent intersections without confusing normal shared edges", () => {
    const tetra = {
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ] as [number, number, number][],
      faces: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ] as [number, number, number][],
    };
    expect(
      manufacturingSurfaceChecks(tetra, true, 0).selfIntersections.found,
    ).toBe(0);
    const other = tetra.vertices.map(
      (p) => p.map((x) => x + 2) as [number, number, number],
    );
    expect(
      manufacturingSurfaceChecks(
        {
          vertices: [...tetra.vertices, ...other],
          faces: [
            ...tetra.faces,
            ...tetra.faces.map(
              (f) => f.map((i) => i + 4) as [number, number, number],
            ),
          ],
        },
        true,
        0,
      ).selfIntersections.found,
    ).toBeGreaterThan(0);
  });
  it("exports native analytic box, preserves exact geometry, and reimports a closed STL", async () => {
    const { PrecisionExportEngine } = await import("@/lib/precisionExport"),
      engine = new PrecisionExportEngine(rt),
      s = shape();
    const before = JSON.stringify(s);
    const result = await engine.run([s], "stl", {
      ...DEFAULT_PRECISION,
      minWallMm: 0,
    });
    expect(result.report.ready, JSON.stringify(result.report)).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
    const parsed = new STLLoader().parse(result.bytes!.buffer as ArrayBuffer),
      p = parsed.attributes.position.array;
    const mesh = {
      vertices: Array.from(
        { length: p.length / 3 },
        (_, i) =>
          [p[i * 3], p[i * 3 + 2], -p[i * 3 + 1]] as [number, number, number],
      ),
      faces: Array.from(
        { length: p.length / 9 },
        (_, i) => [i * 3, i * 3 + 1, i * 3 + 2] as [number, number, number],
      ),
    };
    expect(auditManufacturingMesh(mesh).valid).toBe(true);
    expect(auditManufacturingMesh(mesh).signedVolumeMm3).toBeCloseTo(8000, 3);
    parsed.dispose();
    const again = await engine.run([s], "stl", {
      ...DEFAULT_PRECISION,
      minWallMm: 0,
    });
    expect(again.report.cacheHits).toBe(1);
  });
  it("improves measured analytic sphere approximation at higher quality", async () => {
    const { analyticMeshForExport } = await import("@/lib/stepExport"),
      s = shape({ kind: "sphere" });
    const trace = (s: string) =>
      writeFileSync(".codex-run/precision-analytic-trace.log", s + "\n", {
        flag: "a",
      });
    const coarse = await analyticMeshForExport(s, 0.1, 15, trace),
      fine = await analyticMeshForExport(s, 0.005, 3, trace);
    expect(fine!.mesh.faces.length).toBeGreaterThan(coarse!.mesh.faces.length);
    expect(fine!.sampledDeviationMm).toBeLessThan(coarse!.sampledDeviationMm);
    expect(fine!.sampledDeviationMm).toBeLessThanOrEqual(0.005);
    console.log(
      JSON.stringify({
        coarse: {
          triangles: coarse!.mesh.faces.length,
          errorMm: coarse!.sampledDeviationMm,
          angle: coarse!.sampledNormalDeviationDeg,
        },
        fine: {
          triangles: fine!.mesh.faces.length,
          errorMm: fine!.sampledDeviationMm,
          angle: fine!.sampledNormalDeviationDeg,
        },
      }),
    );
  });
  it("prepares a high-quality analytic sphere and a native hole without changing design state", async () => {
    const { PrecisionExportEngine } = await import("@/lib/precisionExport");
    const sphere = await new PrecisionExportEngine(rt).run(
      [shape({ kind: "sphere" })],
      "stl",
      { ...DEFAULT_PRECISION, minWallMm: 0 },
    );
    expect(sphere.report.ready, JSON.stringify(sphere.report)).toBe(true);
    const cut = await new PrecisionExportEngine(rt).run(
      [
        shape(),
        shape({
          id: "hole",
          kind: "cylinder",
          width: 6,
          depth: 6,
          height: 25,
          hole: true,
          elevation: -2,
        }),
      ],
      "stl",
      { ...DEFAULT_PRECISION, minWallMm: 0, repair: true },
    );
    expect(cut.report.ready, JSON.stringify(cut.report)).toBe(true);
    expect(cut.report.bodies[0].audit.signedVolumeMm3).toBeLessThan(8000);
  });
  it("uses a stored STEP analytic body rather than its coarse display mesh", async () => {
    const { loadBrepWithOcct } = await import("@/lib/brepKernel"),
      brep = await loadBrepWithOcct(),
      body = brep.sphere(10),
      step = brep.exportSTEP(body);
    if (!step.ok) throw Error("STEP fixture generation failed");
    const { importedShapeFromStep } = await import("@/lib/stepImport");
    const imported = await importedShapeFromStep(
      "precision.step",
      await step.value.arrayBuffer(),
    );
    const { analyticMeshForExport } = await import("@/lib/stepExport");
    const fine = await analyticMeshForExport(imported, 0.01, 5);
    expect(fine).not.toBeNull();
    expect(fine!.sampledDeviationMm).toBeLessThanOrEqual(0.01);
  });
  it("writes full precision 3MF coordinates and independently checks its indexed topology", async () => {
    const { PrecisionExportEngine } = await import("@/lib/precisionExport"),
      result = await new PrecisionExportEngine(rt).run([shape()], "3mf", {
        ...DEFAULT_PRECISION,
        minWallMm: 0,
      });
    expect(result.report.ready).toBe(true);
    const xml = strFromU8(unzipSync(result.bytes!)["3D/3dmodel.model"]);
    const vertices = [
      ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g),
    ].map((m) => [+m[1], +m[3], -m[2]] as [number, number, number]);
    const faces = [
      ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
    ].map((m) => [+m[1], +m[2], +m[3]] as [number, number, number]);
    expect(auditManufacturingMesh({ vertices, faces }).valid).toBe(true);
  });
  const fixture = process.env.LAYERLING_SAVED_ORGANIC;
  it.skipIf(!fixture || !existsSync(fixture))(
    "previews cached organic defects and explicitly repairs both STL and 3MF exports without re-hollowing",
    async () => {
      const { importLylProject } = await import("@/lib/lylProject"),
        project = await importLylProject(readFileSync(fixture!));
      const { PrecisionExportEngine } = await import("@/lib/precisionExport"),
        engine = new PrecisionExportEngine(rt);
      const shapes = project.shapes,
        original = JSON.stringify(shapes);
      const raw = await engine.run(shapes, "stl", {
        ...DEFAULT_PRECISION,
        minWallMm: 0,
      });
      expect(raw.bytes).toBeNull();
      expect(raw.report.bodies[0].audit.degenerateFaces).toBeGreaterThan(0);
      for (const format of ["stl", "3mf"] as const) {
        const fixed = await engine.run(shapes, format, {
          ...DEFAULT_PRECISION,
          repair: true,
          minWallMm: 0,
        });
        writeFileSync(
          `.codex-run/organic-repro/precision-${format}-report.json`,
          JSON.stringify(fixed.report, null, 2),
        );
        console.log(
          JSON.stringify({
            format,
            triangles: fixed.report.triangles,
            durationMs: fixed.report.durationMs,
            repair: fixed.report.bodies[0].repair,
            selfIntersections: fixed.report.bodies[0].surface.selfIntersections,
          }),
        );
        expect(fixed.report.ready).toBe(true);
        expect(fixed.bytes).not.toBeNull();
        const cached = await engine.run(shapes, format, {
          ...DEFAULT_PRECISION,
          repair: true,
          minWallMm: 0,
        });
        expect(cached.report.cacheHits).toBeGreaterThan(fixed.report.cacheHits);
        expect(Buffer.compare(fixed.bytes!, cached.bytes!)).toBe(0);
        writeFileSync(
          `.codex-run/organic-repro/precision-${format}-cache-benchmark.json`,
          JSON.stringify(
            {
              coldMs: fixed.report.durationMs,
              warmMs: cached.report.durationMs,
              triangles: cached.report.triangles,
              byteIdentical: true,
            },
            null,
            2,
          ),
        );
        writeFileSync(
          `.codex-run/organic-repro/precision-organic.${format}`,
          fixed.bytes!,
        );
        writeFileSync(
          `.codex-run/organic-repro/precision-${format}-report.json`,
          JSON.stringify(fixed.report, null, 2),
        );
      }
      expect(JSON.stringify(shapes)).toBe(original);
    },
  );
});
