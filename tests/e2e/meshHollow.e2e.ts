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
  it("rejects non-finite vertices and invalid triangle indices",()=>{
    const geometry=new BoxGeometry(10,10,10);
    const positions=Array.from(geometry.attributes.position.array);
    const indices=Array.from(geometry.index!.array);
    const nonFinite=[...positions];nonFinite[0]=Number.NaN;
    expect(()=>hollowMesh(runtime,{positions:nonFinite,indices,thickness:1,openings:"none"})).toThrow(/non-finite coordinates/i);
    const invalid=[...indices];invalid[0]=positions.length/3;
    expect(()=>hollowMesh(runtime,{positions,indices:invalid,thickness:1,openings:"none"})).toThrow(/invalid triangle indices/i);
    geometry.dispose();
  });
  it("rejects an open mesh with a closed-oriented-solid diagnostic",()=>{
    const geometry=new BoxGeometry(10,10,10);
    expect(geometry.index).not.toBeNull();
    const openIndices=geometry.index!.array.slice(0,-6);
    expect(()=>hollowMesh(runtime,{positions:geometry.attributes.position.array,indices:openIndices,thickness:1,openings:"none"}))
      .toThrow(/closed, consistently oriented solid/i);
    geometry.dispose();
  });
  it("reports that no cavity fits when the wall is thicker than the source",()=>{
    const geometry=new BoxGeometry(10,10,10);
    expect(()=>hollowMesh(runtime,{positions:geometry.attributes.position.array,indices:geometry.index!.array,thickness:6,openings:"none"}))
      .toThrow(/no internal cavity fits this wall thickness/i);
    geometry.dispose();
  });
  it("asks for Closed when a faceted sphere has no flat top face",()=>{
    const geometry=new SphereGeometry(10,24,16);
    expect(()=>hollowMesh(runtime,{positions:geometry.attributes.position.array,indices:geometry.index!.array,thickness:1,openings:"top"}))
      .toThrow(/no flat top face.*choose Closed \(cavity inside\)/i);
    geometry.dispose();
  });
  it("hollows a small concave Manifold solid and returns a valid bounded-error result",()=>{
    const stock=runtime.Manifold.cube([20,20,20],true);
    const notchBase=runtime.Manifold.cube([10,22,10],true);
    const notch=notchBase.translate([10,0,10]);
    const solid=stock.subtract(notch);
    const mesh=solid.getMesh();
    try {
      expect(solid.status()).toBe("NoError");
      expect(solid.volume()).toBeGreaterThan(0);
      const result=hollowMesh(runtime,{positions:mesh.vertProperties,indices:mesh.triVerts,thickness:1,openings:"none",options:{maxErrorMm:0.1}});
      expect(result.stats.method).toBe("mesh-sdf");
      expect(result.stats.measuredErrorMm).toBeLessThanOrEqual(0.1);
      expect(result.stats.sourceVolumeMm3).toBeCloseTo(solid.volume(),2);
      expect(result.stats.cavityVolumeMm3).toBeGreaterThan(0);
      expect(result.stats.resultVolumeMm3).toBeGreaterThan(0);
      expect(result.stats.resultVolumeMm3).toBeLessThan(result.stats.sourceVolumeMm3);
      expect(result.positions.every(Number.isFinite)).toBe(true);
      expect(result.indices.length).toBeGreaterThan(0);
    } finally {
      solid.delete();notch.delete();notchBase.delete();stock.delete();
    }
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
