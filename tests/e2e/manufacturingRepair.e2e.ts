import { beforeAll, describe, it, expect } from "vitest";
import module, { type ManifoldToplevel } from "manifold-3d";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";
import { repairManufacturingMesh } from "@/lib/meshManufacturingRepair";
import { exportMeshesToStl } from "@/lib/stlExport";
import { unzipSync, strFromU8 } from "fflate";

describe("strict manufacturing topology and explicit repair", () => {
  let runtime: ManifoldToplevel;
  beforeAll(async () => {
    runtime = await module();
    runtime.setup();
  });
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
  it("rejects missing, duplicated, reversed and degenerate facets", () => {
    expect(auditManufacturingMesh(tetra).valid).toBe(true);
    for (const faces of [
      tetra.faces.slice(1),
      [...tetra.faces, tetra.faces[0]],
      [...tetra.faces, [0, 1, 1] as [number, number, number]],
      tetra.faces.map((f) => [f[0], f[2], f[1]] as [number, number, number]),
    ])
      expect(auditManufacturingMesh({ ...tetra, faces }).valid).toBe(false);
  });
  it("detects a vertex-only contact between two otherwise closed solids", () => {
    const mesh = {
      vertices: [
        ...tetra.vertices,
        ...tetra.vertices.map(
          (p) => p.map((x) => -x) as [number, number, number],
        ),
      ],
      faces: [
        ...tetra.faces,
        ...tetra.faces.map(
          (f) => [f[0] + 4, f[2] + 4, f[1] + 4] as [number, number, number],
        ),
      ],
    };
    expect(auditManufacturingMesh(mesh).nonManifoldVertices).toBe(1);
  });
  const file = process.env.LAYERLING_SAVED_ORGANIC;
  it.skipIf(!file || !existsSync(file))(
    "repairs the cached actual result and independently reimports a strictly closed STL",
    () => {
      const files = unzipSync(readFileSync(file!)),
        project = JSON.parse(strFromU8(files["project.json"]));
      const node = project.states.find(
        (s: { id: string }) => s.id === project.sceneStateId,
      ).nodes[0];
      const asset = project.assets.find(
        (a: { id: string }) => a.id === node.importedMesh.meshAssetId,
      );
      const b = files[asset.path],
        view = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const positions = Array.from(
        { length: view.getUint32(8, true) },
        (_, i) => view.getFloat64(16 + i * 8, true),
      );
      const vertices = Array.from(
        { length: positions.length / 3 },
        (_, i) => positions.slice(i * 3, i * 3 + 3) as [number, number, number],
      );
      const faces = Array.from(
        { length: vertices.length / 3 },
        (_, i) => [i * 3, i * 3 + 1, i * 3 + 2] as [number, number, number],
      );
      const original = auditManufacturingMesh({ vertices, faces });
      expect(original.valid).toBe(false);
      expect(original.degenerateFaces).toBe(143);
      const fixed = repairManufacturingMesh(
        runtime,
        { vertices, faces },
        0.0001,
      );
      expect(fixed.audit.valid).toBe(true);
      expect(fixed.sampledDeviationMm).toBeLessThanOrEqual(0.0001);
      const bytes = exportMeshesToStl([fixed.mesh]);
      const parsed = new STLLoader().parse(bytes),
        p = parsed.attributes.position.array;
      const imported = {
        vertices: Array.from(
          { length: p.length / 3 },
          (_, i) =>
            [p[i * 3], p[i * 3 + 2], -p[i * 3 + 1]] as [number, number, number],
        ),
        faces: fixed.mesh.faces.map(
          (_, i) => [i * 3, i * 3 + 1, i * 3 + 2] as [number, number, number],
        ),
      };
      const audit = auditManufacturingMesh(imported);
      expect(audit.valid).toBe(true);
      const m = new runtime.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(imported.vertices.flat()),
        triVerts: Uint32Array.from(imported.faces.flat()),
        tolerance: 1e-7,
      });
      m.merge();
      const solid = runtime.Manifold.ofMesh(m);
      try {
        expect(solid.status()).toBe("NoError");
        expect(solid.volume()).toBeGreaterThan(0);
      } finally {
        solid.delete();
        parsed.dispose();
      }
      writeFileSync(
        ".codex-run/organic-repro/hollowed-organic-manifold-fixed.stl",
        Buffer.from(bytes),
      );
      writeFileSync(
        ".codex-run/organic-repro/manifold-fix-report.json",
        JSON.stringify(
          { original, ...fixed, mesh: undefined, exported: audit },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          repairTriangles: fixed.audit.triangles,
          sampledDeviationMm: fixed.sampledDeviationMm,
          exported: audit,
        }),
      );
    },
  );
});
