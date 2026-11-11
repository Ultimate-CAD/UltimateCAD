"use client";
import {MeasurementInput} from "./MeasurementInput";
import {useEffect,useRef,useState} from "react";
import type {WorkplaneShape} from "@/types/layerling";
import {isNonSolidShape} from "@/lib/workplaneShapes";
import {exportShapesToStep} from "@/lib/stepExport";
import {validateFemStudy,type FemBridge,type FemSettings,type FemStudy} from "@/lib/femStudy";
import {FemResultView} from "./FemResultView";
import "./ConstraintSketchWorkbench.css";
export async function femFingerprint(shape:WorkplaneShape){
 const {femStudy,name,color,hidden,locked,...geometry}=shape;
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(geometry)));
 return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
type GmshConfigStatus = {
 ok: boolean;
 configured?: boolean;
 exists?: boolean;
 path?: string;
 mode?: string;
 cancelled?: boolean;
 version?: string;
 message?: string;
};

type ConfigurableFemBridge = FemBridge & {
 getGmshStatus?: () => Promise<GmshConfigStatus>;
 chooseGmsh?: () => Promise<GmshConfigStatus>;
};
export function FemWorkbench({shapes,selected,onSave,onClose}:{shapes:WorkplaneShape[];selected?:string;onSave:(id:string,study:FemStudy)=>void;onClose:()=>void}){
 const bodies=shapes.filter(s=>!isNonSolidShape(s));
 const [id,setId]=useState(selected??bodies[0]?.id??"");
 const shape=shapes.find(s=>s.id===id),source=useRef(shapes);source.current=shapes;
 const [settings,setSettings]=useState<FemSettings>({axis:0,supportMax:false,young:200e9,poisson:.3,meshSizeM:.01,force:[0,0,-1000]});
 const [study,setStudy]=useState<FemStudy|undefined>(shape?.femStudy),[message,setMessage]=useState(""),[running,setRunning]=useState(false),[stale,setStale]=useState(false);
 const [scale,setScale]=useState(1),[field,setField]=useState<"stress"|"displacement">("stress");
 const active=useRef<{id:string;bridge:FemBridge;aborted:boolean}|null>(null);
 const [gmshStatus,setGmshStatus]=useState<GmshConfigStatus|null>(null);
 const [choosingGmsh,setChoosingGmsh]=useState(false);
 useEffect(()=>{
  setStudy(shape?.femStudy);
  if(shape?.femStudy)setSettings(structuredClone(shape.femStudy.settings));
 },[id,shape?.femStudy]);
 useEffect(()=>{let live=true;if(shape&&study)void femFingerprint(shape).then(fp=>{if(live)setStale(fp!==study.sourceFingerprint);});return()=>{live=false;};},[shape,study]);
 useEffect(()=>()=>{if(active.current){active.current.aborted=true;active.current.bridge.cancel(active.current.id);}},[]);
 useEffect(()=>{
  const bridge=(window as unknown as {layerlingFem?:ConfigurableFemBridge}).layerlingFem;
  if(!bridge?.getGmshStatus)return;
  let live=true;
  void bridge.getGmshStatus()
   .then(status=>{if(live)setGmshStatus(status);})
   .catch(error=>{
    if(live)setGmshStatus({ok:false,exists:false,message:String(error)});
   });
  return()=>{live=false;};
 },[]);

 async function chooseGmsh(){
  const bridge=(window as unknown as {layerlingFem?:ConfigurableFemBridge}).layerlingFem;
  if(!bridge?.chooseGmsh||!bridge?.getGmshStatus){
   setMessage("Gmsh configuration requires the Windows desktop application");
   return;
  }
  setChoosingGmsh(true);
  try{
   const selected=await bridge.chooseGmsh();
   if(selected.cancelled)return;
   if(!selected.ok)throw Error(selected.message??"Gmsh selection failed");
   const status=await bridge.getGmshStatus();
   setGmshStatus(status);
   if(!status.ok||!status.exists)throw Error("Configured Gmsh is unavailable");
   setMessage("Gmsh "+(selected.version??"4.15.2")+" configured successfully");
  }catch(error){
   setMessage(error instanceof Error?error.message:String(error));
  }finally{
   setChoosingGmsh(false);
  }
 }
 async function run(){
  if(!shape)return;
  const bridge=(window as unknown as {layerlingFem?:FemBridge}).layerlingFem;
  if(!bridge){setMessage("Use the packaged Windows application for its bundled analysis solver");return;}
  const job={id:crypto.randomUUID(),bridge,aborted:false};active.current=job;setRunning(true);setMessage("Preparing exact CAD geometry");
  let stop=()=>{};
  try{
   const fingerprint=await femFingerprint(shape),exported=await exportShapesToStep([shape]);
   if(exported.exportedCount!==1||exported.skipped.length)throw Error("Analysis requires one supported exact CAD body");
   if(job.aborted)return;
   const step=await exported.blob.text();
   stop=bridge.onProgress(job.id,text=>setMessage(text.slice(-1500)));
   const reply=await bridge.run(job.id,{step,settings:structuredClone(settings)});
   if(job.aborted)return;
   if(!reply.ok||!reply.result)throw Error(reply.message??"Analysis failed");
   const current=source.current.find(s=>s.id===id);
   if(!current||await femFingerprint(current)!==fingerprint)throw Error("Source changed during analysis; solve again");
   const saved:FemStudy={schema:1,sourceFingerprint:fingerprint,settings:structuredClone(settings),result:reply.result};
   validateFemStudy(saved);onSave(id,saved);setStudy(saved);setStale(false);setMessage("Linear static solve completed; force and moment equilibrium verified");
  }catch(e){if(!job.aborted)setMessage(e instanceof Error?e.message:String(e));}
  finally{stop();active.current=null;setRunning(false);}
 }
 const number=(label:string,value:number,change:(v:number)=>void)=><label>{label}<MeasurementInput aria-label={label} step="any" value={value} onValueChange={change}/></label>;
 return <section className="constraint-sketch-workbench" aria-label="Structural analysis">
  <header><strong>Structural analysis</strong><button aria-label="Close analysis" onClick={onClose}>×</button></header>
  <p>External CalculiX / CCX solver <small>(Experimental)</small></p>
  {gmshStatus&&<div role="group" aria-label="Gmsh configuration">
   <p>
    <strong>Gmsh: </strong>
    {gmshStatus.exists
     ? gmshStatus.mode==="external"
       ? "External executable available"
       : "Bundled executable available"
     : "Executable not found"}
   </p>
   <button
    type="button"
    disabled={running||choosingGmsh}
    onClick={()=>void chooseGmsh()}>
    {choosingGmsh?"Validating Gmsh...":"Browse for gmsh.exe"}
   </button>
   <a href="https://gmsh.info/" target="_blank" rel="noreferrer">Download official Gmsh 4.15.2</a>
  </div>}  <fieldset disabled={running}>
   <label>Body <select aria-label="Analysis body" value={id} onChange={e=>setId(e.target.value)}>{bodies.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <p>Linear elastic isotropic material. Analysis axes follow the exported CAD Z-up frame. Fix one outer planar end and apply a uniform traction on the opposite outer planar end. Mesh and solve use SI meters, newtons and pascals.</p>
   {number("Young modulus (GPa)",settings.young/1e9,v=>setSettings({...settings,young:v*1e9}))}
   {number("Poisson ratio",settings.poisson,v=>setSettings({...settings,poisson:v}))}
   {number("Mesh size (mm)",settings.meshSizeM*1000,v=>setSettings({...settings,meshSizeM:v/1000}))}
   <label>End axis <select aria-label="End axis" value={settings.axis} onChange={e=>setSettings({...settings,axis:Number(e.target.value)})}>{["X","Y","Z"].map((a,i)=><option key={a} value={i}>{a}</option>)}</select></label>
   <label><input type="checkbox" checked={settings.supportMax} onChange={e=>setSettings({...settings,supportMax:e.target.checked})}/>Fix maximum end</label>
   {settings.force.map((f,i)=>number("Force "+["X","Y","Z"][i]+" (N)",f,v=>{const force=[...settings.force] as [number,number,number];force[i]=v;setSettings({...settings,force});}))}
   <button disabled={gmshStatus!==null&&!gmshStatus.exists} onClick={()=>void run()}>Mesh and solve</button>
  </fieldset>
  {running&&<button onClick={()=>{if(active.current){active.current.aborted=true;active.current.bridge.cancel(active.current.id);}setMessage("Cancelling analysis");}}>Cancel analysis</button>}
  <p role="status">{message}</p>
  {study&&<>
   {(stale||JSON.stringify(settings)!==JSON.stringify(study.settings))&&<p role="alert">Geometry or analysis settings changed. These saved results are stale; solve again.</p>}
   <p>{study.result.nodes} nodes; {study.result.elements} quadratic tetrahedra</p>
   <p>Maximum displacement {(study.result.maxDisplacementM*1000).toPrecision(6)} mm. Maximum Von Mises {(study.result.maxVonMisesPa/1e6).toPrecision(6)} MPa.</p>
   <p>Reaction force residual {study.result.forceResidualN.toExponential(3)} N; moment residual {study.result.momentResidualNm.toExponential(3)} N m.</p>
   <label>Result <select value={field} onChange={e=>setField(e.target.value as typeof field)}><option value="stress">Von Mises stress</option><option value="displacement">Displacement magnitude</option></select></label>
   {number("Deformation magnification",scale,v=>setScale(Math.max(0,v)))}
   <FemResultView result={study.result} scale={scale} field={field}/>
   <p>Refine the mesh to assess convergence. Peaks near fixed edges can be singular. This isotropic study does not characterize layer-dependent FDM strength.</p>
  </>}
 </section>;
}
