import {it,expect,vi} from 'vitest';
it('allows selecting an imported source but never returns an applicable preview for intersecting surfaces',async()=>{
  const messages:any[]=[];const worker={onmessage:null as any,postMessage:(data:any)=>messages.push(structuredClone(data))};
  const v=[[0,0,0],[2,0,0],[0,2,0],[.5,.5,2],[3,.5,1]],faces=[[3,0,1],[3,1,2],[3,2,0],[4,1,0],[4,2,1],[4,0,2]];
  const positions=Float64Array.from(faces.flatMap(f=>f.flatMap(i=>v[i]))),before=positions.slice();vi.stubGlobal('self',worker);vi.resetModules();
  try{
    await import('@/workers/localizedSmoothing.worker');
    worker.onmessage({data:{type:'init',positions}});expect(messages.at(-1).type).toBe('ready');
    worker.onmessage({data:{type:'preview',strength:.3,iterations:2,revision:123}});
    expect(messages.at(-1)).toMatchObject({type:'error',revision:123});expect(messages.at(-1).message).toMatch(/Source has intersecting or unverified surfaces/);
    expect(messages.some(m=>m.type==='preview')).toBe(false);expect(positions).toEqual(before);
  }finally{vi.unstubAllGlobals();}
});
