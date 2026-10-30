import type {MeshHollowInput,MeshHollowResult} from '@/lib/meshHollow';
type Reply={ok:boolean;bytes?:Uint8Array;stats?:MeshHollowResult['stats'];message?:string;code?:string};
type Bridge={run(id:string,bytes:Uint8Array):Promise<Reply>;cancel(id:string):void;onProgress(id:string,callback:(text:string)=>void):()=>void};
export function canNativeMeshHollow(input:MeshHollowInput){return typeof window!=='undefined'&&'layerlingGeometry' in window&&input.openings==='none'&&input.options?.direction!=='outward'&&input.options?.backend!=='wasm';}
export async function nativeMeshHollow(input:MeshHollowInput,signal?:AbortSignal,progress?:(text:string)=>void):Promise<MeshHollowResult|null>{
 const bridge=typeof window!=='undefined'?(window as unknown as {layerlingGeometry?:Bridge}).layerlingGeometry:undefined;
 if(!bridge||input.openings!=='none'||input.options?.direction==='outward'||input.options?.backend==='wasm')return null;
 if(signal?.aborted)throw new DOMException('Mesh hollowing was cancelled','AbortError');
 const pn=input.positions.length,tn=input.indices.length,size=48+pn*8+tn*4;
 if(pn%3||tn%3||pn<12||tn<12||size>720_000_048)throw new Error('Native mesh source exceeds its validated transport budget');
 // One packed copy; immutable editor input remains owned by the caller.
 const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);
 view.setUint32(0,0x31474c4c,true);view.setUint32(4,1,true);view.setUint32(8,pn,true);view.setUint32(12,tn,true);view.setFloat64(16,input.thickness,true);view.setFloat64(24,input.options?.maxErrorMm??.1,true);
 for(let i=0;i<pn;i++){if(!Number.isFinite(input.positions[i]))throw new Error('Mesh contains non-finite coordinates');view.setFloat64(48+i*8,input.positions[i],true);}
 for(let i=0;i<tn;i++){const index=input.indices[i];if(!Number.isInteger(index)||index<0||index>=pn/3)throw new Error('Mesh contains invalid triangle indices');view.setUint32(48+pn*8+i*4,index,true);}
 const id=crypto.randomUUID(),unsubscribe=bridge.onProgress(id,text=>progress?.(text.trim()));
 const abort=()=>bridge.cancel(id);signal?.addEventListener('abort',abort,{once:true});
 try{
   const reply=await bridge.run(id,bytes);
   if(signal?.aborted)throw new DOMException('Mesh hollowing was cancelled','AbortError');
   if(!reply.ok){if(reply.code==='NATIVE_UNAVAILABLE'){progress?.('Native backend unavailable; using isolated WASM worker');return null;}throw new Error(reply.message||'Native geometry stopped; original preserved');}
   const output=reply.bytes!,v=new DataView(output.buffer,output.byteOffset,output.byteLength);
   if(v.byteLength<16||v.getUint32(0,true)!==0x31524c4c||v.getUint32(4,true)!==1)throw new Error('Invalid native result protocol');
   const p=v.getUint32(8,true),t=v.getUint32(12,true);if(p%3||t%3||16+p*8+t*4!==v.byteLength)throw new Error('Invalid native result lengths');
   const positions=new Array<number>(p),indices=new Array<number>(t);
   for(let i=0;i<p;i++){positions[i]=v.getFloat64(16+i*8,true);if(!Number.isFinite(positions[i]))throw new Error('Non-finite native result');}
   for(let i=0;i<t;i++){indices[i]=v.getUint32(16+p*8+i*4,true);if(indices[i]>=p/3)throw new Error('Invalid native result index');}
   return {positions,indices,stats:reply.stats!};
 }finally{unsubscribe();signal?.removeEventListener('abort',abort);}
}
