import { Euler, Vector3 } from "three";
import { constraintSketchProfile, type ConstraintSketch } from "@/lib/constraintSketch";
import type { WorkplaneShape } from "@/types/layerling";
export function constraintSketchBounds(doc: ConstraintSketch) {
  const points=new Map(doc.entities.filter(e=>e.kind==="point").map(e=>[e.id,e]));
  const xy:Array<[number,number]>=[];
  for(const e of doc.entities){if(e.kind==="point"||e.construction)continue;if(e.kind==="line"){for(const id of [e.start,e.end]){const p=points.get(id);if(p)xy.push([p.x,p.y]);}}else {const c=points.get(e.center);if(!c)continue;const angles=e.kind==="circle"?[0,90,180,270]:[e.startAngle,e.endAngle,...Array.from({length:9},(_,i)=>Math.floor(e.startAngle/90)*90+i*90).filter(a=>a>e.startAngle&&a<e.endAngle)];for(const a of angles)xy.push([c.x+e.radius*Math.cos(a*Math.PI/180),c.y+e.radius*Math.sin(a*Math.PI/180)]);}}
  if(!xy.length)for(const p of points.values())xy.push([p.x,p.y]);
  const xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]),minX=xs.length?Math.min(...xs):0,maxX=xs.length?Math.max(...xs):0,minY=ys.length?Math.min(...ys):0,maxY=ys.length?Math.max(...ys):0;
  return {x:(minX+maxX)/2,y:(minY+maxY)/2,width:Math.max(.001,maxX-minX),depth:Math.max(.001,maxY-minY)};
}
export function constraintSketchShape(doc:ConstraintSketch,id:string,existing?:WorkplaneShape|null):WorkplaneShape {
  const bounds=constraintSketchBounds(doc),old=existing?.sketchProfile?.constraintSketch?constraintSketchBounds(existing.sketchProfile.constraintSketch):bounds;
  const delta=new Vector3((bounds.x-old.x)*(existing?.mirrorX?-1:1),0,(bounds.y-old.y)*(existing?.mirrorZ?-1:1)).applyEuler(new Euler((existing?.rotationX??0)*Math.PI/180,(existing?.rotation??0)*Math.PI/180,(existing?.rotationZ??0)*Math.PI/180));
  return {...existing,id,name:doc.title,kind:"sketch",sketchOnly:true,x:existing?existing.x+delta.x:bounds.x,z:existing?existing.z+delta.z:bounds.y,elevation:(existing?.elevation??0)+delta.y,width:bounds.width,depth:bounds.depth,size:Math.max(bounds.width,bounds.depth),height:.02,rotation:existing?.rotation??0,color:existing?.color??"#0169cc",sketchOperation:"extrude",sketchProfile:constraintSketchProfile(doc),importedMesh:undefined,cadBrep:undefined,cadBrepFrame:undefined,cadDisplayEdges:undefined,cadDisplayEdgesVersion:undefined,edgeTreatments:undefined,edgeTreatmentHistory:undefined};
}
