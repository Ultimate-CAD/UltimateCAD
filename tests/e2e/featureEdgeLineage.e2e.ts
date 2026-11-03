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
import {createSketchPadHistory} from "@/lib/sketchPadHistory";
import {replayThroughHoles} from "@/lib/replayThroughHoles";
it("applies the requested treatment to its owning hole after suppression",async()=>{
  const cad=await OcctKernel.init({wasm:"node_modules/occt-wasm/dist/occt-wasm.wasm"});
  try {
    const pad=cad.makeBox(60,5,40);
    const h=createSketchPadHistory(5);
    h.holes=[
      {kind:"throughHole",id:"a",inputId:h.pad.id,xMm:15,zMm:20,diameterMm:4,suppressed:true},
      {kind:"throughHole",id:"b",inputId:"a",xMm:45,zMm:20,diameterMm:4,suppressed:false},
    ];
    const plain=replayThroughHoles(cad,pad,h);
    for(const kind of ["fillet","chamfer"] as const){
      h.rimFinish={kind,id:"finish",inputId:"b",holeId:"b",sizeMm:.5,suppressed:false};
      const result=replayThroughHoles(cad,pad,h);
      expect(cad.isValid(result)).toBe(true);
      expect(cad.getVolume(result)).toBeLessThan(cad.getVolume(plain));
      expect(cad.containsPoint(result,{x:15,y:4.9,z:20})).toBe(true);
      expect(cad.containsPoint(result,{x:45,y:4.9,z:20})).toBe(false);
      h.rimFinish.holeId="a";
      expect(()=>replayThroughHoles(cad,pad,h)).toThrow(/Missing feature face/);
    }
  }finally{cad.releaseAll();}
});
import {FeatureSolidCache} from "@/lib/featureSolidCache";
it("reuses exact pad geometry across native arena resets, invalidates a changed depth and never caches an error",async()=>{
  const cad=await OcctKernel.init({wasm:"node_modules/occt-wasm/dist/occt-wasm.wasm"});
  const cache=new FeatureSolidCache();
  let builds=0;
  const pad=(h:number)=>cache.run(cad,"pad/"+h,()=>{builds++;return cad.makeBox(10,h,2);});
  try{
    expect(cad.getVolume(pad(5))).toBeCloseTo(100);
    cad.releaseAll();
    expect(cad.getVolume(pad(5))).toBeCloseTo(100);
    expect(cad.getVolume(pad(6))).toBeCloseTo(120);
    expect(builds).toBe(2);
    expect(()=>cache.run(cad,"failed",()=>{throw Error("build failed");})).toThrow();
    expect(cad.isValid(cache.run(cad,"failed",()=>cad.makeBox(1,1,1)))).toBe(true);
  }finally{cad.releaseAll();}
});
it("cuts both pattern types and blocks a removed instance referenced by a rim treatment",async()=>{
  const cad=await OcctKernel.init({wasm:"node_modules/occt-wasm/dist/occt-wasm.wasm"});
  try{
    const pad=cad.makeBox(60,5,40);
    const h=createSketchPadHistory(5);
    h.holes=[{id:"hole",kind:"throughHole",inputId:h.pad.id,suppressed:false,xMm:35,zMm:20,diameterMm:2,
      pattern:{id:"repeat",inputId:"hole",kind:"linear",count:3,stepX:5,stepZ:0,centerX:30,centerZ:20,angleDeg:90}}];
    for(const kind of ["linear","circular"] as const){
      h.holes[0].pattern!.kind=kind;
      const solid=replayThroughHoles(cad,pad,h);
      expect(cad.getVolume(solid)).toBeCloseTo(12000-15*Math.PI,6);
      for(const [x,z] of kind==="linear"?[[35,20],[40,20],[45,20]]:[[35,20],[30,25],[25,20]]){
        expect(cad.containsPoint(solid,{x,y:2,z})).toBe(false);
      }
    }
    h.rimFinish={id:"finish",kind:"chamfer",inputId:"hole",holeId:"hole",instance:2,patternId:"repeat",suppressed:false,sizeMm:.25};
    expect(cad.isValid(replayThroughHoles(cad,pad,h))).toBe(true);
    h.holes[0].pattern!.count=2;
    expect(()=>replayThroughHoles(cad,pad,h)).toThrow(/Missing feature face/);
  }finally{cad.releaseAll();}
});
