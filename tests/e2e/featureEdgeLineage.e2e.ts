import { expect, it } from "vitest";
import { OcctKernel } from "occt-wasm";
import { cutWithNamedFaces, resolveFeatureEdge, type NamedFaces } from "@/lib/featureEdgeLineage";
it("replays the surviving hole's fillet and diagnoses the suppressed rim", async () => {
  const cad = await OcctKernel.init({ wasm: "node_modules/occt-wasm/dist/occt-wasm.wasm" });
  try {
    for (const omitFirst of [false, true]) {
      let solid = cad.makeBox(60,40,5);
      let roles: NamedFaces = new Map([["pad/top", cad.getSubShapes(solid,"face").filter(f => cad.getBoundingBox(f).zmin === 5)]]);
      for (const [id,x] of [["holeA",15],["holeB",45]] as const) {
        if (omitFirst && id === "holeA") continue;
        const cutter = cad.translate(cad.makeCylinder(2,7),x,20,-1);
        roles.set(id+"/wall", cad.getSubShapes(cutter,"face").filter(f => cad.surfaceType(f) === "cylinder"));
        const result = cutWithNamedFaces(cad,solid,cutter,roles);
        solid = result.solid;
        roles = result.faces;
      }
      const rim = (id: string) => resolveFeatureEdge(cad, roles, {firstFace:"pad/top",secondFace:id+"/wall"});
      if (omitFirst) expect(() => rim("holeA")).toThrow(/Missing feature face/);
      else expect(cad.getBoundingBox(rim("holeA")).xmin).toBeCloseTo(13,6);
      const edge = rim("holeB");
      expect(cad.getBoundingBox(edge).xmin).toBeCloseTo(43,6);
      const owners = cad.getSubShapes(solid,"solid").filter(body => cad.getSubShapes(body,"edge").some(e => cad.isSame(e,edge)));
      expect(owners).toHaveLength(1);
      const filleted = cad.fillet(owners[0],[edge],0.5);
      expect(cad.isValid(filleted)).toBe(true);
      expect(cad.getVolume(filleted)).toBeLessThan(cad.getVolume(solid));
      cad.releaseAll();
    }
  } finally { cad.releaseAll(); }
});
