import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js';
import {unzipSync,strFromU8} from 'fflate';
import {auditManufacturingMesh} from '@/lib/manufacturingMesh';
const root=process.env.LAYERLING_NATIVE_MFG_ARTIFACTS;
it.skipIf(!root)('independently reimports captured native exports with normal manufacturing warnings intact',()=>{
 for(const format of ['stl','3mf'] as const){
  const report=JSON.parse(readFileSync(`${root}/${format}-report.json`,'utf8')),bytes=readFileSync(`${root}/result.${format}`);
  expect(report.settings.minWallMm).toBe(.8);expect(report.bodies[0].surface.selfIntersections.complete).toBe(true);expect(report.bodies[0].surface.selfIntersections.found).toBe(0);
  if(report.bodies[0].surface.wallConcern)expect(report.ready).toBe(false);
  let vertices:[number,number,number][],faces:[number,number,number][];
  if(format==='stl'){const geometry=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),p=geometry.attributes.position.array;vertices=Array.from({length:p.length/3},(_,i)=>[p[i*3],p[i*3+2],-p[i*3+1]]);faces=Array.from({length:p.length/9},(_,i)=>[i*3,i*3+1,i*3+2]);geometry.dispose();}
  else{const xml=strFromU8(unzipSync(bytes)['3D/3dmodel.model']);expect(xml).toMatch(/unit="millimeter"/);vertices=[...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(m=>[+m[1],+m[3],-m[2]]);faces=[...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(m=>[+m[1],+m[2],+m[3]]);}
  const audit=auditManufacturingMesh({vertices,faces});expect(audit.valid).toBe(true);expect(audit.degenerateFaces).toBe(0);expect(audit.nonManifoldVertices).toBe(0);expect(audit.duplicateFaces).toBe(0);expect(audit.triangles).toBe(report.triangles);
 }
},120000);
