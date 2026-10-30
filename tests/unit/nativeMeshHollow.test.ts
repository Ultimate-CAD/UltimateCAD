import {afterEach,expect,it,vi} from 'vitest';
import {nativeMeshHollow,canNativeMeshHollow} from '@/lib/nativeMeshHollow';
const input={positions:Float32Array.from([0,0,0,1,0,0,0,1,0,0,0,1]),indices:Uint32Array.from([0,2,1,0,1,3,1,2,3,2,0,3]),thickness:.2,openings:'none' as const};
afterEach(()=>vi.unstubAllGlobals());
it('retains source arrays and decodes a versioned native result',async()=>{
 const out=new Uint8Array(16+input.positions.length*8+input.indices.length*4),view=new DataView(out.buffer);
 view.setUint32(0,0x31524c4c,true);view.setUint32(4,1,true);view.setUint32(8,12,true);view.setUint32(12,12,true);
 input.positions.forEach((x,i)=>view.setFloat64(16+i*8,x,true));input.indices.forEach((x,i)=>view.setUint32(112+i*4,x,true));
 const unsubscribe=vi.fn(),run=vi.fn(async(_id,bytes)=>{expect(bytes).toBeInstanceOf(Uint8Array);expect(new DataView(bytes.buffer).getUint32(0,true)).toBe(0x31474c4c);return {ok:true,bytes:out,stats:{backend:'native-cpu'}};});
 vi.stubGlobal('window',{layerlingGeometry:{run,onProgress:()=>unsubscribe,cancel:vi.fn()}});
 expect(canNativeMeshHollow(input)).toBe(true);expect(canNativeMeshHollow({...input,openings:'bottom'})).toBe(false);
 const result=await nativeMeshHollow(input);expect(result?.positions).toEqual(Array.from(input.positions));expect(result?.indices).toEqual(Array.from(input.indices));expect(input.positions.byteLength).toBe(48);expect(unsubscribe).toHaveBeenCalledOnce();
});
it('uses fallback only when native backend is unavailable',async()=>{
 vi.stubGlobal('window',{layerlingGeometry:{run:async()=>({ok:false,code:'NATIVE_UNAVAILABLE'}),onProgress:()=>()=>{},cancel:vi.fn()}});
 expect(await nativeMeshHollow(input)).toBeNull();
 (window as any).layerlingGeometry.run=async()=>({ok:false,message:'Native process crashed'});
 await expect(nativeMeshHollow(input)).rejects.toThrow('Native process crashed');
});
it('cancels native work and rejects stale completion without returning geometry',async()=>{
 const controller=new AbortController(),cancel=vi.fn();let finish!:(value:any)=>void;
 vi.stubGlobal('window',{layerlingGeometry:{run:()=>new Promise(resolve=>finish=resolve),onProgress:()=>()=>{},cancel}});
 const result=nativeMeshHollow(input,controller.signal);controller.abort();expect(cancel).toHaveBeenCalledOnce();finish({ok:false,message:'cancelled'});
 await expect(result).rejects.toMatchObject({name:'AbortError'});
});
