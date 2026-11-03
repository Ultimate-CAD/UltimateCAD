import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as api from "@salusoft89/planegcs";
import { constraintSketchProfile, mountingPlateSketch, solveConstraintSketch, type ConstraintSketch, type PlaneGcsRuntime } from "@/lib/constraintSketch";
import { OcctKernel } from "occt-wasm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cadSketchRegions } from "@/lib/sketchCadProfile";
import { pathWire } from "@/lib/sketchCadWire";
let runtime: PlaneGcsRuntime;
beforeAll(async()=>{runtime={api,module:await api.init_planegcs_module({wasmBinary:new Uint8Array(readFileSync("node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm"))})};});
describe("bundled PlaneGCS constrained sketches",()=>{
  it("rebuilds analytic OCCT mounting plate solids after upstream dimensional edits",async()=>{
    const cad=await OcctKernel.init({wasm:join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))),"occt-wasm.wasm")});
    try{for(const edited of [false,true]){
      const d=mountingPlateSketch();if(edited){d.constraints.find(c=>c.id==="outer-radius")!.value=45;d.constraints.find(c=>c.id==="pitch-radius")!.value=32;d.constraints.find(c=>c.id==="hole-radius")!.value=3;}
      const solved=solveConstraintSketch(d,runtime);expect(solved.valid).toBe(true);const regions=cadSketchRegions(constraintSketchProfile(solved.document));expect(regions).toHaveLength(1);expect(regions[0].holes).toHaveLength(6);
      let face=cad.makeFace(pathWire(cad,regions[0].outer));face=cad.addHolesInFace(face,regions[0].holes.map(h=>pathWire(cad,h)));const solid=cad.extrude(face,0,d.extrusionMm,0);
      expect(cad.isValid(solid)).toBe(true);const expected=Math.PI*((edited?45:40)**2-6*(edited?3:2.5)**2)*5;expect(Math.abs(cad.getVolume(solid)-expected)).toBeLessThan(1e-6);expect(cad.tessellate(solid,{linearDeflection:.05,angularDeflection:.2}).indices.length).toBeGreaterThan(0);cad.releaseAll();
    }}finally{cad.releaseAll();}
  });
  it("solves a fully constrained six-hole plate and changes bolt/outer/hole dimensions without moving IDs",()=>{
    const input=mountingPlateSketch(),before=JSON.stringify(input),a=solveConstraintSketch(input,runtime);
    expect(a.valid,JSON.stringify(a)).toBe(true);expect(a.dof).toBe(0);expect(JSON.stringify(input)).toBe(before);
    const changed=structuredClone(a.document);changed.constraints.find(c=>c.id==="pitch-radius")!.value=32;changed.constraints.find(c=>c.id==="outer-radius")!.value=45;changed.constraints.find(c=>c.id==="hole-radius")!.value=3;
    const b=solveConstraintSketch(changed,runtime);expect(b.valid,JSON.stringify(b)).toBe(true);expect(b.dof).toBe(0);
    for(let i=0;i<6;i++){const center=b.document.entities.find(e=>e.id===`center-${i}`)!;expect(center.kind).toBe("point");if(center.kind==="point")expect(Math.hypot(center.x,center.y)).toBeCloseTo(32,7);}
    expect(b.document.entities.map(e=>e.id)).toEqual(input.entities.map(e=>e.id));
    const profile=constraintSketchProfile(b.document);expect(profile.constraintSketch).toEqual(b.document);expect(profile.segments.filter(s=>!s.construction)).toHaveLength(28);expect(profile.segments.filter(s=>s.analyticMidpoint)).toHaveLength(32);
  });
  it("identifies conflicts and redundancy and preserves the caller's source",()=>{
    const d=mountingPlateSketch();d.constraints.push({id:"conflicting-radius",kind:"radius",first:"outer",value:50});const before=JSON.stringify(d),a=solveConstraintSketch(d,runtime);expect(a.valid).toBe(false);expect(a.conflicts.length).toBeGreaterThan(0);expect(JSON.stringify(d)).toBe(before);
    const r=mountingPlateSketch();r.constraints.push({id:"duplicate-radius",kind:"radius",first:"outer",value:40});const b=solveConstraintSketch(r,runtime);expect(b.redundant.length).toBeGreaterThan(0);
  });
  it("reports underconstraint and rejects dangling references/non-finite dimensions",()=>{
    const d:ConstraintSketch={schema:1,title:"Point",entities:[{id:"p",kind:"point",x:1,y:2,fixed:false}],constraints:[],extrusionMm:2};const a=solveConstraintSketch(d,runtime);expect(a.valid).toBe(true);expect(a.dof).toBe(2);
    expect(()=>solveConstraintSketch({...d,constraints:[{id:"bad",kind:"distance",first:"p",second:"missing",value:3}]},runtime)).toThrow(/reference/);
    expect(()=>solveConstraintSketch({...d,extrusionMm:NaN},runtime)).toThrow(/finite/);
  });
  it("solves parallel/perpendicular/equal line dimensions, coordinates, concentricity and tangency",()=>{
    for(const kind of ["parallel","perpendicular"] as const){
      const d:ConstraintSketch={schema:1,title:kind,extrusionMm:2,entities:[{id:"a",kind:"point",x:0,y:0,fixed:true},{id:"b",kind:"point",x:10,y:0,fixed:true},{id:"c",kind:"point",x:0,y:10,fixed:true},{id:"d",kind:"point",x:kind==="parallel"?9:1,y:kind==="parallel"?11:19,fixed:false},{id:"l0",kind:"line",start:"a",end:"b"},{id:"l1",kind:"line",start:"c",end:"d"}],constraints:[{id:"orientation",kind,first:"l0",second:"l1"},{id:"length",kind:"equal",first:"l0",second:"l1"}]};
      const r=solveConstraintSketch(d,runtime);expect(r.valid,JSON.stringify(r)).toBe(true);expect(r.dof).toBe(0);const p=r.document.entities.find(e=>e.id==="d")!;if(p.kind==="point"){expect(p.x).toBeCloseTo(kind==="parallel"?10:0,7);expect(p.y).toBeCloseTo(kind==="parallel"?10:20,7);}
    }
    const d:ConstraintSketch={schema:1,title:"Tangent",extrusionMm:2,entities:[{id:"a",kind:"point",x:-10,y:0,fixed:true},{id:"b",kind:"point",x:10,y:0,fixed:true},{id:"c",kind:"point",x:0,y:4,fixed:false},{id:"c2",kind:"point",x:1,y:6,fixed:false},{id:"l",kind:"line",start:"a",end:"b"},{id:"circle",kind:"circle",center:"c",radius:5},{id:"inner",kind:"circle",center:"c2",radius:3}],constraints:[{id:"tangent",kind:"tangent",first:"l",second:"circle"},{id:"r",kind:"radius",first:"circle",value:5},{id:"cx",kind:"x",first:"c",value:0},{id:"centers",kind:"concentric",first:"circle",second:"inner"},{id:"r2",kind:"diameter",first:"inner",value:6}]};
    const r=solveConstraintSketch(d,runtime);expect(r.valid,JSON.stringify(r)).toBe(true);expect(r.dof).toBe(0);const p=r.document.entities.find(e=>e.id==="c")!;if(p.kind==="point")expect(p.y).toBeCloseTo(5,7);
  });
  it("keeps true circular arcs and declared coincident endpoint topology through OCCT",async()=>{
    const d:ConstraintSketch={schema:1,title:"Arc",extrusionMm:2,entities:[{id:"c",kind:"point",x:0,y:0,fixed:true},{id:"a",kind:"point",x:10,y:0,fixed:false},{id:"b",kind:"point",x:0,y:10,fixed:false},{id:"line-end",kind:"point",x:0,y:9,fixed:false},{id:"arc",kind:"arc",center:"c",start:"a",end:"b",radius:10,startAngle:0,endAngle:90},{id:"chord",kind:"line",start:"line-end",end:"a"}],constraints:[{id:"radius",kind:"radius",first:"arc",value:8},{id:"start-y",kind:"y",first:"a",value:0},{id:"end-x",kind:"x",first:"b",value:0},{id:"join",kind:"coincident",first:"b",second:"line-end"}]};
    const r=solveConstraintSketch(d,runtime);expect(r.valid,JSON.stringify(r)).toBe(true);expect(r.dof).toBe(0);const profile=constraintSketchProfile(r.document),regions=cadSketchRegions(profile);expect(regions).toHaveLength(1);
    const cad=await OcctKernel.init({wasm:join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))),"occt-wasm.wasm")});try{const face=cad.makeFace(pathWire(cad,regions[0].outer)),solid=cad.extrude(face,0,2,0);expect(cad.isValid(solid)).toBe(true);expect(Math.abs(cad.getVolume(solid)-64*(Math.PI/4-.5)*2)).toBeLessThan(1e-6);}finally{cad.releaseAll();}
  });
});
import { createSketchPadHistory } from "@/lib/sketchPadHistory";
it("drives an actual pad from named expressions and preserves its sketch source", async()=>{
  const apiModule=await api.init_planegcs_module({wasmBinary:new Uint8Array(readFileSync("node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm"))});
  const cad=await OcctKernel.init({wasm:"node_modules/occt-wasm/dist/occt-wasm.wasm"});
  try {
    const source=mountingPlateSketch();
    source.featureHistory=createSketchPadHistory(5);
    source.featureHistory.parameters=[{name:"stock",expression:"3 mm",unit:"mm"},{name:"depth",expression:"2 * stock",unit:"mm"}];
    for(const depth of [6,8]){
      source.featureHistory.parameters[0].expression=depth/2+" mm";
      const result=solveConstraintSketch(source,{api,module:apiModule});
      expect(result.valid).toBe(true);
      expect(result.document.extrusionMm).toBe(depth);
      const [region]=cadSketchRegions(constraintSketchProfile(result.document));
      const face=cad.addHolesInFace(cad.makeFace(pathWire(cad,region.outer)),region.holes.map(h=>pathWire(cad,h)));
      const solid=cad.extrude(face,0,result.document.extrusionMm,0);
      expect(cad.isValid(solid)).toBe(true);
      expect(cad.getVolume(solid)).toBeCloseTo(Math.PI*(40**2-6*2.5**2)*depth,6);
    }
    expect(source.extrusionMm).toBe(5);
  } finally {cad.releaseAll();}
});
