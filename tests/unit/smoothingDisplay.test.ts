import { it, expect } from "vitest";
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { SmoothingDisplayCache, updateSmoothingColors } from "@/lib/smoothingDisplay";

it("serializes an indirect tree without changing source/index and refits exact display positions", () => {
  const source = { vertices: [[0,0,0],[10,0,0],[0,10,0],[0,0,10]] as [number,number,number][], faces: [[0,2,1],[0,1,3],[1,2,3],[2,0,3]] as [number,number,number][] };
  const before=JSON.stringify(source),cache=new SmoothingDisplayCache(source),snapshot=cache.snapshot();
  const prepared={display:structuredClone(snapshot.display,{transfer:snapshot.transfer})};
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(prepared.display.position,3));geometry.setIndex(new BufferAttribute(prepared.display.bvh.index!,1));
  geometry.boundsTree=MeshBVH.deserialize(prepared.display.bvh,geometry,{setIndex:false});
  const material=new MeshBasicMaterial(),mesh=new Mesh(geometry,material),ray=new Raycaster(new Vector3(1,1,30),new Vector3(0,0,-1));mesh.updateMatrixWorld();
  const old=ray.intersectObject(mesh)[0];mesh.raycast=acceleratedRaycast;ray.firstHitOnly=true;
  expect(ray.intersectObject(mesh)[0].point.toArray()).toEqual(old.point.toArray());
  expect(Array.from(geometry.index!.array)).toEqual(source.faces.flat());
  const next={...source,vertices:source.vertices.map(p=>[p[0]+2,p[1],p[2]] as [number,number,number])};cache.update(next);
  const updated=cache.snapshot();expect(Array.from(updated.display.position)).toEqual(next.vertices.flat());expect(JSON.stringify(source)).toBe(before);
  expect(()=>cache.update({...next,faces:[...source.faces]})).toThrow(/topology/);
  geometry.dispose();material.dispose();cache.dispose();
});

it("reuses color storage and produces the same values from sparse deltas including clear",()=>{
  const attribute=new BufferAttribute(new Float32Array(30),3),indices=Uint32Array.from({length:10},(_,i)=>i),weights=new Float64Array(10);
  updateSmoothingColors(attribute,indices,weights);const storage=attribute.array;
  updateSmoothingColors(attribute,Uint32Array.of(3,7),Float64Array.of(.35,.8));weights[3]=.35;weights[7]=.8;
  const expected=new Float32Array(weights.length*3);weights.forEach((w,i)=>expected.set([.1+.9*w,.65-.25*w,.85-.75*w],i*3));
  expect(attribute.array).toBe(storage);expect(attribute.array).toEqual(expected);
  updateSmoothingColors(attribute,Uint32Array.of(3,7),Float64Array.of(0,0));expect(attribute.array[9]).toBe(Math.fround(.1));
});
