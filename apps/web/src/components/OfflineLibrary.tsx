"use client";
import {useEffect,useRef,useState} from "react";
import {addLibraryFile,listLibraryFiles,readLibraryFile,patchLibraryMeta,type LocalLibraryMeta} from "@/lib/myShapes";
import {importModelFiles} from "@/lib/modelImport";
import {importLylProject} from "@/lib/lylProject";
import {meshForShape} from "@/lib/editorMeshCore";
import {renderMyShapeThumbnail} from "@/lib/myShapeThumbnail";
import "./workplane/ConstraintSketchWorkbench.css";
export function OfflineLibrary({onOpen,onClose}:{onOpen:(file:File)=>Promise<void>;onClose:()=>void}){
 const [rows,setRows]=useState<LocalLibraryMeta[]>([]),[query,setQuery]=useState(""),[format,setFormat]=useState("all"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const stopped=useRef(false);
 const refresh=async()=>setRows((await listLibraryFiles()).sort((a,b)=>b.importedAt-a.importedAt));
 useEffect(()=>{void refresh().catch(e=>setMessage(String(e)));return()=>{stopped.current=true;};},[]);
 async function index(meta:LocalLibraryMeta,bytes:Uint8Array){
  const file=new File([new Uint8Array(bytes)],meta.name);
  try{
   const shapes=meta.format==="lyl"?(await importLylProject(bytes)).shapes:(await importModelFiles([file],{cancelled:()=>stopped.current}))?.shapes;
   if(!shapes?.length)throw Error("No supported geometry found");
   let remaining=10000;
   const previews=[];
   for(const shape of shapes){
    if(remaining<=0)break;
    const mesh=meshForShape(shape),stride=Math.max(1,Math.ceil(mesh.faces.length/remaining));
    const faces=mesh.faces.filter((_,i)=>i%stride===0).slice(0,remaining);
    remaining-=faces.length;
    const sourceToLocal=new Map<number,number>(),vertices:typeof mesh.vertices=[];
    const localFaces=faces.map(face=>face.map(id=>{
     let index=sourceToLocal.get(id);
     if(index===undefined){index=vertices.length;vertices.push(mesh.vertices[id]);sourceToLocal.set(id,index);}
     return index;
    }) as [number,number,number]);
    previews.push({vertices,faces:localFaces,color:shape.color,hole:shape.hole});
   }
   await patchLibraryMeta(meta.id,{status:"ready",diagnostic:undefined,thumbnail:renderMyShapeThumbnail(previews,160)});
  }catch(e){await patchLibraryMeta(meta.id,{status:"error",diagnostic:e instanceof Error?e.message:String(e)});}
 }
 async function ingest(files:File[]){
  stopped.current=false;setBusy(true);let added=0,duplicates=0;
  try{
   for(const file of files){
    if(stopped.current)break;
    const suffix=file.name.split(".").at(-1)?.toLowerCase()??"";
    if(!["stl","obj","step","stp","lyl"].includes(suffix)){setMessage("Unsupported file "+file.name);continue;}
    if(file.size>512*1024*1024){setMessage("File exceeds 512 MiB per-file import budget: "+file.name);continue;}
    setMessage("Indexing "+file.name);
    const bytes=new Uint8Array(await file.arrayBuffer()),hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    const id=[...hash].map(n=>n.toString(16).padStart(2,"0")).join("");
    const meta:LocalLibraryMeta={id,name:file.name,format:suffix==="stp"?"step":suffix,byteLength:bytes.length,importedAt:Date.now(),tags:[],category:"",provenance:"User-selected local export: "+file.name,status:"indexing"};
    if(await addLibraryFile(meta,bytes)){added++;await index(meta,bytes);}else duplicates++;
    await refresh();
   }
   setMessage(added+" added, "+duplicates+" exact duplicates. "+(stopped.current?"Stopped after current file.":"Indexing finished."));
  }catch(e){setMessage(String(e));}
  finally{setBusy(false);}
 }
 async function resume(){
  stopped.current=false;setBusy(true);
  try{for(const row of rows.filter(r=>r.status!=="ready")){if(stopped.current)break;setMessage("Indexing "+row.name);await index(row,await readLibraryFile(row.id));await refresh();}}
  finally{setBusy(false);}
 }
 async function patch(row:LocalLibraryMeta,update:Partial<LocalLibraryMeta>){await patchLibraryMeta(row.id,update);await refresh();}
 const visible=rows.filter(row=>(format==="all"||row.format===format)&&[row.name,row.category,row.provenance,...row.tags,...(row.aliases??[])].join(" ").toLowerCase().includes(query.toLowerCase()));
 return <section className="constraint-sketch-workbench" aria-label="Offline design library" style={{left:24,right:24,width:"auto",top:40}}>
  <header><strong>Offline design library</strong><button aria-label="Close library" onClick={()=>{stopped.current=true;onClose();}}>×</button></header>
  <p>Import local STL, OBJ, STEP and LYL files. Tinkercad exports can be imported as STL or OBJ. Original bytes stay in this workstation's library; tags, categories and provenance are editable.</p>
  <label>Bulk import <input aria-label="Bulk library import" type="file" accept=".stl,.obj,.step,.stp,.lyl" multiple disabled={busy} onChange={e=>{const files=[...e.target.files??[]];e.target.value="";void ingest(files);}}/></label>
  {busy?<button onClick={()=>{stopped.current=true;}}>Stop after current file</button>:<button onClick={()=>void resume()}>Resume incomplete indexing</button>}
  <label>Search <input aria-label="Search library" value={query} onChange={e=>setQuery(e.target.value)}/></label>
  <label>Format <select aria-label="Library format" value={format} onChange={e=>setFormat(e.target.value)}>{["all","stl","obj","step","lyl"].map(f=><option key={f}>{f}</option>)}</select></label>
  <p role="status">{message}</p><p>{visible.length} of {rows.length} models</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
   {visible.map(row=><article key={row.id} aria-label={row.name} style={{padding:12,border:"1px solid #666",borderRadius:8}}>
    {row.thumbnail&&<img src={row.thumbnail} alt={"Preview of "+row.name} width={160} height={160}/>}
    <strong>{row.name}</strong><p>{row.format.toUpperCase()} · {row.byteLength.toLocaleString()} bytes · {row.status}</p>
    <small>SHA-256 {row.id}</small>{row.aliases?.length?<p>Other names: {row.aliases.join(", ")}</p>:null}
    <label>Tags <input aria-label={"Tags "+row.name} defaultValue={row.tags.join(", ")} onBlur={e=>void patch(row,{tags:e.target.value.split(",").map(v=>v.trim()).filter(Boolean)})}/></label>
    <label>Category <input aria-label={"Category "+row.name} defaultValue={row.category} onBlur={e=>void patch(row,{category:e.target.value})}/></label>
    <label>Provenance <input aria-label={"Provenance "+row.name} defaultValue={row.provenance} onBlur={e=>void patch(row,{provenance:e.target.value})}/></label>
    {row.diagnostic&&<p role="alert">{row.diagnostic}</p>}
    <button disabled={busy} onClick={()=>void readLibraryFile(row.id).then(bytes=>onOpen(new File([new Uint8Array(bytes)],row.name))).catch(e=>setMessage(String(e)))}>Open model</button>
    <button onClick={()=>void readLibraryFile(row.id).then(bytes=>{const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)])),a=document.createElement("a");a.href=url;a.download=row.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);})}>Export original</button>
   </article>)}
  </div>
 </section>;
}
