import {expect,it} from "vitest";
import {buildReliefMesh,DEFAULT_RELIEF,reliefThickness} from "@/lib/imageRelief";
import {strictTopology} from "../../desktop/manufacturing-file-audit.mjs";
function audit(positions:ArrayLike<number>){
 const ids=new Map<string,number>(),vertices:number[][]=[],faces:number[][]=[];
 for(let i=0;i<positions.length;i+=9){
  const face=[];
  for(let j=0;j<9;j+=3){
   const v=[positions[i+j],positions[i+j+1],positions[i+j+2]],key=v.join(",");
   let id=ids.get(key);if(id===undefined){id=vertices.length;vertices.push(v);ids.set(key,id);}face.push(id);
  }
  faces.push(face);
 }
 return strictTopology(vertices,faces);
}
it("maps image luminance/alpha and mode without changing the exterior dimensions",()=>{
 const s={...DEFAULT_RELIEF,width:20,height:30,resolution:2};
 expect(reliefThickness(0,0,0,255,s)).toBeCloseTo(3);
 expect(reliefThickness(255,255,255,255,s)).toBeCloseTo(.8);
 expect(reliefThickness(0,0,0,0,s)).toBeCloseTo(.8);
 expect(reliefThickness(0,0,0,255,{...s,mode:"relief"})).toBeCloseTo(.8);
 expect(reliefThickness(255,255,255,255,{...s,mode:"relief"})).toBeCloseTo(3);
 const pixels=new Uint8ClampedArray([0,0,0,255,255,255,255,255,80,80,80,255,200,200,200,255]);
 const mesh=buildReliefMesh(pixels,2,2,s);
 expect(mesh.positions[1]).toBeCloseTo(3);
 expect(mesh.positions[7]).toBeCloseTo(.8);
 expect(mesh.positions[0]).toBe(-10);expect(mesh.positions[2]).toBe(-15);
 expect(audit(mesh.positions).volumeMm3).toBeGreaterThan(0);
 expect(audit(new Float32Array(mesh.positions)).volumeMm3).toBeGreaterThan(0);
});
it("remains closed under smoothing, borders and high contrast",()=>{
 const nx=17,ny=13,pixels=new Uint8ClampedArray(nx*ny*4);
 for(let i=0;i<nx*ny;i++){const v=i%3===0?0:255;pixels.set([v,v,v,255],i*4);}
 for(const mode of ["lithophane","relief"] as const){
  const s={...DEFAULT_RELIEF,mode,width:55,height:35,smoothing:2,borderWidth:2,borderThickness:4,gamma:2,contrast:1.5};
  const mesh=buildReliefMesh(pixels,nx,ny,s);
  expect(mesh.height).toBe(4);
  expect(audit(mesh.positions).volumeMm3).toBeGreaterThan(55*35*.8);
  audit(new Float32Array(mesh.positions));
 }
 expect(()=>buildReliefMesh(pixels,nx,ny,{...DEFAULT_RELIEF,minThickness:0})).toThrow();
});
