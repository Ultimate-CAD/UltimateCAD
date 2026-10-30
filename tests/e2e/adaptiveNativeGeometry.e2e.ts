import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {SphereGeometry,CylinderGeometry} from 'three';
import manifoldModule from 'manifold-3d';
import {hollowMesh} from '@/lib/meshHollow';
import {auditManufacturingMesh} from '@/lib/manufacturingMesh';
const require=createRequire(import.meta.url),{encodeRequest,decodeResult}=require('../../desktop/native-geometry-protocol.cjs');
const exe='.codex-run/adaptive10/build/Release/layerling-geometry.exe';
it.skipIf(!existsSync(exe))('compares native closed cavities to WASM at matched settings',async()=>{
 const runtime=await manifoldModule();runtime.setup();const report:any[]=[];
 const root=`.codex-run/adaptive10/poc-${Date.now()}`;mkdirSync(root,{recursive:true});
 for(const [name,geometry] of [['sphere',new SphereGeometry(10,32,20)],['cylinder',new CylinderGeometry(10,10,24,96,8)]] as const){
  const input={positions:geometry.attributes.position.array,indices:geometry.index!.array,thickness:2,openings:'none' as const,options:{maxErrorMm:.1}};
  const old=hollowMesh(runtime,input);const bytes=encodeRequest(input);writeFileSync(`${root}/${name}.request`,bytes);
  const start=performance.now(),run=spawnSync(exe,[`${root}/${name}.request`,`${root}/${name}.result`],{encoding:'utf8',windowsHide:true,timeout:120000});
  expect(run.status,run.stderr).toBe(0);const stats=JSON.parse(run.stdout),result=decodeResult(readFileSync(`${root}/${name}.result`));
  const totalMs=performance.now()-start;
  const audit=auditManufacturingMesh({vertices:Array.from({length:result.positions.length/3},(_,i)=>Array.from(result.positions.slice(i*3,i*3+3)) as [number,number,number]),faces:Array.from({length:result.indices.length/3},(_,i)=>Array.from(result.indices.slice(i*3,i*3+3)) as [number,number,number])});
  expect(audit.valid,JSON.stringify(audit)).toBe(true);expect(stats.measuredErrorMm).toBeLessThanOrEqual(.1);expect(stats.sourceVolumeMm3).toBeCloseTo(old.stats.sourceVolumeMm3,0);
  expect(Math.abs(stats.resultVolumeMm3-old.stats.resultVolumeMm3)/old.stats.resultVolumeMm3).toBeLessThan(.01);
  report.push({name,baseline:old.stats,native:stats,totalMs,audit});geometry.dispose();
 }
 writeFileSync(`${root}/results.json`,JSON.stringify(report,null,2));console.log(root);
},120000);
