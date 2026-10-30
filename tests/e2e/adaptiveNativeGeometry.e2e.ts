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
it.skipIf(!existsSync(exe))('handles concavities, thin additions, separate cavities and invalid sources',async()=>{
 const rt=await manifoldModule();rt.setup();const root=`.codex-run/adaptive10/shape-cases-${Date.now()}`;mkdirSync(root,{recursive:true});
 const stock=rt.Manifold.cube([20,20,20],true),tool=rt.Manifold.cube([10,22,10],true),notch=tool.translate([10,0,10]),concave=stock.subtract(notch);
 const rod=rt.Manifold.cube([2,30,2],true),thin=stock.add(rod),shift=stock.translate([35,0,0]),separate=stock.add(shift);
 try{
  for(const [name,solid] of [['concave',concave],['thin',thin],['separate',separate]] as const){
   const mesh=solid.getMesh(),input={positions:mesh.vertProperties,indices:mesh.triVerts,thickness:1,openings:'none' as const};
   writeFileSync(`${root}/${name}.request`,encodeRequest(input));const r=spawnSync(exe,[`${root}/${name}.request`,`${root}/${name}.result`],{encoding:'utf8',windowsHide:true,timeout:120000});
   expect(r.status,r.stderr).toBe(0);const stats=JSON.parse(r.stdout);expect(stats.measuredErrorMm).toBeLessThanOrEqual(.1);expect(stats.resultVolumeMm3).toBeLessThan(stats.sourceVolumeMm3);if(name==='separate')expect(stats.omittedCavities).toBe(1);
  }
  const mesh=stock.getMesh(),input={positions:mesh.vertProperties,indices:mesh.triVerts.slice(0,-3),thickness:1};writeFileSync(`${root}/open.request`,encodeRequest(input));
  const invalid=spawnSync(exe,[`${root}/open.request`,`${root}/invalid.result`],{encoding:'utf8',windowsHide:true,timeout:120000});expect(invalid.status).not.toBe(0);expect(invalid.stderr).toMatch(/closed consistently oriented/);
 }finally{for(const s of [stock,tool,notch,concave,rod,thin,shift,separate])s.delete();}
},120000);
