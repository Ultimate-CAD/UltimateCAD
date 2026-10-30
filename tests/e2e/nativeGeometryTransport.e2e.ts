import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {existsSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {CylinderGeometry} from 'three';
const require=createRequire(import.meta.url),{NativeGeometryJobs}=require('../../desktop/native-geometry.cjs'),{validateRequest,encodeRequest}=require('../../desktop/native-geometry-protocol.cjs');
const exe=path.resolve('.codex-run/adaptive10/build/Release/layerling-geometry.exe');
it.skipIf(!existsSync(exe))('isolates malformed inputs and cancellation then accepts a new job',async()=>{
 const root=mkdtempSync(path.resolve('.codex-run/adaptive10/transport-'));
 const jobs=new NativeGeometryJobs(exe,root),geometry=new CylinderGeometry(10,10,24,96,8),good=encodeRequest({positions:geometry.attributes.position.array,indices:geometry.index!.array,thickness:2});geometry.dispose();
 try{
  const truncated=good.subarray(0,good.length-1);expect(()=>validateRequest(truncated)).toThrow();
  const invalid=Buffer.from(good);invalid.writeDoubleLE(NaN,48);
  await expect(jobs.run('invalid',invalid)).rejects.toThrow(/Non-finite/);
  const running=jobs.run('cancel',good);await new Promise(resolve=>setTimeout(resolve,30));jobs.cancel('cancel');
  await expect(running).rejects.toThrow(/cancelled/);
  const timed=new NativeGeometryJobs(exe,path.join(root,'timeout'),{timeoutMs:1});
  await expect(timed.run('timeout',good)).rejects.toThrow(/time budget/);
  const result=await jobs.run('restart',good);expect(result.stats.measuredErrorMm).toBeLessThanOrEqual(.1);expect(jobs.jobs.size).toBe(0);
 }finally{jobs.close();rmSync(root,{recursive:true,force:true});}
},120000);
