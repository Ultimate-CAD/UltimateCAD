import {beforeAll,describe,expect,it} from "vitest";
import module,{type ManifoldToplevel,type Manifold} from "manifold-3d";
import {BufferGeometry,Float32BufferAttribute,Ray,Vector3,DoubleSide} from "three";
import {MeshBVH} from "three-mesh-bvh";
import {createMeshDistanceQuery} from "@/lib/meshSignedDistance";
import {readFileSync,writeFileSync} from "node:fs";
import {STLLoader} from "three/examples/jsm/loaders/STLLoader.js";

let rt:ManifoldToplevel;
beforeAll(async()=>{rt=await module();rt.setup();});
function queries(solid:Manifold){
 const mesh=solid.getMesh(),geometry=new BufferGeometry();geometry.setAttribute("position",new Float32BufferAttribute(mesh.vertProperties,mesh.numProp));geometry.setIndex(Array.from(mesh.triVerts));
 const bvh=new MeshBVH(geometry),bounds=solid.boundingBox(),query=createMeshDistanceQuery(bvh,bvh,bounds,1e-5),p=new Vector3(),ray=new Ray(new Vector3(),new Vector3(1,.371390676,.69474659).normalize());
 const reference=(position:number[])=>{p.set(...position as [number,number,number]);const hit=bvh.closestPointToPoint(p)!;ray.origin.copy(p);const crossing=bvh.raycastFirst(ray,DoubleSide);return crossing?.face&&ray.direction.dot(crossing.face.normal)>0?hit.distance:-hit.distance;};
 return{...query,reference,dispose:()=>geometry.dispose()};
}
describe("conservative closest-face SDF classification",()=>{
 it.skipIf(!process.env.LAYERLING_SIGN_BENCH)("measures repeated queries on the actual organic source",()=>{
  const bytes=readFileSync('.codex-run/organic-repro/source.stl'),g=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),p=g.attributes.position.array;
  const input=new rt.Mesh({numProp:3,vertProperties:Float32Array.from(p),triVerts:Uint32Array.from({length:p.length/3},(_,i)=>i),tolerance:1e-5});input.merge();const solid=rt.Manifold.ofMesh(input),q=queries(solid),bounds=solid.boundingBox();
  let seed=541;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/2**32;};
  const samples=Array.from({length:200000},()=>bounds.min.map((v,j)=>v-1+random()*(bounds.max[j]-v+2)));
  try{for(const p of samples.slice(0,10000)){q.signedDistance(p);q.reference(p);}
   const measure=(query:(p:number[])=>number)=>{let sum=0;const t=performance.now();for(const p of samples)sum+=query(p);return{durationMs:performance.now()-t,sum};};
   const reference=measure(q.reference),optimized=measure(q.signedDistance),optimizedAgain=measure(q.signedDistance),referenceAgain=measure(q.reference);
   expect(optimized.sum).toBe(reference.sum);expect(optimizedAgain.sum).toBe(referenceAgain.sum);
   const report={reference,optimized,optimizedAgain,referenceAgain,stats:q.stats};writeFileSync('.codex-run/overnight-hollow/query-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{q.dispose();solid.delete();g.dispose();}
 });
 it("matches the original ray sign for dense samples on convex, concave, toroidal and translated solids",()=>{
  const stock=rt.Manifold.cube([20,20,20],true),tool=rt.Manifold.cube([12,12,24],true).translate([6,6,0]),concave=stock.subtract(tool),sphere=rt.Manifold.sphere(10,32),torus=rt.Manifold.cylinder(10,12,12,32,true).subtract(rt.Manifold.cylinder(20,6,6,32,true)),translated=sphere.translate([10000,-3000,5000]);
  let seed=1307;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/2**32;};
  let rayFallbackTotal=0;
  try{for(const solid of [stock,concave,sphere,torus,translated]){const q=queries(solid),bounds=solid.boundingBox();
   try{for(let i=0;i<10000;i++){const p=bounds.min.map((v,j)=>v-4+random()*(bounds.max[j]-v+8)),actual=q.signedDistance(p),expected=q.reference(p);expect(actual).toBe(expected);}
    expect(q.stats.faceSignQueries).toBeGreaterThan(100);expect(q.stats.boundsSignQueries).toBeGreaterThan(100);rayFallbackTotal+=q.stats.rayQueries;
   }finally{q.dispose();}}expect(rayFallbackTotal).toBeGreaterThan(0);
  }finally{[stock,tool,concave,sphere,torus,translated].forEach(s=>s.delete());}
 });
 it("retains ray fallback at edges, vertices and explicitly clamped opening probes",()=>{
  const solid=rt.Manifold.cube([20,20,20]),q=queries(solid);
  try{for(const p of [[10,0,0],[0,0,0],[10,10,0],[10,10,10],[1e-7,10,10]])expect(q.signedDistance(p)).toBe(q.reference(p));
   const before=q.stats.rayQueries;q.signedDistance([10,-2,10],[10,1e-4,10]);expect(q.stats.rayQueries).toBe(before+1);
  }finally{q.dispose();solid.delete();}
 });
});
