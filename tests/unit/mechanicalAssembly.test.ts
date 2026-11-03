import {expect,it} from "vitest";
import {Vector3} from "three";
import {attachJoint,componentFrame,solveAssembly,type AssemblyDefinition} from "@/lib/mechanicalAssembly";
import type {WorkplaneShape} from "@/types/layerling";
const body=(id:string,x:number):WorkplaneShape=>({id,name:id,kind:"box",x,z:0,elevation:0,width:10,depth:10,height:10,size:10,rotation:0,color:"#0169cc"});
it("enforces exact revolute and slider motion about the grounded parent's frame",()=>{
 const root=body("root",0),child=body("child",20);
 const j=attachJoint(root,child,"revolute");
 const def:AssemblyDefinition={schema:1,root:root.id,joints:[{...j,position:90}]};
 const rotated=solveAssembly(def,[root,child])[1];
 expect(rotated.x).toBeCloseTo(0,9);expect(rotated.z).toBeCloseTo(-20,9);
 const center=new Vector3().setFromMatrixPosition(componentFrame(rotated));
 expect(center.distanceTo(new Vector3(0,5,0))).toBeCloseTo(20,9);
 def.joints=[{...j,kind:"slider",axis:[1,0,0],position:12}];
 const moved=solveAssembly(def,[root,child])[1];
 expect(moved.x).toBeCloseTo(32,9);expect(moved.z).toBeCloseTo(0,9);
 expect(moved.rotation).toBeCloseTo(0,9);
 def.joints=[{...j,kind:"fixed",position:80}];
 expect(solveAssembly(def,[root,child])[1].x).toBeCloseTo(20,9);
});
it("supports hierarchical motion and rejects cycles, multiple parents and invalid rigid frames",()=>{
 const a=body("a",0),b=body("b",20),c=body("c",40);
 const ab=attachJoint(a,b,"slider"),bc=attachJoint(b,c,"fixed");
 const def:AssemblyDefinition={schema:1,root:a.id,joints:[{...ab,axis:[1,0,0],position:5},bc]};
 expect(solveAssembly(def,[a,b,c])[2].x).toBeCloseTo(45,9);
 expect(()=>solveAssembly({...def,joints:[ab,{...bc,parent:"c"}]},[a,b,c])).toThrow(/cycle/);
 expect(()=>solveAssembly({...def,joints:[ab,{...bc,child:"b"}]},[a,b,c])).toThrow();
 expect(()=>solveAssembly({...def,joints:[{...ab,rest:Array(16).fill(0)}]},[a,b,c])).toThrow(/rigid/);
});
