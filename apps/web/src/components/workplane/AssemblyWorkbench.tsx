"use client";
import {useState,useEffect,useRef} from "react";
import {attachJoint,solveAssembly,type AssemblyDefinition,type JointKind} from "@/lib/mechanicalAssembly";
import {isNonSolidShape} from "@/lib/workplaneShapes";
import type {WorkplaneShape} from "@/types/layerling";
import {assemblyOverlapOffThread} from "@/lib/geometryWorker";
import "./ConstraintSketchWorkbench.css";
export function AssemblyWorkbench({shapes,onCommit,onClose}:{shapes:WorkplaneShape[];onCommit:(next:WorkplaneShape[])=>void;onClose:()=>void}){
 const existing=shapes.find(s=>s.assembly)?.assembly;
 const components=shapes.filter(s=>!isNonSolidShape(s) && !s.hidden);
 const [draft,setDraft]=useState<AssemblyDefinition>(()=>structuredClone(existing??{schema:1,root:components[0]?.id??"",joints:[]}));
 const [child,setChild]=useState(components[1]?.id??""),[kind,setKind]=useState<JointKind>("fixed"),[error,setError]=useState("");
 const controller=useRef<AbortController|null>(null);
 const [checking,setChecking]=useState(false),[overlap,setOverlap]=useState("");
 const revision=JSON.stringify(shapes);
 useEffect(()=>{setDraft(structuredClone(existing??{schema:1,root:components[0]?.id??"",joints:[]}));},[JSON.stringify(existing)]);
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{controller.current?.abort();setChecking(false);setOverlap("");},[revision]);
 async function checkOverlap(){
   const parent=shapes.find(s=>s.id===draft.root),part=shapes.find(s=>s.id===child);
   if(!parent||!part||parent.id===part.id){setOverlap("Choose two different components");return;}
   const abort=new AbortController();controller.current=abort;setChecking(true);
   try {
     const result=await assemblyOverlapOffThread([{...parent,locked:false,hole:false},{...part,locked:false,hole:false}],abort.signal);
     if(!abort.signal.aborted)setOverlap(result.failureNotice||(result.empty?"No intersecting material":"Intersecting material detected"));
   }catch(e){if(!abort.signal.aborted)setOverlap(String(e));}
   finally{if(!abort.signal.aborted)setChecking(false);}
 }
 function apply(next:AssemblyDefinition){
   setDraft(next);
   try{
     const evaluated=solveAssembly(next,shapes);
     onCommit(evaluated.map(s=>({...s,assembly:s.id===next.root?structuredClone(next):undefined})));
     setError("");
   }catch(e){setError(e instanceof Error?e.message:String(e));}
 }
 const number=(label:string,value:number,change:(n:number)=>void)=><label>{label}<input aria-label={label} type="number" step="any" value={value} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))change(n);}}/></label>;
 return <section className="constraint-sketch-workbench" aria-label="Assembly workspace">
   <header><strong>Assembly</strong><button aria-label="Close assembly" onClick={onClose}>×</button></header>
   <p>Independent rigid components. Joint axes and pivots use the parent component's local frame. Each component has one parent; joint loops require a future solver.</p>
   <label>Grounded component <select aria-label="Grounded component" value={draft.root} disabled={Boolean(draft.joints.length)} onChange={e=>apply({...draft,root:e.target.value})}>{components.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Attach component <select aria-label="Attach component" value={child} onChange={e=>setChild(e.target.value)}>{components.filter(s=>s.id!==draft.root).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Joint type <select aria-label="Joint type" value={kind} onChange={e=>setKind(e.target.value as JointKind)}>{["fixed","revolute","slider"].map(k=><option key={k}>{k}</option>)}</select></label>
   <button disabled={draft.joints.some(j=>j.child===child)} onClick={()=>{const parent=shapes.find(s=>s.id===draft.root),part=shapes.find(s=>s.id===child);if(parent&&part)apply({...draft,joints:[...draft.joints,attachJoint(parent,part,kind)]});}}>Add joint</button>
   <p>Motion degrees of freedom: {draft.joints.filter(j=>j.kind!=="fixed").length}</p>
   {draft.joints.map((joint,index)=><fieldset key={joint.id}>
     <legend>{shapes.find(s=>s.id===joint.child)?.name??"Missing component"} · {joint.kind}</legend>
     <label>Parent <select value={joint.parent} aria-label={"Parent "+(index+1)} onChange={e=>{const next=structuredClone(draft);const parent=shapes.find(s=>s.id===e.target.value),part=shapes.find(s=>s.id===joint.child);if(parent&&part){next.joints[index]={...attachJoint(parent,part,joint.kind),id:joint.id,axis:joint.axis,pivot:joint.pivot};apply(next);}}}>{components.filter(s=>s.id!==joint.child).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
     {["x","y","z"].map((axis,i)=><span key={axis}>
       {number("Axis "+axis+" "+(index+1),joint.axis[i],v=>{const next=structuredClone(draft);next.joints[index].axis[i]=v;apply(next);})}
       {number("Pivot "+axis+" "+(index+1),joint.pivot[i],v=>{const next=structuredClone(draft);next.joints[index].pivot[i]=v;apply(next);})}
     </span>)}
     {joint.kind!=="fixed" && <>
       {number("Position "+(index+1),joint.position,v=>{const next=structuredClone(draft);next.joints[index].position=v;apply(next);})}
       <input aria-label={"Motion "+(index+1)} type="range" min={joint.min} max={joint.max} step=".1" value={joint.position} onChange={e=>{const next=structuredClone(draft);next.joints[index].position=Number(e.target.value);apply(next);}}/>
       {number("Minimum "+(index+1),joint.min,v=>{const next=structuredClone(draft);next.joints[index].min=v;apply(next);})}
       {number("Maximum "+(index+1),joint.max,v=>{const next=structuredClone(draft);next.joints[index].max=v;apply(next);})}
       <small>{joint.kind==="revolute"?"degrees":"mm"}</small>
     </>}
     <button onClick={()=>apply({...draft,joints:draft.joints.filter(j=>j.id!==joint.id)})}>Remove joint</button>
   </fieldset>)}
   <button disabled={checking} onClick={()=>void checkOverlap()}>Check grounded / selected overlap</button>{checking&&<button onClick={()=>{controller.current?.abort();setChecking(false);}}>Cancel overlap check</button>}<p role="status">{overlap}</p>
   {error&&<p role="alert">{error}</p>}
 </section>;
}
