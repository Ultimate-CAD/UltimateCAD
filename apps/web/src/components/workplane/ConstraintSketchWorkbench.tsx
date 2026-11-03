"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONSTRAINT_KINDS, mountingPlateSketch, type ConstraintEntity, type ConstraintKind, type ConstraintPoint, type ConstraintSketch, type ConstraintSolution } from "@/lib/constraintSketch";
import { solveSketchInWorker } from "@/lib/constraintSketchWorker";
import { t } from "@/lib/i18n";
import type { WorkplaneShape } from "@/types/layerling";
import { createSketchPadHistory } from "@/lib/sketchPadHistory";
import "./ConstraintSketchWorkbench.css";
const tr=(key:string)=>t(`constraintSketch.${key}` as Parameters<typeof t>[0]);
const uid=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
const clone=<T,>(value:T):T=>structuredClone(value);
export function ConstraintSketchWorkbench({shape,onApply,onClose}:{shape:WorkplaneShape|null;onApply:(document:ConstraintSketch,targetId:string|null,build:boolean,signal:AbortSignal)=>Promise<WorkplaneShape>;onClose:()=>void}){
  const [draft,setDraft]=useState<ConstraintSketch>(()=>clone(shape?.sketchProfile?.constraintSketch??mountingPlateSketch()));
  const [targetId,setTargetId]=useState<string|null>(shape?.sketchProfile?.constraintSketch?shape.id:null);
  const [past,setPast]=useState<ConstraintSketch[]>([]),[future,setFuture]=useState<ConstraintSketch[]>([]);
  const [solved,setSolved]=useState<{key:string;result:ConstraintSolution}|null>(null),[diagnostic,setDiagnostic]=useState("");
  const [busy,setBusy]=useState(false),[kind,setKind]=useState<ConstraintKind>("radius"),[first,setFirst]=useState("outer"),[second,setSecond]=useState("pitch"),[value,setValue]=useState(10);
  const svg=useRef<SVGSVGElement>(null),drag=useRef<{id:string;before:ConstraintSketch}|null>(null),applyController=useRef<AbortController|null>(null);
  const key=JSON.stringify(draft), solution=solved?.key===key?solved.result:null;
  const current=solution?.valid?solution.document:draft;
  useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>{setDiagnostic("");void solveSketchInWorker(draft,controller.signal).then(result=>{if(!controller.signal.aborted)setSolved({key,result});}).catch(error=>{if(!controller.signal.aborted)setDiagnostic(error instanceof Error?error.message:String(error));});},150);return()=>{clearTimeout(timer);controller.abort();};},[key]); // source-keyed, obsolete results are discarded
  useEffect(()=>()=>applyController.current?.abort(),[]);
  function edit(next:ConstraintSketch,history=true){if(busy)return;if(history){setPast(p=>[...p.slice(-99),clone(draft)]);setFuture([]);}setDraft(next);setSolved(null);setDiagnostic("");}
  function change(fn:(next:ConstraintSketch)=>void){const next=clone(current);fn(next);edit(next);}
  function undo(){if(!past.length)return;setFuture(f=>[clone(draft),...f]);setDraft(clone(past[past.length-1]));setPast(p=>p.slice(0,-1));setSolved(null);}
  function redo(){if(!future.length)return;setPast(p=>[...p,clone(draft)]);setDraft(clone(future[0]));setFuture(f=>f.slice(1));setSolved(null);}
  function load(doc:ConstraintSketch){if(busy)return;setTargetId(null);edit(doc);}
  const points=current.entities.filter((e):e is ConstraintPoint=>e.kind==="point"),pointMap=new Map(points.map(p=>[p.id,p]));
  const extent=useMemo(()=>{const xy:Array<[number,number]>=[];for(const e of current.entities){if(e.kind==="point")xy.push([e.x,e.y]);if(e.kind==="circle"||e.kind==="arc"){const c=current.entities.find(p=>p.id===e.center) as ConstraintPoint|undefined;if(c)xy.push([c.x-e.radius,c.y-e.radius],[c.x+e.radius,c.y+e.radius]);}}const xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]);const minX=Math.min(-5,...xs),maxX=Math.max(5,...xs),minY=Math.min(-5,...ys),maxY=Math.max(5,...ys),span=Math.max(10,maxX-minX,maxY-minY);return {x:(minX+maxX)/2-span*.6,y:-(minY+maxY)/2-span*.6,size:span*1.2};},[current]);
  function addEntity(type:"point"|"line"|"circle"|"arc"){change(d=>{const x=d.entities.filter(e=>e.kind!=="point").length*3;const p:ConstraintPoint={id:uid("point"),kind:"point",x,y:0,fixed:false,name:`${tr("point")} ${d.entities.filter(e=>e.kind==="point").length+1}`};d.entities.push(p);if(type==="point")return;const id=uid(type),name=`${tr(type)} ${d.entities.filter(e=>e.kind===type).length+1}`;if(type==="circle")d.entities.push({id,name,kind:"circle",center:p.id,radius:10});else {const end:ConstraintPoint={id:uid("point"),kind:"point",x:x+10,y:5,fixed:false};d.entities.push(end);if(type==="line")d.entities.push({id,name,kind:"line",start:p.id,end:end.id});else {p.x=x;p.y=0;const start:ConstraintPoint={id:uid("point"),kind:"point",x:x+10,y:0,fixed:false};end.x=x;end.y=10;d.entities.push(start,{id,name,kind:"arc",center:p.id,start:start.id,end:end.id,radius:10,startAngle:0,endAngle:90});}}});}
  function patchEntity(id:string,patch:Partial<ConstraintEntity>){change(d=>{d.entities=d.entities.map(e=>e.id===id?{...e,...patch} as ConstraintEntity:e);const e=d.entities.find(e=>e.id===id);if(e?.kind==="arc"&&("radius" in patch||"startAngle" in patch||"endAngle" in patch)){const c=d.entities.find(p=>p.id===e.center) as ConstraintPoint;d.entities=d.entities.map(p=>p.kind==="point"&&(p.id===e.start||p.id===e.end)?{...p,x:c.x+e.radius*Math.cos((p.id===e.start?e.startAngle:e.endAngle)*Math.PI/180),y:c.y+e.radius*Math.sin((p.id===e.start?e.startAngle:e.endAngle)*Math.PI/180)}:p);}});}
  function removeEntity(id:string){change(d=>{const remove=new Set([id]);for(const e of d.entities)if((e.kind==="line"&&(e.start===id||e.end===id))||((e.kind==="circle"||e.kind==="arc")&&(e.center===id||(e.kind==="arc"&&(e.start===id||e.end===id)))))remove.add(e.id);d.entities=d.entities.filter(e=>!remove.has(e.id));d.constraints=d.constraints.filter(c=>!remove.has(c.first)&&!remove.has(c.second??""));});}
  async function apply(build:boolean){if(!solution?.valid||busy)return;const controller=new AbortController();applyController.current=controller;setBusy(true);try{const next=await onApply(solution.document,targetId,build,controller.signal);if(!controller.signal.aborted){setTargetId(next.id);setDiagnostic(tr(build?"solidBuilt":"sourceSaved"));}}catch(error){if(!controller.signal.aborted)setDiagnostic(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}
  const name=(id:string)=>{const e=current.entities.find(e=>e.id===id);return e?.name??`${e?tr(e.kind):"?"} ${id.slice(0,10)}`;};
  const pick=(id:string,onChange:(id:string)=>void,list=current.entities)=><select value={id} onChange={e=>onChange(e.target.value)}><option value="">{tr("select")}</option>{list.map(e=><option key={e.id} value={e.id}>{name(e.id)}</option>)}</select>;
  const num=(label:string,n:number,onChange:(value:number)=>void)=><label>{label}<input type="number" aria-label={label} value={Number(n.toPrecision(12))} step="any" onChange={e=>{const value=parseFloat(e.target.value);if(Number.isFinite(value))onChange(value);}}/></label>;
  function pointerMove(event:React.PointerEvent<SVGSVGElement>){if(!drag.current||!svg.current)return;const matrix=svg.current.getScreenCTM();if(!matrix)return;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());const next=clone(current);next.entities=next.entities.map(e=>e.id===drag.current!.id&&e.kind==="point"?{...e,x:point.x,y:-point.y}:e);edit(next,false);}
  function pointerEnd(){if(!drag.current)return;const before=drag.current.before;setPast(p=>[...p.slice(-99),before]);setFuture([]);drag.current=null;}
  return <section className="constraint-sketch-workbench" aria-label={tr("title")} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.stopPropagation();if(e.shiftKey)redo();else undo();}}}>
    <header><strong>{tr("title")}</strong><button aria-label={tr("close")} onClick={()=>{applyController.current?.abort();onClose();}}>×</button></header>
    <fieldset disabled={busy}>
    <div className="constraint-sketch-actions"><button onClick={()=>load(mountingPlateSketch())}>{tr("plate")}</button><button onClick={()=>load({schema:1,title:tr("empty"),entities:[],constraints:[],extrusionMm:5})}>{tr("empty")}</button><button disabled={!past.length||busy} onClick={undo}>{tr("undo")}</button><button disabled={!future.length||busy} onClick={redo}>{tr("redo")}</button></div>
    <label>{tr("title")}<input aria-label="Sketch name" value={draft.title} onChange={e=>change(d=>{d.title=e.target.value;})}/></label>
    <div className="constraint-dimensions">{current.constraints.filter(c=>c.name&&c.value!==undefined).map(c=><span key={c.id}>{num(c.name!,c.value!,value=>change(d=>{d.constraints=d.constraints.map(x=>x.id===c.id?{...x,value}:x);} ))}</span>)}</div>
    <div className="constraint-sketch-status" role="status" data-solve-valid={solution?.valid??false}>{solution?tr(solution.valid?"ready":"invalid"):tr("solving")} · {tr("dof")}: {solution?.dof??"—"}{solution?.residuals.length?<> · {tr("residual")}: {(["mm","rad"] as const).map(unit=>`${Math.max(0,...solution.residuals.filter(r=>r.unit===unit).map(r=>r.value)).toExponential(2)} ${unit}`).join(" / ")}</>:null}</div>
    {solution?.conflicts.length?<p role="alert">{tr("conflicts")}: {solution.conflicts.join(", ")}</p>:null}
    {solution?.redundant.length?<p>{tr("redundant")}: {solution.redundant.join(", ")}</p>:null}
    {diagnostic?<p role={diagnostic===tr("sourceSaved")||diagnostic===tr("solidBuilt")?"status":"alert"}>{diagnostic}</p>:null}
    <svg ref={svg} className="constraint-sketch-canvas" aria-label={tr("entities")} viewBox={`${extent.x} ${extent.y} ${extent.size} ${extent.size}`} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      <path d={`M${extent.x} 0h${extent.size}M0 ${extent.y}v${extent.size}`} className="constraint-axis"/>
      {current.entities.map(e=>{if(e.kind==="point")return null;const cls=e.construction?"constraint-construction":"constraint-outline";if(e.kind==="line"){const a=pointMap.get(e.start),b=pointMap.get(e.end);return a&&b?<line key={e.id} className={cls} x1={a.x} y1={-a.y} x2={b.x} y2={-b.y}/>:null;}const c=pointMap.get(e.center);if(!c)return null;if(e.kind==="circle")return <circle key={e.id} className={cls} cx={c.x} cy={-c.y} r={Math.max(.001,e.radius)}/>;const p=Array.from({length:65},(_,i)=>{const a=(e.startAngle+(e.endAngle-e.startAngle)*i/64)*Math.PI/180;return `${c.x+e.radius*Math.cos(a)},${-c.y-e.radius*Math.sin(a)}`;}).join(" ");return <polyline key={e.id} className={cls} points={p}/>;})}
      {points.map(p=><circle key={p.id} className={`constraint-point ${p.fixed?"is-fixed":""}`} cx={p.x} cy={-p.y} r={extent.size/140} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:p.id,before:clone(draft)};}}><title>{name(p.id)}</title></circle>)}
    </svg>
    <small>{tr("dragHelp")}</small>
    <details><summary>{tr("entities")} ({current.entities.length})</summary><div className="constraint-sketch-actions">{(["point","line","circle","arc"] as const).map(type=><button key={type} onClick={()=>addEntity(type)}>{tr(type)}</button>)}</div>
      {current.entities.map(e=><div className="constraint-entity" key={e.id}><b>{name(e.id)}</b><button aria-label={`${tr("delete")} ${name(e.id)}`} onClick={()=>removeEntity(e.id)}>×</button>{e.kind==="point"?<>{num("X (mm)",e.x,x=>patchEntity(e.id,{x}))}{num("Y (mm)",e.y,y=>patchEntity(e.id,{y}))}<label><input type="checkbox" checked={e.fixed} onChange={v=>patchEntity(e.id,{fixed:v.target.checked})}/>{tr("fixed")}</label></>:<><label><input type="checkbox" checked={Boolean(e.construction)} onChange={v=>patchEntity(e.id,{construction:v.target.checked})}/>{tr("construction")}</label>{e.kind==="line"?<>{pick(e.start,start=>patchEntity(e.id,{start}),points)}{pick(e.end,end=>patchEntity(e.id,{end}),points)}</>:<>{pick(e.center,center=>patchEntity(e.id,{center}),points)}{num(`${tr("radius")} (mm)`,e.radius,radius=>patchEntity(e.id,{radius}))}{e.kind==="arc"?<>{num(`${tr("startAngle")} (°)`,e.startAngle,startAngle=>patchEntity(e.id,{startAngle}))}{num(`${tr("endAngle")} (°)`,e.endAngle,endAngle=>patchEntity(e.id,{endAngle}))}</>:null}</>}</>}</div>)}
    </details>
    <details><summary>{tr("constraints")} ({current.constraints.length})</summary><div className="constraint-add"><select aria-label={tr("constraints")} value={kind} onChange={e=>setKind(e.target.value as ConstraintKind)}>{CONSTRAINT_KINDS.map(k=><option key={k} value={k}>{tr(`kind.${k}`)}</option>)}</select><label>{tr("first")}{pick(first,setFirst)}</label><label>{tr("second")}{pick(second,setSecond)}</label>{num(tr("value"),value,setValue)}<button onClick={()=>change(d=>{d.constraints.push({id:uid("constraint"),kind,first,...(second?{second}:{}),value});})}>{tr("add")}</button></div>
      {current.constraints.map(c=><div className={`constraint-row ${solution?.conflicts.includes(c.id)?"has-conflict":""}`} key={c.id}><span title={c.id}>{c.name??tr(`kind.${c.kind}`)} · {name(c.first)} {c.second?`/ ${name(c.second)}`:""}</span>{c.value!==undefined?num(c.name??tr("value"),c.value,value=>change(d=>{d.constraints=d.constraints.map(x=>x.id===c.id?{...x,value}:x);})):null}<button aria-label={`${tr("delete")} ${c.id}`} onClick={()=>change(d=>{d.constraints=d.constraints.filter(x=>x.id!==c.id);})}>×</button></div>)}
    </details>
    {current.featureHistory ? <details open>
      <summary>Feature history</summary>
      <ol><li>Sketch · {current.title}</li><li>Pad · {current.featureHistory.pad.depthParameter}</li></ol>
      {current.featureHistory.parameters.map((param,index)=><div key={index}>
        <label>Name <input value={param.name} onChange={e=>change(d=>{d.featureHistory!.parameters[index].name=e.target.value;})}/></label>
        <label>Expression <input value={param.expression} onChange={e=>change(d=>{d.featureHistory!.parameters[index].expression=e.target.value;})}/></label>
        <label>Unit <select value={param.unit} onChange={e=>change(d=>{d.featureHistory!.parameters[index].unit=e.target.value as typeof param.unit;})}>{["mm","deg","scalar"].map(unit=><option key={unit}>{unit}</option>)}</select></label>
        <button onClick={()=>change(d=>{d.featureHistory!.parameters.splice(index,1);})}>Remove parameter</button>
      </div>)}
      <button onClick={()=>change(d=>{
        const params=d.featureHistory!.parameters;
        let n=1;
        while(params.some(p=>p.name==="length"+n)) n++;
        params.push({name:"length"+n,expression:"1 mm",unit:"mm"});
      })}>Add parameter</button>
      <label>Pad depth parameter <input value={current.featureHistory.pad.depthParameter} onChange={e=>change(d=>{d.featureHistory!.pad.depthParameter=e.target.value;})}/></label>
      {solution?.valid && <output>Pad depth: {solution.document.extrusionMm} mm</output>}
    </details> : <>
      {num(tr("extrusion"),current.extrusionMm,extrusionMm=>change(d=>{d.extrusionMm=extrusionMm;}))}
      <button onClick={()=>change(d=>{d.featureHistory=createSketchPadHistory(d.extrusionMm);})}>Drive pad with parameters</button>
    </>}

    </fieldset>
    <footer><button disabled={!solution?.valid||busy} onClick={()=>void apply(true)}>{tr("build")}</button>{!targetId||!shape?.cadBrep||shape.sketchOnly?<button disabled={!solution?.valid||busy} onClick={()=>void apply(false)}>{tr("save")}</button>:null}{busy?<button onClick={()=>applyController.current?.abort()}>{tr("close")}</button>:null}</footer>
  </section>;
}
