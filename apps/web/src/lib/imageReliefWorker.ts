import {validateImageRelief,type ImageRelief,type ReliefMesh} from "@/lib/imageRelief";
export function generateImageRelief(source:ImageRelief,signal:AbortSignal):Promise<ReliefMesh>{
 validateImageRelief(source);
 if(signal.aborted)return Promise.reject(new DOMException("Cancelled","AbortError"));
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL("../workers/imageRelief.worker.ts",import.meta.url),{type:"module"});
  let ended=false;
  const finish=(error?:Error,result?:ReliefMesh)=>{
   if(ended)return;ended=true;clearTimeout(timer);signal.removeEventListener("abort",abort);worker.terminate();
   if(error)reject(error);else resolve(result!);
  };
  const abort=()=>finish(new DOMException("Cancelled","AbortError"));
  const timer=setTimeout(()=>finish(Error("Image geometry exceeded its 45 second deadline")),45000);
  signal.addEventListener("abort",abort,{once:true});
  worker.onmessage=e=>finish(e.data.error?Error(e.data.error):undefined,e.data.result);
  worker.onerror=e=>finish(Error(e.message||"Image geometry worker failed"));
  try{worker.postMessage({source});}catch(error){finish(error instanceof Error?error:Error(String(error)));}
 });
}
