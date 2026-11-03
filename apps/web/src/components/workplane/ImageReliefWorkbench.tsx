"use client";
import {useEffect,useRef,useState} from "react";
import {DEFAULT_RELIEF,validateImageRelief,type ImageRelief,type ReliefMesh} from "@/lib/imageRelief";
import {generateImageRelief} from "@/lib/imageReliefWorker";
import type {WorkplaneShape} from "@/types/layerling";
import {ImageReliefPreview} from "./ImageReliefPreview";
import "./ConstraintSketchWorkbench.css";
export function ImageReliefWorkbench({shape,onApply,onClose}:{shape?:WorkplaneShape;onApply:(source:ImageRelief,mesh:ReliefMesh,target:string|null)=>WorkplaneShape;onClose:()=>void}){
 const [source,setSource]=useState<ImageRelief|undefined>(shape?.imageRelief),[mesh,setMesh]=useState<ReliefMesh>(),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[backlit,setBacklit]=useState(false),[locked,setLocked]=useState(true);
 const [target,setTarget]=useState<string|null>(shape?.imageRelief?shape.id:null);
 const applyController=useRef<AbortController|null>(null),previewSource=useRef<string|undefined>(undefined),key=JSON.stringify(source?{...source,dataUrl:undefined}:null);
 const [previewKey,setPreviewKey]=useState("");
 useEffect(()=>{
  if(!source)return;
  setMesh(undefined);const abort=new AbortController(),timer=setTimeout(()=>{
   try{validateImageRelief(source);void generateImageRelief({...source,settings:{...source.settings,resolution:Math.min(96,source.settings.resolution)}},abort.signal).then(result=>{if(!abort.signal.aborted){setMesh(result);setPreviewKey(key);previewSource.current=source.dataUrl;setMessage("");}}).catch(e=>{if(!abort.signal.aborted)setMessage(String(e));});}catch(e){setMessage(String(e));}
  },300);
  return()=>{clearTimeout(timer);abort.abort();};
 },[key,source?.dataUrl]);
 useEffect(()=>()=>applyController.current?.abort(),[]);
 async function importImage(file:File){
  const extension=file.name.split(".").at(-1)?.toLowerCase(),mime=file.type||({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp"} as Record<string,string>)[extension??""];
  if(!["image/png","image/jpeg","image/webp"].includes(mime)||file.size>64*1024*1024){setMessage("Choose a PNG, JPEG or WebP image up to 64 MiB");return;}
  try{
   const dataUrl=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(new Blob([file],{type:mime}));});
   const image=await createImageBitmap(file);
   try{
    if(image.width*image.height>100000000)throw Error("Image exceeds the 100 megapixel decode budget");
    setTarget(null);setSource({schema:1,fileName:file.name,dataUrl,imageWidth:image.width,imageHeight:image.height,settings:{...DEFAULT_RELIEF,height:100*image.height/image.width}});
   }finally{image.close();}
  }catch(e){setMessage(String(e));}
 }
 async function apply(){
  if(!source)return;const abort=new AbortController();applyController.current=abort;setBusy(true);
  try{
   const result=source.settings.resolution<=96&&mesh&&previewKey===key&&previewSource.current===source.dataUrl?mesh:await generateImageRelief(source,abort.signal);
   if(!abort.signal.aborted){const next=onApply(source,result,target);setTarget(next.id);setMessage("Image solid applied");}
  }catch(e){if(!abort.signal.aborted)setMessage(String(e));}
  finally{setBusy(false);}
 }
 function patch(update:Partial<ImageRelief["settings"]>){if(source)setSource({...source,settings:{...source.settings,...update}});}
 const num=(label:string,value:number,change:(v:number)=>void)=><label>{label}<input type="number" aria-label={label} step="any" value={value} onChange={e=>{const v=Number(e.target.value);if(Number.isFinite(v))change(v);}}/></label>;
 return <section className="constraint-sketch-workbench" aria-label="Image-to-solid designer">
  <header><strong>Lithophane and bas-relief</strong><button aria-label="Close image designer" onClick={()=>{applyController.current?.abort();onClose();}}>×</button></header>
  <fieldset disabled={busy}>
   <label>Image <input aria-label="Source image" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void importImage(f);}}/></label>
   {source&&<>
    <p>{source.fileName} · original {source.imageWidth} × {source.imageHeight} pixels</p>
    <label>Mode <select aria-label="Image modeling mode" value={source.settings.mode} onChange={e=>patch({mode:e.target.value as "lithophane"|"relief"})}><option value="lithophane">Backlit lithophane</option><option value="relief">Decorative bas-relief</option></select></label>
    <label><input type="checkbox" checked={locked} onChange={e=>setLocked(e.target.checked)}/>Lock image aspect ratio</label>
    {num("Width (mm)",source.settings.width,v=>patch({width:v,...(locked?{height:v*source.imageHeight/source.imageWidth}:{})}))}
    {num("Height (mm)",source.settings.height,v=>patch({height:v,...(locked?{width:v*source.imageWidth/source.imageHeight}:{})}))}
    {num("Minimum thickness / base (mm)",source.settings.minThickness,v=>patch({minThickness:v}))}
    {num("Maximum thickness / peak (mm)",source.settings.maxThickness,v=>patch({maxThickness:v}))}
    {num("Gamma",source.settings.gamma,v=>patch({gamma:v}))}
    {num("Brightness",source.settings.brightness,v=>patch({brightness:v}))}
    {num("Contrast",source.settings.contrast,v=>patch({contrast:v}))}
    <label><input type="checkbox" checked={source.settings.invert} onChange={e=>patch({invert:e.target.checked})}/>Invert luminance</label>
    {num("Sampling resolution (long side)",source.settings.resolution,v=>patch({resolution:v}))}
    {num("Smoothing passes",source.settings.smoothing,v=>patch({smoothing:v}))}
    {num("Border width (mm)",source.settings.borderWidth,v=>patch({borderWidth:v}))}
    {num("Border thickness (mm)",source.settings.borderThickness,v=>patch({borderThickness:v}))}
    <label><input type="checkbox" checked={backlit} onChange={e=>setBacklit(e.target.checked)}/>Simulated backlighting</label>
    <p>Black is thicker in lithophane mode. White is higher in relief mode. The preview uses at most 96 samples per side; Apply uses the selected resolution, up to 512. Backlighting estimates transmission with an assumed attenuation of 1.1 per mm; actual filament varies.</p>
   </>}
  </fieldset>
  {mesh&&previewKey===key&&previewSource.current===source?.dataUrl&&<ImageReliefPreview mesh={mesh} backlit={backlit}/>}
  <p role="status">{message}</p>
  <button disabled={!source||!mesh||previewKey!==key||previewSource.current!==source?.dataUrl||busy} onClick={()=>void apply()}>Apply image solid</button>
  {busy&&<button onClick={()=>applyController.current?.abort()}>Cancel image generation</button>}
 </section>;
}
