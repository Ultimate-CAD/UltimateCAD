import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js';
import {CylinderGeometry} from 'three';
const require=createRequire(import.meta.url),{NativeGeometryJobs}=require('../desktop/native-geometry.cjs'),{encodeRequest}=require('../desktop/native-geometry-protocol.cjs');
const label=process.argv[2];if(!label||!/^[a-z0-9-]+$/i.test(label))throw new Error('Unique benchmark label required');
const out=path.resolve('.codex-run/adaptive10',label);if(existsSync(out))throw new Error('Benchmark artifact already exists');mkdirSync(out,{recursive:true});
const fixture=process.argv[3]||'.codex-run/organic-repro/source.stl';let geometry;
if(['dense-cone','cone-100k','cone-500k'].includes(fixture))geometry=new CylinderGeometry(0,20,80,512,fixture==='dense-cone'?1024:fixture==='cone-100k'?100:500,false);
else{const source=readFileSync(fixture);geometry=new STLLoader().parse(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));}
const positions=geometry.attributes.position.array,indices=geometry.index?.array??Uint32Array.from({length:positions.length/3},(_,i)=>i);
if(!['dense-cone','cone-100k','cone-500k'].includes(fixture))for(let i=0;i<positions.length;i+=3){const y=positions[i+2];positions[i+2]=-positions[i+1];positions[i+1]=y;}
const t=performance.now(),input=encodeRequest({positions,indices,thickness:2,options:{maxErrorMm:.1}});
input.writeUInt32LE(Number(process.env.LAYERLING_NATIVE_THREADS||0),44);
const jobs=new NativeGeometryJobs(path.resolve('.codex-run/adaptive10/build/Release/layerling-geometry.exe'),path.join(out,'jobs'));
const result=await jobs.run(label,input,text=>writeFileSync(path.join(out,'progress.log'),text,{flag:'a'}));
const report={fixture,inputTriangles:indices.length/3,inputBytes:input.length,inputSha256:createHash('sha256').update(input).digest('hex'),totalMs:performance.now()-t,stats:result.stats,outputSha256:createHash('sha256').update(result.bytes).digest('hex')};
writeFileSync(path.join(out,'result.mesh.bin'),result.bytes);writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));geometry.dispose();
