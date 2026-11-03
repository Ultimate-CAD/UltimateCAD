import {Euler,Matrix4,Quaternion,Vector3} from "three";
import type {WorkplaneShape} from "@/types/layerling";
export type JointKind="fixed"|"revolute"|"slider";
export interface AssemblyJoint {
  id:string; parent:string; child:string; kind:JointKind;
  axis:[number,number,number]; pivot:[number,number,number];
  rest:number[]; position:number; min:number; max:number;
}
export interface AssemblyDefinition {schema:1; root:string; joints:AssemblyJoint[]}
export function componentFrame(shape:WorkplaneShape) {
  const rotation=new Quaternion().setFromEuler(new Euler((shape.rotationX??0)*Math.PI/180,shape.rotation*Math.PI/180,(shape.rotationZ??0)*Math.PI/180));
  return new Matrix4().compose(new Vector3(shape.x,(shape.elevation??0)+shape.height/2,shape.z),rotation,new Vector3(1,1,1));
}
export function attachJoint(parent:WorkplaneShape,child:WorkplaneShape,kind:JointKind):AssemblyJoint {
  return {id:crypto.randomUUID(),parent:parent.id,child:child.id,kind,axis:[0,1,0],pivot:[0,0,0],
    rest:componentFrame(parent).invert().multiply(componentFrame(child)).toArray(),position:0,min:kind==="revolute"?-180:-100,max:kind==="revolute"?180:100};
}
export function solveAssembly(def:AssemblyDefinition,shapes:readonly WorkplaneShape[]) {
  const byId=new Map(shapes.map(s=>[s.id,s]));
  if(def?.schema!==1 || !Array.isArray(def.joints) || def.joints.length>256 || !byId.has(def.root)) throw Error("Missing or unsupported assembly root");
  const inbound=new Map<string,AssemblyJoint>(),ids=new Set<string>();
  for(const j of def.joints){
    if(!j || typeof j.id!=="string" || !j.id || ids.has(j.id) || !["fixed","revolute","slider"].includes(j.kind) ||
      !byId.has(j.parent) || !byId.has(j.child) || j.child===def.root || inbound.has(j.child)) throw Error("Invalid or multiply constrained assembly member");
    if(!Array.isArray(j.axis) || !Array.isArray(j.pivot) || !Array.isArray(j.rest) || j.rest.length!==16 || !j.rest.every(Number.isFinite) ||
       ![...j.axis,...j.pivot,j.position,j.min,j.max].every(Number.isFinite) ||
       j.axis.length!==3 || j.pivot.length!==3 || Math.hypot(...j.axis)<1e-9 || j.min>j.max || j.position<j.min || j.position>j.max) throw Error("Invalid joint frame or travel");
    const rest=new Matrix4().fromArray(j.rest),r=new Vector3(),q=new Quaternion(),scale=new Vector3();
    rest.decompose(r,q,scale);
    if(scale.distanceTo(new Vector3(1,1,1))>1e-8 || Math.abs(rest.determinant()-1)>1e-8 ||
      !rest.elements.every((v,i)=>Math.abs(v-new Matrix4().compose(r,q,scale).elements[i])<1e-8)) throw Error("Joint frame must be a rigid transform");
    ids.add(j.id);inbound.set(j.child,j);
  }
  const frames=new Map<string,Matrix4>(),active=new Set<string>();
  function visit(id:string):Matrix4 {
    const done=frames.get(id);if(done)return done;
    if(active.has(id))throw Error("Assembly joint cycle");
    active.add(id);
    const joint=inbound.get(id);
    let result:Matrix4;
    if(id===def.root)result=componentFrame(byId.get(id)!);
    else{
      if(!joint)throw Error("Component is disconnected from the assembly root");
      const parent=visit(joint.parent),axis=new Vector3(...joint.axis).normalize(),move=new Matrix4();
      if(joint.kind==="slider")move.makeTranslation(...axis.multiplyScalar(joint.position).toArray() as [number,number,number]);
      if(joint.kind==="revolute"){
        const pivot=new Vector3(...joint.pivot);
        move.makeTranslation(pivot.x,pivot.y,pivot.z).multiply(new Matrix4().makeRotationAxis(axis,joint.position*Math.PI/180)).multiply(new Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));
      }
      result=parent.clone().multiply(move).multiply(new Matrix4().fromArray(joint.rest));
    }
    active.delete(id);frames.set(id,result);return result;
  }
  visit(def.root);for(const id of inbound.keys())visit(id);
  return shapes.map(shape=>{
    const frame=frames.get(shape.id);if(!frame)return shape;
    const p=new Vector3(),q=new Quaternion(),scale=new Vector3();frame.decompose(p,q,scale);
    const e=new Euler().setFromQuaternion(q,"XYZ");
    return {...shape,x:p.x,z:p.z,elevation:p.y-shape.height/2,rotation:e.y*180/Math.PI,rotationX:e.x*180/Math.PI,rotationZ:e.z*180/Math.PI};
  });
}
