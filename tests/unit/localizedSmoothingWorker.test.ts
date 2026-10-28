import {it,expect,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {importedShapeFromStl} from '@/lib/stlImport';
it('initializes, paints, and validates a worker preview with actual messages',async()=>{
  const messages:any[]=[];const worker={onmessage:null as any,postMessage:(m:any)=>messages.push(m)};
  vi.stubGlobal('self',worker);
  try {
    await import('@/workers/localizedSmoothing.worker');
    const v=[[0,0,0],[10,0,0],[0,10,0],[0,0,10]],f=[[0,2,1],[0,1,3],[1,2,3],[2,0,3]];
    worker.onmessage({data:{type:'init',positions:f.flatMap(t=>t.flatMap(i=>v[i]))}});
    expect(messages.at(-1),JSON.stringify(messages)).toMatchObject({type:'ready'});
    worker.onmessage({data:{type:'paint',point:[0,0,0],radius:5,subtract:false}});
    expect(messages.at(-1)).toMatchObject({type:'selection'});
    worker.onmessage({data:{type:'preview',strength:.3,iterations:2}});
    expect(messages.at(-1),JSON.stringify(messages.at(-1))).toMatchObject({type:'preview'});
    if(process.env.LAYERLING_SMOOTH_ORGANIC){
      const raw=readFileSync(process.env.LAYERLING_SMOOTH_ORGANIC),shape=importedShapeFromStl('organic.stl',raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),positions=shape.importedMesh!.positions,start=performance.now();
      worker.onmessage({data:{type:'init',positions}});
      expect(messages.at(-1),JSON.stringify(messages.at(-1))).toMatchObject({type:'ready'});
      const ready=messages.at(-1),point=ready.mesh.vertices[Math.floor(ready.mesh.vertices.length/2)];
      worker.onmessage({data:{type:'paint',point,radius:5,subtract:false}});
      worker.onmessage({data:{type:'preview',strength:.2,iterations:3}});
      expect(messages.at(-1),JSON.stringify(messages.at(-1))).toMatchObject({type:'preview'});
      writeFileSync('.codex-run/smoothing-organic-result.json',JSON.stringify({stats:messages.at(-1).stats,audit:messages.at(-1).audit,durationMs:performance.now()-start},null,2));
    }
  } finally {vi.unstubAllGlobals();}
});
