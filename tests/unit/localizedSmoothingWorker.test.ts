import {it,expect,vi} from 'vitest';
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
  } finally {vi.unstubAllGlobals();}
});
