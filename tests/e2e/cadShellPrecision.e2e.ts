import { beforeAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OcctKernel } from "occt-wasm";
import { shellSolid } from "@/lib/cadShell";

describe("precise signed shell offsets", () => {
  let cad: OcctKernel;
  beforeAll(async () => { cad = await OcctKernel.init({ wasm: join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm") }); });
  it("keeps the original cavity and grows an outward closed box by exactly the wall", () => {
    const box = cad.makeBox(40,30,20);
    const shell = shellSolid(cad, box, 2, "none", "sharp", { direction:"outward", tolerance:1e-6 });
    expect(cad.isSolid(shell)).toBe(true); expect(cad.isValid(shell)).toBe(true);
    expect(cad.getVolume(shell)).toBeCloseTo(44*34*24-40*30*20, 3);
    const bounds = cad.getBoundingBox(shell,false);
    expect(bounds.xmin).toBeCloseTo(-2,5); expect(bounds.xmax).toBeCloseTo(42,5);
    expect(bounds.zmin).toBeCloseTo(-2,5); expect(bounds.zmax).toBeCloseTo(22,5);
    cad.releaseAll();
  });
  it("opens a face on outward walls without shrinking the original cavity", () => {
    // Layerling is Y-up; this unrotated box is 30 mm tall in Y.
    const box = cad.makeBox(40,30,20);
    const shell = shellSolid(cad, box, 2, "top", "sharp", { direction:"outward", tolerance:1e-6 });
    expect(cad.isValid(shell)).toBe(true); expect(cad.isSolid(shell)).toBe(true);
    expect(cad.getVolume(shell)).toBeCloseTo(44*32*24-40*30*20,3);
    expect(cad.getBoundingBox(shell,false).ymax).toBeCloseTo(30,5);
    cad.releaseAll();
  });
  it("retains analytic cylindrical surfaces and precise inward wall dimensions", () => {
    const cylinder = cad.makeCylinder(10,20);
    const shell = shellSolid(cad,cylinder,1,"none","sharp",{tolerance:1e-6});
    expect(cad.isValid(shell)).toBe(true);
    expect(cad.getVolume(shell)).toBeCloseTo(Math.PI*(10*10*20-9*9*18),3);
    const faces=cad.getSubShapes(shell,"face");
    expect(faces.filter(face=>cad.surfaceType(face)==="cylinder")).toHaveLength(2);
    cad.releaseAll();
  });
  it("rejects invalid precision and impossible inward walls", () => {
    const box=cad.makeBox(10,10,10);
    expect(()=>shellSolid(cad,box,1,"none","sharp",{tolerance:0.1})).toThrow(/tolerance/);
    expect(()=>shellSolid(cad,box,-1,"none")).toThrow(/thickness/);
    expect(()=>shellSolid(cad,box,6,"none","sharp",{tolerance:1e-6})).toThrow();
    cad.releaseAll();
  });
});
