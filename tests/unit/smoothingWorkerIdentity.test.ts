import { it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { importedShapeFromStl } from "@/lib/stlImport";

it.skipIf(!process.env.LAYERLING_SMOOTH_BASELINE)("retains exact algorithm weights and geometry across the worker transport optimization", async () => {
  const v=[[0,0,0],[10,0,0],[0,10,0],[0,0,10]],f=[[0,2,1],[0,1,3],[1,2,3],[2,0,3]];
  let positions=f.flatMap(face=>face.flatMap(i=>v[i])),point=[0,0,0];
  if(process.env.LAYERLING_SMOOTH_IDENTITY_FIXTURE){const bytes=readFileSync(process.env.LAYERLING_SMOOTH_IDENTITY_FIXTURE);positions=importedShapeFromStl('organic.stl',bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)).importedMesh!.positions;const offset=Math.floor(positions.length/6)*3;point=positions.slice(offset,offset+3);}
  const run=async(baseline:boolean)=>{
    const messages:any[]=[];const worker={onmessage:null as any,postMessage:(data:any)=>messages.push(structuredClone(data))};
    vi.stubGlobal("self",worker);vi.resetModules();
    if(baseline)await import(/* @vite-ignore */ process.env.LAYERLING_SMOOTH_BASELINE!);else await import('@/workers/localizedSmoothing.worker');
    worker.onmessage({data:{type:'init',positions}});expect(messages.at(-1).type).toBe('ready');
    let weights=new Float64Array(messages.at(-1).weights);
    for(const stroke of [{point,radius:8,subtract:false},{point:point.map(v=>v+1),radius:5,subtract:true}]){
      worker.onmessage({data:{type:'paint',...stroke}});const reply=messages.at(-1);
      if(reply.indices)reply.indices.forEach((i:number,k:number)=>{weights[i]=reply.weights[k];});else weights=reply.weights;
    }
    worker.onmessage({data:{type:'preview',strength:.3,iterations:2,revision:42}});
    const result=messages.at(-1);expect(result.type,JSON.stringify(result)).toBe('preview');
    const decoded = result.mesh ?? {vertices:Array.from({length:result.positions.length/3},(_,i)=>Array.from(result.positions.slice(i*3,i*3+3))),faces:Array.from({length:result.display.bvh.index.length/3},(_,i)=>Array.from(result.display.bvh.index.slice(i*3,i*3+3)))};
    const geometryHash=createHash('sha256').update(JSON.stringify(decoded)).digest('hex');
    const weightsHash=createHash('sha256').update(Buffer.from(weights.buffer)).digest('hex');
    vi.unstubAllGlobals();return {geometryHash,weightsHash,stats:result.stats};
  };
  try{const before=await run(true),after=await run(false);expect(after).toEqual(before);writeFileSync(process.env.LAYERLING_SMOOTH_IDENTITY_OUTPUT??'.codex-run/viewport7/worker-identity.json',JSON.stringify({before,after},null,2));}finally{vi.unstubAllGlobals();}
});
