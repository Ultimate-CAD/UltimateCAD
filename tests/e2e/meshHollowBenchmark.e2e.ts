import {it,expect} from "vitest";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {Session} from "node:inspector";
import manifoldModule from "manifold-3d";
import {STLLoader} from "three/examples/jsm/loaders/STLLoader.js";
import {auditManufacturingMesh} from "@/lib/manufacturingMesh";
import {repairManufacturingMesh} from "@/lib/meshManufacturingRepair";

it.skipIf(!process.env.LAYERLING_HOLLOW_BENCH)("profiles a private organic hollow without overwriting the existing fixture",async()=>{
 const variant=process.env.LAYERLING_HOLLOW_BENCH!,baseline=process.env.LAYERLING_HOLLOW_BASELINE_MODULE;
 const {hollowMesh}=await (baseline?import(/* @vite-ignore */baseline):import("@/lib/meshHollow"));
 const bytes=readFileSync(process.env.LAYERLING_ORGANIC_REPRO??".codex-run/organic-repro/source.stl");
 const geometry=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const positions=Array.from(geometry.attributes.position.array);geometry.dispose();
 for(let i=0;i<positions.length;i+=3){const y=positions[i+2];positions[i+2]=-positions[i+1];positions[i+1]=y;}
 const indices=Array.from({length:positions.length/3},(_,i)=>i);
 const runtime=await manifoldModule();runtime.setup();
 const inputSha256=createHash("sha256").update(Buffer.from(Float64Array.from(positions).buffer)).digest("hex");
 const profiler=new Session();profiler.connect();
 const post=(method:string)=>new Promise<any>((resolve,reject)=>profiler.post(method as any,(error,result)=>error?reject(error):resolve(result)));
 await post("Profiler.enable");await post("Profiler.start");
 const start=performance.now(),memoryBefore=process.memoryUsage();
 const result=hollowMesh(runtime,{positions,indices,thickness:2,openings:"none",options:{maxErrorMm:.1}},text=>{
  writeFileSync(`.codex-run/overnight-hollow/${variant}-progress.jsonl`,JSON.stringify({ms:performance.now()-start,text})+"\n",{flag:"a"});
 });
 const durationMs=performance.now()-start,memoryAfter=process.memoryUsage();
 const {profile}=await post("Profiler.stop");writeFileSync(`.codex-run/overnight-hollow/${variant}.cpuprofile`,JSON.stringify(profile));profiler.disconnect();
 const p=Float64Array.from(result.positions),i=Uint32Array.from(result.indices),header=Buffer.alloc(8);header.writeUInt32LE(p.length);header.writeUInt32LE(i.length,4);
 const meshBytes=Buffer.concat([header,Buffer.from(p.buffer),Buffer.from(i.buffer)]);writeFileSync(`.codex-run/overnight-hollow/${variant}.mesh.bin`,meshBytes);
 const mesh={vertices:Array.from({length:p.length/3},(_,i)=>Array.from(p.slice(i*3,i*3+3)) as [number,number,number]),faces:Array.from({length:i.length/3},(_,j)=>Array.from(i.slice(j*3,j*3+3)) as [number,number,number])};
 const rawAudit=auditManufacturingMesh(mesh),repairStart=performance.now();
 const repaired=repairManufacturingMesh(runtime,mesh,.0001);
 const report={variant,inputSha256,sourceFileSha256:createHash("sha256").update(bytes).digest("hex"),durationMs,stats:result.stats,outputSha256:createHash("sha256").update(meshBytes).digest("hex"),memoryBefore,memoryAfter,maxRssKiB:process.resourceUsage().maxRSS,rawAudit,repair:{durationMs:performance.now()-repairStart,audit:repaired.audit,sampledDeviationMm:repaired.sampledDeviationMm}};
 writeFileSync(`.codex-run/overnight-hollow/${variant}-result.json`,JSON.stringify(report,null,2));
 expect(result.stats.measuredErrorMm).toBeLessThanOrEqual(.1);expect(repaired.audit.valid).toBe(true);
 console.log(JSON.stringify({variant,durationMs,stats:result.stats,outputSha256:report.outputSha256,repairedTriangles:repaired.audit.triangles,repairDeviationMm:repaired.sampledDeviationMm}));
},360000);
