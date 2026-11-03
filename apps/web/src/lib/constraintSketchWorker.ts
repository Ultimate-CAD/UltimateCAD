import type { ConstraintSketch, ConstraintSolution } from "@/lib/constraintSketch";
/** One isolated transaction per worker; termination discards obsolete solver state. */
export function solveSketchInWorker(document: ConstraintSketch, signal: AbortSignal): Promise<ConstraintSolution> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException("Cancelled","AbortError"));return;}
    const worker=new Worker(new URL("../workers/constraintSketch.worker.ts",import.meta.url),{type:"module"});
    let settled=false;
    const finish=(error?:Error,solution?:ConstraintSolution)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener("abort",cancel);worker.terminate();if(error)reject(error);else resolve(solution!);};
    const cancel=()=>finish(new DOMException("Cancelled","AbortError"));
    const timer=setTimeout(()=>finish(new Error("Sketch solver exceeded its 20 second deadline; previous geometry preserved")),20000);
    signal.addEventListener("abort",cancel,{once:true});
    worker.onmessage=(e:MessageEvent<{id:number;solution?:ConstraintSolution;error?:string}>)=>{if(e.data.id===1)finish(e.data.error?new Error(e.data.error):undefined,e.data.solution);};
    worker.onerror=e=>finish(new Error(e.message||"Sketch solver worker failed"));
    try{worker.postMessage({id:1,document});}catch(error){finish(error instanceof Error?error:new Error(String(error)));}
  });
}
