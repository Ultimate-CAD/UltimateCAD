import { beforeAll, expect, it } from "vitest";
import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import { unzipSync, strFromU8 } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { cutHollowBase, prepareFinishingSource, validateFinishing } from "@/lib/hollowFinishing";
import { finishedMeshShape, finishingSourcePositions } from "@/lib/hollowFinishingShape";
import { exportLylProject, importLylProject } from "@/lib/lylProject";
import { DEFAULT_WORKPLANE_WORKSPACE, DEFAULT_SNAP_GRID } from "@/lib/workplaneSettings";
import { PrecisionExportEngine } from "@/lib/precisionExport";
import { DEFAULT_PRECISION } from "@/lib/precisionMesh";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";
import { meshForShape } from "@/lib/editorMeshCore";
import type { WorkplaneShape } from "@/types/layerling";

let rt: ManifoldToplevel;
beforeAll(async () => { rt = await manifoldModule(); rt.setup(); });

it("persists the real edited solid and independently validates Precision STL and 3MF topology", async () => {
  const outer = rt.Manifold.cube([20, 20, 20]).translate([-10, 0, -10]);
  const cavity = rt.Manifold.cube([16, 16, 16]).translate([-8, 2, -8]);
  const solid = outer.subtract(cavity), native = solid.getMesh();
  const raw = Array.from(native.triVerts).flatMap(i => Array.from(native.vertProperties.subarray(i * 3, i * 3 + 3)));
  outer.delete(); cavity.delete(); solid.delete();
  const original = { id: "finishing-same-id", kind: "mesh", name: "Hollow mechanical fixture", x: 0, z: 0, elevation: 0, width: 20, depth: 20, height: 20, size: 20, rotation: 0, locked: false, hidden: false, color: "#0098c7", importedMesh: { positions: raw, baseWidth: 20, baseDepth: 20, baseHeight: 20, triangleCount: raw.length / 9, sourceFormat: "json" } } as WorkplaneShape;
  const source = prepareFinishingSource(meshForShape(original));
  const result = cutHollowBase(rt, source, { axis: 1, position: 3.1, keepPositive: true });
  validateFinishing(source, result);
  const positions = Float64Array.from(result.mesh.faces.flatMap(f => f.flatMap(i => result.mesh.vertices[i]))), finished = finishedMeshShape(original, positions);
  const project = await exportLylProject({ projectId: "hollow-finishing-e2e", projectName: "Hollow finishing", createdAt: 1, modifiedAt: 2, shapes: [finished], history: [], historyIndex: 0, assets: [], workspace: DEFAULT_WORKPLANE_WORKSPACE, snapGrid: DEFAULT_SNAP_GRID, placementElevation: 0 });
  const restored = await importLylProject(project), shape = restored.shapes[0];
  expect(shape.id).toBe(original.id); expect(shape.importedMesh!.positions).toEqual(finished.importedMesh!.positions);
  expect(shape.height).toBeCloseTo(16.9, 10); expect(original.importedMesh!.positions).toEqual(raw);
  const engine = new PrecisionExportEngine(rt);
  for (const format of ["stl", "3mf"] as const) {
    const exported = await engine.run([shape], format, { ...DEFAULT_PRECISION, minWallMm: 0 });
    expect(exported.report.ready, JSON.stringify(exported.report)).toBe(true);
    let vertices: [number, number, number][] = [], faces: [number, number, number][] = [];
    if (format === "stl") {
      const geo = new STLLoader().parse(exported.bytes!.buffer as ArrayBuffer), p = geo.getAttribute("position");
      for (let i = 0; i < p.count; i++) vertices.push([p.getX(i), p.getZ(i), -p.getY(i)]);
      for (let i = 0; i < p.count; i += 3) faces.push([i, i + 1, i + 2]); geo.dispose();
    } else {
      const zip = unzipSync(exported.bytes!), xml = strFromU8(zip["3D/3dmodel.model"]);
      const attribute = (tag: string, name: string) => Number(tag.match(new RegExp(`${name}="([^"]+)"`))![1]);
      vertices = [...xml.matchAll(/<vertex\s[^>]+>/g)].map(([tag]) => [attribute(tag, "x"), attribute(tag, "z"), -attribute(tag, "y")]);
      faces = [...xml.matchAll(/<triangle\s[^>]+>/g)].map(([tag]) => [attribute(tag, "v1"), attribute(tag, "v2"), attribute(tag, "v3")]);
    }
    const audit = auditManufacturingMesh({ vertices, faces });
    expect(audit).toMatchObject({ valid: true, boundaryEdges: 0, nonManifoldEdges: 0, nonManifoldVertices: 0, windingMismatches: 0, degenerateFaces: 0, duplicateFaces: 0, solidComponents: 1 });
    expect(audit.dimensionsMm[1]).toBeCloseTo(16.9, 5);
  }
});
