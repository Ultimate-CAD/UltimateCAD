import { describe, expect, it } from "vitest";
import { parseCustomizer } from "@/lib/openscad/vendor/scadParser.cjs";
import { newOpenScadDocument, OPENSCAD_EXAMPLE, validateOpenScadDocument } from "@/lib/openScadTypes";
import { importedShapeFromTriangleSoup, importedShapeFromStl } from "@/lib/stlImport";
import { exportLylProject, importLylProject } from "@/lib/lylProject";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";

const tetrahedron = [0,0,0, 0,1,0, 1,0,0, 0,0,0, 1,0,0, 0,0,1, 0,0,0, 0,0,1, 0,1,0, 1,0,0, 0,1,0, 0,0,1];
describe("OpenSCAD representation and persistence", () => {
  it("uses an explicit Z-up conversion for tall SCAD output without changing legacy STL heuristics", () => {
    const stl = new TextEncoder().encode("solid tower\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 2 0\nvertex 0 0 30\nendloop\nendfacet\nendsolid tower\n").buffer;
    const scad = importedShapeFromStl("tower.stl", stl, true);
    expect(scad.height).toBeCloseTo(30); expect(scad.depth).toBeCloseTo(2);
    expect(importedShapeFromStl("tower.stl", stl).height).toBeCloseTo(2);
  });
  it("reuses upstream Customizer semantics for literal controls and hides derived expressions", () => {
    const schema = parseCustomizer(OPENSCAD_EXAMPLE);
    expect(schema.parameters.map(p => p.name)).toEqual(["width", "depth", "height", "wall", "round_hole", "quality"]);
    expect(schema.parameters.find(p => p.name === "width")).toMatchObject({ widget: "slider", min: 10, max: 100, step: 1 });
    expect(schema.parameters.find(p => p.name === "quality")?.options).toEqual([{ value: 16, label: "Low" }, { value: 32, label: "Normal" }, { value: 64, label: "Fine" }]);
    expect(schema.modules).toContain("shell");
  });
  it("preserves complete source, overrides, presets, dependency snapshots and undo states in LYL", async () => {
    const doc = newOpenScadDocument();
    doc.parameters = { width: 52, round_hole: false };
    doc.expressions = { height: "width/4" };
    doc.presets = { wide: { parameters: { width: 52 }, expressions: { height: "width/4" } } };
    doc.files = { "project/library.scad": { encoding: "utf8", data: "module bar(){ cube(2); }" } };
    const original = { ...importedShapeFromTriangleSoup("part.stl", tetrahedron, undefined), openScad: doc };
    const changed = { ...original, openScad: { ...doc, parameters: { ...doc.parameters, width: 64 } } };
    const before = editorHistoryEntry([original], [original.id]);
    const after = editorHistoryEntry([changed], [original.id]);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    const bytes = await exportLylProject({ projectId: "scad-project", projectName: "SCAD project", createdAt: 1, modifiedAt: 2,
      shapes: [changed], assets: [], history: [before, after], historyIndex: 1, workspace: DEFAULT_WORKPLANE_WORKSPACE, snapGrid: DEFAULT_SNAP_GRID, placementElevation: 0 });
    const restored = await importLylProject(bytes.buffer as ArrayBuffer);
    expect(restored.shapes[0].openScad).toEqual(changed.openScad);
    expect(restored.shapes[0].id).toBe(original.id);
    expect(restored.shapes[0].kind).toBe("mesh");
    expect(restored.shapes[0].cadBrep).toBeUndefined();
    expect(restored.shapes[0].importedMesh?.brepStep).toBeUndefined();
    expect(restored.history?.[0].shapes[0].openScad).toEqual(original.openScad);
  });
  it("rejects invalid persisted SCAD metadata and non-finite overrides", () => {
    expect(() => validateOpenScadDocument({ ...newOpenScadDocument(), source: 12 })).toThrow();
    expect(() => validateOpenScadDocument({ ...newOpenScadDocument(), parameters: { width: Infinity } })).toThrow();
    expect(() => validateOpenScadDocument({ ...newOpenScadDocument(), expressions: { "bad-name": "2" } })).toThrow();
  });
});
