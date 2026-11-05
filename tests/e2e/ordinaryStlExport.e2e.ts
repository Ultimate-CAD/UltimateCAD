import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, expect, it, vi } from "vitest";
import manifoldModule from "manifold-3d";
import { rememberManifoldRuntime } from "@/lib/manifoldHandle";
import type { WorkplaneShape } from "@/types/layerling";
import { DEFAULT_STL_QUALITY, STL_QUALITY_PRESETS } from "@/lib/stlQuality";


const runtime = vi.hoisted(() => ({ ready: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (original) => ({
  ...(await original<typeof import("@/lib/editorMeshCore")>()),
  getManifoldRuntime: () => runtime.ready,
}));
beforeAll(async () => {
  runtime.ready = manifoldModule().then(rt => { rt.setup(); rememberManifoldRuntime(rt); return rt; });
  await runtime.ready;
});

vi.mock("@/lib/brepKernel", async () => {
  const { occtExportTestKernel } = await import("../helpers/occtExportKernel");
  const source = await occtExportTestKernel();
  const kernel = source.occtKernel();
  return { ...source, occtKernel: () => new Proxy(kernel, { get(target, key) {
    if (key === "projectPointOnFace") return () => { throw Error("Ordinary export must not measure/certify tessellation"); };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) };
});

const shape = (kind: WorkplaneShape["kind"], id: string = kind, x = 0): WorkplaneShape => ({
  id, kind, name: id, x, z: 0, elevation: 0, size: 20, width: 20, depth: 20,
  height: 20, color: "#0169cc", rotation: 0, sides: 96, hole: false,
});
function encoded(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  expect(count).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + count * 50);
  expect(new TextDecoder().decode(bytes.subarray(0, 80))).toContain("UNVERIFIED");
  for (let i = 0; i < count; i++) for (let n = 0; n < 12; n++) expect(Number.isFinite(view.getFloat32(84 + i * 50 + n * 4, true))).toBe(true);
  return count;
}

function volume(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  for(let i=0;i<view.getUint32(80,true);i++) {
    const p=Array.from({length:9},(_,j)=>view.getFloat32(96+i*50+j*4,true));
    total+=(p[0]*(p[4]*p[8]-p[5]*p[7])+p[1]*(p[5]*p[6]-p[3]*p[8])+p[2]*(p[3]*p[7]-p[4]*p[6]))/6;
  }
  return Math.abs(total);
}
function sphereSag(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let max = 0;
  for(let i=0;i<view.getUint32(80,true);i++) {
    const centroid=[0,1,2].map(axis=>[0,1,2].reduce((sum,k)=>sum+view.getFloat32(96+i*50+k*12+axis*4,true),0)/3);
    max=Math.max(max,Math.abs(10-Math.hypot(centroid[0],centroid[1],centroid[2]-10)));
  }
  return max;
}

it("exports native primitives, grouped/overlapping solids, holes and separate shells without certification", async () => {
  const { exportStlDesign } = await import("@/lib/stlDesignExport");
  const { buildGroupedShapeFromSelection } = await import("@/lib/editorBooleans");
  const a = shape("box"), b = shape("cylinder", "cylinder", 6);
  const grouped = await buildGroupedShapeFromSelection([a, b], 1_000_000);
  expect(grouped.group).not.toBeNull();
  const cases = [[a], [shape("sphere")], [b], [a,b], [grouped.group!], [a,shape("box","separate",50)], [a,{...shape("cylinder","hole"),size:6,width:6,depth:6,height:30,elevation:-5,hole:true}]];
  for (const source of cases) {
    const before = JSON.stringify(source), result = await exportStlDesign(source);
    expect(result.quality).toEqual(DEFAULT_STL_QUALITY);
    expect(result.verified).toBe(false);
    encoded(result.bytes);
    expect(JSON.stringify(source)).toBe(before);
  }
});

it("refines actual curved CAD geometry at High, Ultra and Custom without adding facets to stored meshes", async () => {
  const { exportStlDesign } = await import("@/lib/stlDesignExport");
  const sphere = shape("sphere"), counts: number[] = [], sag: number[] = [];
  for (const preset of ["standard","high","ultra"] as const) {
    const result=await exportStlDesign([sphere],{preset,...STL_QUALITY_PRESETS[preset]});
    counts.push(encoded(result.bytes));sag.push(sphereSag(result.bytes));
  }
  expect(sag[1]).toBeLessThan(sag[0]);expect(sag[2]).toBeLessThan(sag[1]);
  mkdirSync(".codex-run/simple-stl",{recursive:true});
  writeFileSync(".codex-run/simple-stl/sphere-fidelity.json",JSON.stringify({counts,maxTriangleCentroidDeviationMm:sag},null,2));
  expect(counts[1]).toBeGreaterThan(counts[0]);
  expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
  const custom = await exportStlDesign([sphere],{preset:"custom",deviationMm:0.002,angleDeg:3});
  expect(encoded(custom.bytes)).toBeGreaterThan(counts[2]);
});

it("exports unclosed and zero-area source facets without analysis, repair, subdivision or loss", async () => {
  const { exportStlDesign } = await import("@/lib/stlDesignExport");
  const mesh: WorkplaneShape = {...shape("mesh"), importedMesh: {positions:[0,0,0, 20,0,0, 0,20,0, 0,0,0, 0,0,0, 20,0,0],baseWidth:20,baseHeight:20,baseDepth:20,triangleCount:2,sourceFormat:"stl"}};
  const original = JSON.stringify(mesh);
  for (const preset of ["standard","high","ultra"] as const) {
    const result = await exportStlDesign([mesh],{preset,...STL_QUALITY_PRESETS[preset]});
    expect(encoded(result.bytes)).toBe(2);
    expect(JSON.stringify(mesh)).toBe(original);
  }
  const crossing={...mesh,importedMesh:{...mesh.importedMesh!,positions:[0,0,0,20,0,0,0,20,0,5,5,-10,5,5,10,15,5,0]}};
  expect(encoded((await exportStlDesign([crossing])).bytes)).toBe(2);
  await expect(exportStlDesign([])).rejects.toThrow(/No geometry/);
  await expect(exportStlDesign([{...shape("mesh"),importedMesh:undefined}])).rejects.toThrow(/missing/);
  await expect(exportStlDesign([shape("box")],{preset:"custom",deviationMm:-1,angleDeg:1})).rejects.toThrow(/positive deviation/);
});

it("retains union volume, multiple shells and tiny intended components", async () => {
  const { exportStlDesign } = await import("@/lib/stlDesignExport");
  const joined=await exportStlDesign([shape("box","a"),shape("box","b",8)]);
  expect(volume(joined.bytes)).toBeCloseTo(28*20*20,4);
  expect(joined.mergedBodies).toBe(2);
  const shells=await exportStlDesign([shape("box","a"),shape("box","b",50)]);
  expect(shells.bodies).toBe(2);expect(volume(shells.bytes)).toBeCloseTo(2*20**3,4);
  const tiny={...shape("box","tiny",50),size:0.01,width:0.01,depth:0.01,height:0.01};
  const kept=await exportStlDesign([shape("box"),tiny]);
  expect(kept.bodies).toBe(2);expect(kept.triangles).toBe(24);
});
