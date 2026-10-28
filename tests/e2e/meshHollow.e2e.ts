import { describe, expect, it, beforeAll } from "vitest";
import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import { SphereGeometry, BoxGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { exportMeshesToStl } from "@/lib/stlExport";
import { hollowMesh } from "@/lib/meshHollow";

describe("mesh-native cavity generation",()=>{
  let runtime:ManifoldToplevel;
  beforeAll(async()=>{runtime=await manifoldModule();runtime.setup();});
  it("hollows a faceted sphere while retaining its original outside",()=>{
    const geometry=new SphereGeometry(10,32,20);
    const result=hollowMesh(runtime,{positions:geometry.attributes.position.array,indices:geometry.index!.array,thickness:2,openings:"none"});
    expect(result.stats.method).toBe("mesh-sdf");
    expect(result.stats.measuredErrorMm).toBeLessThanOrEqual(0.1);
    expect(result.stats.resultVolumeMm3).toBeLessThan(result.stats.sourceVolumeMm3);
    expect(result.stats.cavityVolumeMm3).toBeGreaterThan(1500);
    console.log(JSON.stringify(result.stats));geometry.dispose();
  });
  it("opens a flat base with mesh distance offsets",()=>{
    const geometry=new BoxGeometry(20,20,20);
    const result=hollowMesh(runtime,{positions:geometry.attributes.position.array,indices:geometry.index!.array,thickness:2,openings:"bottom"});
    expect(result.stats.resultVolumeMm3).toBeCloseTo(8000-16*16*18,-1);
    expect(result.stats.measuredErrorMm).toBeLessThanOrEqual(0.1);geometry.dispose();
  });
  const repro=process.env.LAYERLING_ORGANIC_REPRO;
  it.skipIf(!repro||!existsSync(repro))("hollows the actual captured organic OBJ result",()=>{
    const bytes=readFileSync(repro!);const geometry=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const positions=Array.from(geometry.attributes.position.array);
    // Exported STL is Z-up; editor and shell sides are Y-up.
    for(let i=0;i<positions.length;i+=3){const y=positions[i+2];positions[i+2]=-positions[i+1];positions[i+1]=y;}
    const indices=Array.from({length:positions.length/3},(_,i)=>i);
    const result=hollowMesh(runtime,{positions,indices,thickness:2,openings:"none"},message=>console.log(message));
    expect(result.stats.measuredErrorMm).toBeLessThanOrEqual(0.1);
    const vertices=Array.from({length:result.positions.length/3},(_,i)=>result.positions.slice(i*3,i*3+3) as [number,number,number]);
    const faces=Array.from({length:result.indices.length/3},(_,i)=>result.indices.slice(i*3,i*3+3) as [number,number,number]);
    writeFileSync(".codex-run/organic-repro/hollow-closed-2mm.stl",Buffer.from(exportMeshesToStl([{vertices,faces}])));
    writeFileSync(".codex-run/organic-repro/result.json",JSON.stringify(result.stats,null,2));
    console.log(JSON.stringify(result.stats));geometry.dispose();
  },300000);
});
