import {it,expect,vi} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js';
import {unzipSync,strFromU8} from 'fflate';
import manifoldModule from 'manifold-3d';
import {auditManufacturingMesh} from '@/lib/manufacturingMesh';
import {sampledMeshDeviation} from '@/lib/meshManufacturingQa';
import {PrecisionExportEngine} from '@/lib/precisionExport';
import {DEFAULT_PRECISION} from '@/lib/precisionMesh';
import type {WorkplaneShape} from '@/types/layerling';
vi.mock('@/lib/brepKernel',()=>({loadBrepWithOcct:()=>{throw new Error('Native mesh export must not retessellate a B-rep');}}));
const require=createRequire(import.meta.url),{decodeResult}=require('../../desktop/native-geometry-protocol.cjs');
const fixture=process.env.LAYERLING_NATIVE_MESH_QA;
it.skipIf(!fixture||!existsSync(fixture))('validates cached native result and independently reimports explicit manufacturing exports',async()=>{
 const rt=await manifoldModule();rt.setup();const mesh=decodeResult(readFileSync(fixture!));
 const vertices=Array.from({length:mesh.positions.length/3},(_,i)=>Array.from(mesh.positions.slice(i*3,i*3+3)) as [number,number,number]);
 const faces=Array.from({length:mesh.indices.length/3},(_,i)=>Array.from(mesh.indices.slice(i*3,i*3+3)) as [number,number,number]);
 const rawAudit=auditManufacturingMesh({vertices,faces});
 if(process.env.LAYERLING_NATIVE_REQUIRE_RAW_VALID==='1')expect(rawAudit.valid,JSON.stringify(rawAudit)).toBe(true);
 if(process.env.LAYERLING_NATIVE_EXTERIOR_SOURCE){
   const bytes=readFileSync(process.env.LAYERLING_NATIVE_EXTERIOR_SOURCE),geometry=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),p=geometry.attributes.position.array;
   const key=(points:number[][])=>points.map(point=>point.join(',')).sort().join(';'),delivered=new Set(faces.map(face=>key(face.map(index=>vertices[index]))));let missing=0;
   for(let i=0;i<p.length;i+=9){const face:number[][]=[];for(let j=0;j<9;j+=3)face.push([p[i+j],p[i+j+2],-p[i+j+1]]);if(!delivered.has(key(face)))missing++;}
   expect(missing,'Generated cavity conditioning changed original exterior facets').toBe(0);geometry.dispose();
 }
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(const p of vertices)for(let i=0;i<3;i++){low[i]=Math.min(low[i],p[i]);high[i]=Math.max(high[i],p[i]);}
 const width=high[0]-low[0],height=high[1]-low[1],depth=high[2]-low[2],positions:number[]=[];
 for(const face of faces)for(const index of face){const p=vertices[index];positions.push(p[0]-(low[0]+high[0])/2,p[1]-low[1],p[2]-(low[2]+high[2])/2);}
 const shape:WorkplaneShape={id:'native-qa',name:'Native result',kind:'mesh',color:'#0169cc',x:(low[0]+high[0])/2,z:(low[2]+high[2])/2,elevation:low[1],size:width,width,height,depth,rotation:0,importedMesh:{positions,baseWidth:width,baseDepth:depth,baseHeight:height,triangleCount:faces.length,sourceFormat:'json'}};
 const unchanged=JSON.stringify(shape),engine=new PrecisionExportEngine(rt),root=`.codex-run/adaptive10/manufacturing-${Date.now()}`;mkdirSync(root,{recursive:true});
 const report:any={fixture,rawAudit};
 const original=await engine.run([shape],'stl',DEFAULT_PRECISION);
 if(!rawAudit.valid)expect(original.bytes).toBeNull();
 for(const format of ['stl','3mf'] as const){
   const result=await engine.run([shape],format,{...DEFAULT_PRECISION,repair:!rawAudit.valid});
   writeFileSync(`${root}/${format}-report.json`,JSON.stringify(result.report,null,2));
   expect(result.report.bodies[0].surface.selfIntersections.found).toBe(0);
   if(!result.report.bodies[0].surface.selfIntersections.complete)expect(result.report.ready).toBe(false);
   if(result.report.bodies[0].surface.wallConcern)expect(result.report.ready).toBe(false);
   expect(result.bytes,JSON.stringify(result.report)).not.toBeNull();
   writeFileSync(`${root}/result.${format}`,result.bytes!);let decoded:{vertices:[number,number,number][];faces:[number,number,number][]};
   if(format==='stl'){
     const bytes=result.bytes!,g=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer),p=g.attributes.position.array;
     decoded={vertices:Array.from({length:p.length/3},(_,i)=>[p[i*3],p[i*3+2],-p[i*3+1]]),faces:Array.from({length:p.length/9},(_,i)=>[i*3,i*3+1,i*3+2])};g.dispose();
   }else{
     const xml=strFromU8(unzipSync(result.bytes!)['3D/3dmodel.model']);expect(xml).toMatch(/unit="millimeter"/);
     decoded={vertices:[...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(m=>[+m[1],+m[3],-m[2]]),faces:[...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(m=>[+m[1],+m[2],+m[3]])};
   }
   const audit=auditManufacturingMesh(decoded);expect(audit.valid).toBe(true);expect(audit.degenerateFaces).toBe(0);report[format]={report:result.report,reimport:audit};
 }
 expect(JSON.stringify(shape)).toBe(unchanged);
 const reference=process.env.LAYERLING_NATIVE_REFERENCE;
 if(reference){const b=readFileSync(reference),pn=b.readUInt32LE(0),tn=b.readUInt32LE(4),p=new Float64Array(b.buffer.slice(b.byteOffset+8,b.byteOffset+8+pn*8)),t=new Uint32Array(b.buffer.slice(b.byteOffset+8+pn*8,b.byteOffset+8+pn*8+tn*4));const ref={vertices:Array.from({length:pn/3},(_,i)=>[p[i*3],p[i*3+1],p[i*3+2]] as [number,number,number][]),faces:Array.from({length:tn/3},(_,i)=>[t[i*3],t[i*3+1],t[i*3+2]] as [number,number,number][])};report.referenceDeviation={forward:sampledMeshDeviation({vertices,faces},ref),reverse:sampledMeshDeviation(ref,{vertices,faces})};}
 writeFileSync(`${root}/results.json`,JSON.stringify(report,null,2));console.log(root);
},600000);
