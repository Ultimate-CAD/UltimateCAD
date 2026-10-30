import { _electron as electron } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const executable = path.resolve(process.argv.slice(2).find((s) => s.endsWith(".exe")) || "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe");
const output = path.resolve(process.env.LAYERLING_HOLLOW_FINISHING_VALIDATION_DIR || "dist/ultimate/windows/hollow-finishing-validation");
const fixtureOverride = process.env.LAYERLING_FINISH_FIXTURE ? path.resolve(process.env.LAYERLING_FINISH_FIXTURE) : null;
const cutPosition = Number(process.env.LAYERLING_FINISH_POSITION ?? 3.1);
const expectThinWarning = process.env.LAYERLING_FINISH_EXPECT_THIN_WARNING === "1";
const stressOnly = process.env.LAYERLING_GEOMETRY_STRESS_ONLY === "1";
const repeatPreviewsRaw = process.env.LAYERLING_GEOMETRY_REPEAT_PREVIEWS ?? "0";
assert.ok(/^(?:0|[1-9]\d*)$/.test(repeatPreviewsRaw), "LAYERLING_GEOMETRY_REPEAT_PREVIEWS must be an integer from 0 through 30");
const repeatPreviewCount = Number(repeatPreviewsRaw);
assert.ok(repeatPreviewCount<=30, "LAYERLING_GEOMETRY_REPEAT_PREVIEWS must be an integer from 0 through 30");
assert.ok(!stressOnly||repeatPreviewCount===0,"Repeated cache probes require normal mode, not stress-only mode");
const interactionEnabled = process.env.LAYERLING_GEOMETRY_INTERACTION === "1" || stressOnly;
const renderInstrumentationEnabled = interactionEnabled || repeatPreviewCount>0;
const expectedAppVersion = process.env.LAYERLING_EXPECTED_APP_VERSION;
assert.ok(Number.isFinite(cutPosition), "LAYERLING_FINISH_POSITION must be a finite number");
assert.ok(expectedAppVersion && /\.(?:8|9|10)$/.test(expectedAppVersion), "Set LAYERLING_EXPECTED_APP_VERSION to the exact .8, .9 or .10 package version");
const profile = path.join(output, `isolated-profile-${Date.now()}`);
mkdirSync(output, { recursive: true });
const checks = [], errors = [], requests = [];
let app, page, connection, editorId, sourceObject, appVersion, appliedMeshAssetSha256 = null, exportAudits = {}, workerTrace = [], memoryTimer, memorySampling = false;
const memorySamples = [];
const interaction = { enabled: interactionEnabled, stressOnly, repeatPreviewCount, metricDefinition: "WebGL API call CPU time only; no GPU completion inferred", previewLatenciesMs: [], snapshots: {}, planeMotion: null, staleInjection: null };
const repeatedPreviewProbe = repeatPreviewCount ? { requestedCount: repeatPreviewCount, pacingMs: 100, forcedGCInterval: 5, forcedGCs: [], previews: [], memorySnapshots: [], sourceGeometryUnchanged: null, webglUploadDeltaCalls: null, note: "Forced page HeapProfiler GC does not collect the finishing worker heap; WebGL API upload calls do not imply GPU completion." } : null;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (name, detail) => { checks.push({ name, detail }); console.log("PASS", name, detail ?? ""); };

// A full outer cylinder encloses a separate, inward-wound closed cavity shell.
function hollowCylinderStl(segments = 64) {
  const vertices = [], faces = [];
  const shell = (radius, bottom, top, reverse) => {
    const base = vertices.length;
    for (const y of [bottom, top]) {
      for (let j = 0; j < segments; j++) {
        const a = 2 * Math.PI * j / segments;
        vertices.push([radius * Math.cos(a), y, radius * Math.sin(a)]);
      }
    }
    const bottomCenter = vertices.length; vertices.push([0,bottom,0]);
    const topCenter = vertices.length; vertices.push([0,top,0]);
    const add = (a,b,c) => faces.push(reverse ? [a,c,b] : [a,b,c]);
    for (let j=0;j<segments;j++) {
      const n=(j+1)%segments, bj=base+j, bn=base+n, tj=base+segments+j, tn=base+segments+n;
      add(bj,tj,bn); add(bn,tj,tn);
      add(bottomCenter,bj,bn); add(topCenter,tn,tj);
    }
  };
  shell(10,0,20,false);
  shell(8,2,18,true);
  const toStl = ([x, y, z]) => [x, -z, y];
  const facets = faces.map(([ia, ib, ic]) => {
    const a = toStl(vertices[ia]), b = toStl(vertices[ib]), c = toStl(vertices[ic]);
    const u = b.map((v, i) => v - a[i]), v = c.map((x, i) => x - a[i]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const d = Math.hypot(...n) || 1;
    return ` facet normal ${n.map((x) => x / d).join(" ")}\n  outer loop\n   vertex ${a.join(" ")}\n   vertex ${b.join(" ")}\n   vertex ${c.join(" ")}\n  endloop\n endfacet`;
  });
  return `solid hollow-cylinder\n${facets.join("\n")}\nendsolid hollow-cylinder\n`;
}

async function command(action, params = {}) {
  const response = await fetch(connection.url + "/api/layerling-mcp", {
    method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "command", editorId, action, params, timeoutMs: 60000 }), signal: AbortSignal.timeout(70000),
  });
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
async function ready(projectName) {
  for (let i = 0; i < 150; i++) {
    const r = await fetch(connection.url + "/api/layerling-mcp", { headers: { Authorization: `Bearer ${connection.token}` } });
    const json = await r.json();
    const editor = json.editors?.filter((e) => Date.now() - e.lastSeen < 10000 && (!projectName || e.projectName === projectName)).sort((a,b) => b.lastSeen-a.lastSeen)[0];
    if (editor) { editorId = editor.editorId; return editor; }
    await pause(200);
  }
  throw Error("Editor did not register with MCP");
}
async function objectById(id) { return (await command("list_objects")).objects.find((o) => o.id === id); }
async function waitObject(id, predicate, label) {
  for (let i=0;i<150;i++) { const o=await objectById(id); if(o&&predicate(o)) return o; await pause(100); }
  throw Error(`Object ${id} did not reach ${label}`);
}
async function waitPreviewReady(dialog) {
  await page.waitForFunction(() => {
    const d=document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]');
    const preview=[...(d?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()==="Preview");
    return d?.innerText.includes("Ready") && preview && !preview.disabled;
  },null,{timeout:180000});
  assert.match(await dialog.innerText(),/Ready/);
  await dialog.getByRole("button",{name:"Preview",exact:true}).waitFor({state:"visible"});
  assert.equal(await dialog.getByRole("button",{name:"Preview",exact:true}).isEnabled(),true);
}
async function waitFinishingPreview(dialog) {
  await page.waitForFunction(()=>{
    const d=document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]');
    const apply=[...(d?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()==="Apply");
    return d?.querySelector('[role="alert"]') || (apply && !apply.disabled);
  },null,{timeout:180000});
  assert.equal(await dialog.getByRole("alert").count(),0,await dialog.innerText());
  assert.equal(await dialog.getByRole("button",{name:"Apply",exact:true}).isEnabled(),true);
  const latency = await page.evaluate(() => {
    const apply=[...(document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]')?.querySelectorAll("button")||[])].find(b=>b.textContent?.trim()==="Apply");
    const previews=(window.__hollowFinishWorkerTrace||[]).filter(w=>w.name==="layerling-hollow-finishing").flatMap(w=>w.incoming).filter(m=>m.type==="preview");
    const last=previews.at(-1);
    const uiEnabledObservedAt=performance.now();
    return last&&apply&&!apply.disabled?{workerPreviewReceivedAt:last.at,uiEnabledObservedAt,latencyMs:uiEnabledObservedAt-last.at}:null;
  });
  if(latency&&renderInstrumentationEnabled) interaction.previewLatenciesMs.push(latency);
}
async function interactionSnapshot(label) {
  if(!renderInstrumentationEnabled||!page)return null;
  const snapshot=await page.evaluate((name)=>{
    const metrics=window.__hollowRenderMetrics;
    if(!metrics)return null;
    const canvas=metrics.canvas;
    const operations=Object.fromEntries(Object.entries(metrics.operations).map(([key,value])=>[key,{...value}]));
    const snapshot={label:name,at:performance.now(),canvas:{width:canvas?.width||0,height:canvas?.height||0,clientWidth:canvas?.clientWidth||0,clientHeight:canvas?.clientHeight||0,devicePixelRatio},drawCalls:Object.entries(operations).filter(([k])=>k.startsWith("draw")).reduce((n,[,v])=>n+v.count,0),drawCallCPUms:Object.entries(operations).filter(([k])=>k.startsWith("draw")).reduce((n,[,v])=>n+v.callCPUms,0),bufferUploadCalls:Object.entries(operations).filter(([k])=>k==="bufferData"||k==="bufferSubData").reduce((n,[,v])=>n+v.count,0),bufferUploadCPUms:Object.entries(operations).filter(([k])=>k==="bufferData"||k==="bufferSubData").reduce((n,[,v])=>n+v.callCPUms,0),operations,longTaskCount:metrics.longTasks.length,longTaskTotalMs:metrics.longTasks.reduce((n,x)=>n+x.durationMs,0),contextEvents:[...metrics.contextEvents]};
    const measured=performance.getEntriesByType("measure").filter(entry=>entry.name.startsWith("layerling.finishing."));
    snapshot.performanceMeasureCount=measured.length;
    snapshot.performanceMeasures=measured.slice(-200).map(entry=>({name:entry.name,durationMs:entry.duration,startTimeMs:entry.startTime}));
    snapshot.performancePhaseTotalsMs=Object.fromEntries([...new Set(measured.map(entry=>entry.name))].map(name=>[name,measured.filter(entry=>entry.name===name).reduce((n,entry)=>n+entry.duration,0)]));
    return snapshot;
  },label);
  if(snapshot)interaction.snapshots[label]=snapshot;
  return snapshot;
}
async function installInteractionMonitor() {
  if(!renderInstrumentationEnabled)return;
  await page.evaluate(()=>{
    const canvas=document.querySelector('[role="dialog"][aria-label="Open Hollow Base"] canvas');
    if(!canvas)throw new Error("Open Hollow Base WebGL canvas was not found after source readiness");
    window.__layerlingGeometryDiagnostics=true;
    const metrics=window.__hollowRenderMetrics={canvas,operations:{},frames:[],longTasks:[],contextEvents:[]};
    const record=(name,context,start)=>{
      if(context.canvas!==canvas)return;
      const elapsed=performance.now()-start;
      const value=metrics.operations[name]||{count:0,callCPUms:0};
      value.count++; value.callCPUms+=elapsed; metrics.operations[name]=value;
    };
    const methods=["drawArrays","drawElements","drawRangeElements","drawArraysInstanced","drawElementsInstanced","drawArraysInstancedANGLE","drawElementsInstancedANGLE","bufferData","bufferSubData"];
    const contexts=[window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype].filter(Boolean);
    for(const proto of contexts)for(const name of methods){
      if(!Object.prototype.hasOwnProperty.call(proto,name)||typeof proto[name]!=="function"||proto[name].__hollowMetricsWrapped)continue;
      const original=proto[name];
      const wrapped=function(...args){
        if(this.canvas!==canvas)return original.apply(this,args);
        const start=performance.now();
        try{return original.apply(this,args)}finally{record(name,this,start)}
      };
      Object.defineProperty(wrapped,"__hollowMetricsWrapped",{value:true});
      proto[name]=wrapped;
    }
    canvas.addEventListener("webglcontextlost",event=>metrics.contextEvents.push({type:"lost",at:performance.now(),statusMessage:event.statusMessage||""}));
    canvas.addEventListener("webglcontextrestored",()=>metrics.contextEvents.push({type:"restored",at:performance.now()}));
    let previous=null;
    const frame=at=>{if(previous!==null&&metrics.frames.length<100000)metrics.frames.push(at-previous);previous=at;requestAnimationFrame(frame)};
    requestAnimationFrame(frame);
    if(window.PerformanceObserver&&PerformanceObserver.supportedEntryTypes?.includes("longtask")){
      const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())metrics.longTasks.push({startMs:entry.startTime,durationMs:entry.duration})});
      observer.observe({type:"longtask",buffered:true});
    }
  });
}
function percentile(values,p){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]}
async function webglUploadCounts(){
  if(!page)return null;
  return page.evaluate(()=>{
    const operations=window.__hollowRenderMetrics?.operations||{};
    return {calls:(operations.bufferData?.count||0)+(operations.bufferSubData?.count||0),callCPUms:(operations.bufferData?.callCPUms||0)+(operations.bufferSubData?.callCPUms||0),bufferDataCalls:operations.bufferData?.count||0,bufferSubDataCalls:operations.bufferSubData?.count||0};
  });
}
async function captureProbeMemory(label,completedPreviews){
  while(memorySampling)await pause(25);
  memorySampling=true;
  try{
    const jsHeap=await page.evaluate(()=>{
      const m=performance.memory;
      return m?{usedJSHeapSize:m.usedJSHeapSize,totalJSHeapSize:m.totalJSHeapSize,jsHeapSizeLimit:m.jsHeapSizeLimit}:null;
    });
    const processes=await app.evaluate(({app})=>app.getAppMetrics());
    repeatedPreviewProbe.memorySnapshots.push({label,completedPreviews,at:new Date().toISOString(),rendererPerformanceMemory:jsHeap,appMetrics:processes.map(p=>({pid:p.pid,type:p.type,memory:p.memory}))});
  }finally{memorySampling=false}
}
async function runRepeatedCachedPreviewProbe(dialog,sourceMeshResourceSha256){
  if(!repeatPreviewCount)return;
  repeatedPreviewProbe.sourceMeshResourceSha256=sourceMeshResourceSha256;
  interaction.repeatedPreviewProbe=repeatedPreviewProbe;
  const cdp=await page.context().newCDPSession(page);
  try{
    await cdp.send("HeapProfiler.enable");
    await captureProbeMemory("before-probe",0);
    for(let index=1;index<=repeatPreviewCount;index++){
      await pause(repeatedPreviewProbe.pacingMs);
      const uploadsBefore=await webglUploadCounts();
      const requestStartedAt=await page.evaluate(()=>performance.now());
      await dialog.getByRole("button",{name:"Preview",exact:true}).click();
      await waitFinishingPreview(dialog);
      assert.match(await dialog.innerText(),/\(cached\)/,`Repeat preview ${index} was not reported as cached`);
      const received=await page.evaluate(start=>{
        const records=window.__hollowFinishWorkerTrace||[];
        for(let wi=records.length-1;wi>=0;wi--){
          const record=records[wi];if(record.name!=="layerling-hollow-finishing")continue;
          for(let mi=record.incoming.length-1;mi>=0;mi--){
            const message=record.incoming[mi];
            if(message.type!=="preview"||message.at<start)continue;
            const sent=[...record.outgoing].reverse().find(x=>x.type==="preview"&&x.revision===message.revision&&x.at>=start);
            if(sent)return {workerId:record.id,revision:message.revision,receivedAt:message.at,sentAt:sent.at,cacheHit:message.stats?.cacheHit,requestMs:message.requestMs,geometryMs:message.stats?.geometryMs,validationMs:message.stats?.validationMs,workerRoundTripMs:message.at-sent.at};
          }
        }
        return null;
      },requestStartedAt);
      assert.ok(received,`Repeat preview ${index} had no matching worker response`);
      assert.equal(received.cacheHit,true,`Repeat preview ${index} did not hit the worker cache`);
      const ui=interaction.previewLatenciesMs.at(-1);
      const uploadsAfter=await webglUploadCounts();
      const uploadDeltaCalls=(uploadsAfter?.calls||0)-(uploadsBefore?.calls||0);
      const uploadDeltaCPUms=(uploadsAfter?.callCPUms||0)-(uploadsBefore?.callCPUms||0);
      if(/\.(?:9|10)$/.test(appVersion))assert.equal(uploadDeltaCalls,0,`Repeat preview ${index} uploaded WebGL buffers`);
      repeatedPreviewProbe.previews.push({index,requestStartedAt,requestToUiEnabledMs:ui?ui.uiEnabledObservedAt-requestStartedAt:null,workerToUiEnabledMs:ui?.latencyMs??null,...received,uploadDeltaCalls,uploadDeltaCPUms});
      if(index%repeatedPreviewProbe.forcedGCInterval===0){
        await captureProbeMemory("before-forced-page-gc",index);
        const startedAt=await page.evaluate(()=>performance.now());
        await cdp.send("HeapProfiler.collectGarbage");
        const endedAt=await page.evaluate(()=>performance.now());
        repeatedPreviewProbe.forcedGCs.push({completedPreviews:index,startedAt,endedAt,durationMs:endedAt-startedAt,scope:"renderer page V8 heap; finishing worker heap is not forced"});
        await captureProbeMemory("after-forced-page-gc",index);
      }
    }
    const sourceAfter=await savedProject(false);
    repeatedPreviewProbe.sourceGeometryUnchanged=sourceAfter.meshResourceSha256===sourceMeshResourceSha256;
    assert.equal(repeatedPreviewProbe.sourceGeometryUnchanged,true,"Repeated cached previews changed the saved source geometry asset");
    repeatedPreviewProbe.webglUploadDeltaCalls=repeatedPreviewProbe.previews.reduce((sum,x)=>sum+x.uploadDeltaCalls,0);
    if(/\.(?:9|10)$/.test(appVersion))assert.equal(repeatedPreviewProbe.webglUploadDeltaCalls,0,"Repeated cached previews uploaded WebGL buffers");
    await captureProbeMemory("after-probe",repeatPreviewCount);
    interaction.repeatedPreviewProbe=repeatedPreviewProbe;
  }finally{
    await cdp.detach().catch(()=>{});
  }
}
async function runPlaneInteraction(dialog) {
  if(!interactionEnabled)return;
  await pause(100);
  await interactionSnapshot("source-idle-start");
  const idleStart=await page.evaluate(()=>({frameIndex:window.__hollowRenderMetrics.frames.length,at:performance.now()}));
  await pause(1000);
  const idleEnd=await page.evaluate(()=>({frameIndex:window.__hollowRenderMetrics.frames.length,at:performance.now()}));
  const idle=await interactionSnapshot("source-idle-1s");
  const idleStartSnapshot=interaction.snapshots["source-idle-start"];
  const workerState=await page.evaluate(()=>{
    const record=[...(window.__hollowFinishWorkerTrace||[])].reverse().find(w=>w.name==="layerling-hollow-finishing"&&w.incoming.some(m=>m.type==="ready"));
    const apply=[...(document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]')?.querySelectorAll("button")||[])].find(b=>b.textContent?.trim()==="Apply");
    return {workerId:record?.id,previewCount:record?.outgoing.filter(m=>m.type==="preview").length||0,applyDisabled:!!apply?.disabled};
  });
  assert.ok(workerState.workerId!==undefined,"No ready finishing worker found for plane interaction");
  assert.equal(workerState.applyDisabled,true,"Apply must be disabled before plane interaction");
  const frameBegin=await page.evaluate(()=>window.__hollowRenderMetrics.frames.length);
  const motion=await page.evaluate(async({workerId,initialPreviewCount,center,frameBegin})=>{
    const dialog=document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]');
    const slider=dialog?.querySelector('input[aria-label="Plane position slider"]');
    const apply=[...(dialog?.querySelectorAll("button")||[])].find(b=>b.textContent?.trim()==="Apply");
    const record=window.__hollowFinishWorkerTrace?.[workerId];
    if(!slider||!record)throw new Error("Plane slider or finishing worker record disappeared");
    const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
    const min=Number(slider.min),max=Number(slider.max),span=max-min,amplitude=span*0.12;
    let events=0;
    const startedAt=performance.now();
    for(let i=0;i<120;i++){
      const value=Math.min(max,Math.max(min,center+amplitude*Math.sin(i*0.37)));
      setValue.call(slider,String(value));
      slider.dispatchEvent(new Event("input",{bubbles:true}));
      events++;
      if(i%12===11){
        await new Promise(resolve=>setTimeout(resolve,1));
        if(!apply?.disabled)throw new Error("Apply became enabled during plane interaction");
        if(record.outgoing.filter(m=>m.type==="preview").length!==initialPreviewCount)throw new Error("Worker received a preview during plane interaction");
      }
      await new Promise(resolve=>setTimeout(resolve,1000/60));
    }
    const endedAt=performance.now();
    return {events,startedAt,endedAt,min,max,span,finalSliderValue:Number(slider.value),frames:window.__hollowRenderMetrics.frames.slice(frameBegin)};
  },{workerId:workerState.workerId,initialPreviewCount:workerState.previewCount,center:cutPosition,frameBegin});
  const positionInput=dialog.getByLabel("Cut position (mm)");
  await positionInput.fill(String(cutPosition));
  const restored=Number(await positionInput.inputValue());
  assert.equal(restored,cutPosition,"Plane interaction did not restore the exact cut position");
  const after=await page.evaluate((workerId)=>{
    const record=window.__hollowFinishWorkerTrace?.[workerId];
    const apply=[...(document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]')?.querySelectorAll("button")||[])].find(b=>b.textContent?.trim()==="Apply");
    return {previewCount:record?.outgoing.filter(m=>m.type==="preview").length||0,applyDisabled:!!apply?.disabled,frameCount:window.__hollowRenderMetrics.frames.length,longTaskCount:window.__hollowRenderMetrics.longTasks.length};
  },workerState.workerId);
  assert.equal(after.applyDisabled,true,"Restoring cut position left Apply enabled");
  assert.equal(after.previewCount,workerState.previewCount,"Plane interaction emitted a worker preview");
  const fps=motion.frames.filter(ms=>ms>0).map(ms=>1000/ms);
  interaction.sourceIdle={durationMs:idleEnd.at-idleStart.at,frameSamples:idleEnd.frameIndex-idleStart.frameIndex,idleDrawCalls:Math.max(0,(idle?.drawCalls||0)-(idleStartSnapshot?.drawCalls||0)),idleBufferUploadCalls:Math.max(0,(idle?.bufferUploadCalls||0)-(idleStartSnapshot?.bufferUploadCalls||0)),longTaskCount:Math.max(0,(idle?.longTaskCount||0)-(idleStartSnapshot?.longTaskCount||0)),longTaskDurationMs:Math.max(0,(idle?.longTaskTotalMs||0)-(idleStartSnapshot?.longTaskTotalMs||0))};
  interaction.planeMotion={events:motion.events,durationMs:motion.endedAt-motion.startedAt,rangeMm:{min:motion.min,max:motion.max},restoredCutPositionMm:restored,applyDisabledDuring:true,outgoingPreviewDelta:after.previewCount-workerState.previewCount,fpsSamples:fps.length,fpsP50:percentile(fps,.5),fpsP95:percentile(fps,.95),longTaskCountDuring:Math.max(0,after.longTaskCount-(idle?.longTaskCount||0))};
  await interactionSnapshot("after-plane-interaction");
}
async function injectStalePreviews(dialog, terminatedWorkerId) {
  if(!interactionEnabled)return;
  const errorsBefore=errors.length;
  const injected=await page.evaluate((oldId)=>{
    const trace=window.__hollowFinishWorkerTrace||[];
    const refs=window.__hollowFinishWorkerInstances||[];
    const currentRecord=[...trace].reverse().find(w=>w.id>oldId&&w.name==="layerling-hollow-finishing"&&w.incoming.some(m=>m.type==="ready"));
    const oldRecord=trace.find(w=>w.id===oldId);
    if(!currentRecord||!refs[oldId]||!refs[currentRecord.id])throw new Error("Finishing worker instance references missing for stale-message injection");
    const oldPreview=[...oldRecord.outgoing].reverse().find(m=>m.type==="preview");
    if(!oldPreview)throw new Error("Canceled worker did not send a preview request");
    refs[oldId].dispatchEvent(new MessageEvent("message",{data:{type:"preview",revision:oldPreview.revision,positions:new Float64Array(0)}}));
    refs[currentRecord.id].dispatchEvent(new MessageEvent("message",{data:{type:"preview",revision:0,positions:new Float64Array(0)}}));
    return {terminatedWorkerId:oldId,currentWorkerId:currentRecord.id,lateRevision:oldPreview.revision,staleRevision:0};
  },terminatedWorkerId);
  await pause(100);
  const apply=dialog.getByRole("button",{name:"Apply",exact:true});
  assert.equal(await apply.isEnabled(),false,"Stale preview message made Apply available");
  assert.equal(await dialog.getByRole("alert").count(),0,"Stale preview message produced a dialog error");
  assert.equal(errors.length,errorsBefore,"Stale preview message produced a page error");
  interaction.staleInjection={...injected,applyDisabledAfter:true,noDialogError:true,noPageError:true};
}
async function sampleAppMemory() {
  if(!app||memorySampling)return;
  memorySampling=true;
  try {
    const processes=await app.evaluate(({app})=>app.getAppMetrics());
    memorySamples.push({at:new Date().toISOString(),processes:processes.map(p=>({pid:p.pid,type:p.type,memory:p.memory}))});
  } catch(error) { memorySamples.push({at:new Date().toISOString(),error:String(error)}); }
  finally { memorySampling=false; }
}
function auditTopology(vertices, faces) {
  const pointKey = p => p.map(v => Object.is(v,-0) ? "0" : String(v)).join(",");
  const welded = new Map(), points = [], remap = vertices.map(p => {
    assert.ok(p.length===3 && p.every(Number.isFinite),"Mesh has non-finite coordinates");
    const k=pointKey(p); let i=welded.get(k);
    if(i===undefined){i=points.length;welded.set(k,i);points.push(p);}
    return i;
  });
  const edges=new Map(), seenFaces=new Set(), fans=new Map();
  let degenerateFaces=0, duplicateFaces=0, signedVolumeMm3=0;
  const addAdj=(vertex,a,b)=>{
    let graph=fans.get(vertex); if(!graph)fans.set(vertex,graph=new Map());
    if(!graph.has(a))graph.set(a,new Set()); if(!graph.has(b))graph.set(b,new Set());
    graph.get(a).add(b); graph.get(b).add(a);
  };
  faces.forEach((face,fi)=>{
    assert.ok(face.length===3 && face.every(i=>Number.isInteger(i)&&i>=0&&i<vertices.length),`Invalid triangle index at ${fi}`);
    const ids=face.map(i=>remap[i]), p=ids.map(i=>points[i]);
    const [a,b,c]=p, u=b.map((x,j)=>x-a[j]), v=c.map((x,j)=>x-a[j]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(ids[0]===ids[1]||ids[1]===ids[2]||ids[2]===ids[0]||Math.hypot(...cross)===0){degenerateFaces++;return;}
    const faceKey=ids.map(String).sort().join("|");
    if(seenFaces.has(faceKey))duplicateFaces++; else seenFaces.add(faceKey);
    signedVolumeMm3+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(const [x,y] of [[0,1],[1,2],[2,0]]){
      const ia=ids[x],ib=ids[y],lo=Math.min(ia,ib),hi=Math.max(ia,ib),key=`${lo}:${hi}`;
      const records=edges.get(key)||[]; records.push({face:fi,direction:ia===lo?1:-1}); edges.set(key,records);
      if(!fans.has(ia))fans.set(ia,new Map()); if(!fans.has(ib))fans.set(ib,new Map());
      if(!fans.get(ia).has(fi))fans.get(ia).set(fi,new Set()); if(!fans.get(ib).has(fi))fans.get(ib).set(fi,new Set());
    }
  });
  let boundaryEdges=0,nonManifoldEdges=0,windingMismatches=0;
  for(const [key,records] of edges){
    if(records.length===1)boundaryEdges++;
    if(records.length!==2){nonManifoldEdges++;continue;}
    if(records[0].direction===records[1].direction)windingMismatches++;
    const [a,b]=key.split(":").map(Number);
    addAdj(a,records[0].face,records[1].face); addAdj(b,records[0].face,records[1].face);
  }
  let nonManifoldVertices=0;
  for(const graph of fans.values()){
    const incident=[...graph.keys()]; if(!incident.length)continue;
    const visited=new Set(), stack=[incident[0]];
    while(stack.length){const f=stack.pop();if(visited.has(f))continue;visited.add(f);stack.push(...(graph.get(f)||[]));}
    if(visited.size!==incident.length)nonManifoldVertices++;
  }
  return {triangles:faces.length,vertices:points.length,boundaryEdges,nonManifoldEdges,windingMismatches,degenerateFaces,duplicateFaces,nonManifoldVertices,signedVolumeMm3};
}
function auditStl(bytes) {
  const g=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),p=g.attributes.position;
  const vertices=Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)]);
  const faces=Array.from({length:p.count/3},(_,i)=>[3*i,3*i+1,3*i+2]);
  const result=auditTopology(vertices,faces); g.dispose(); return result;
}
function audit3mf(bytes) {
  const archive=unzipSync(bytes), modelKey=Object.keys(archive).find(k=>/^3D\/3dmodel\.model$/i.test(k));
  assert.ok(modelKey,"3MF has no 3D model XML");
  const xml=strFromU8(archive[modelKey]); assert.match(xml,/unit="millimeter"/i);
  const vertices=[],faces=[],objects=[]; let meshObjects=0;
  for(const match of xml.matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/gi)){
    const body=match[1], vertexBlock=body.match(/<vertices\b[^>]*>([\s\S]*?)<\/vertices>/i), triangleBlock=body.match(/<triangles\b[^>]*>([\s\S]*?)<\/triangles>/i);
    if(!vertexBlock||!triangleBlock)continue;
    const header=match[0].match(/^<object\b([^>]*)>/i)?.[1]||"", id=header.match(/\bid="([^"]+)"/i)?.[1]||`mesh-${meshObjects+1}`, name=header.match(/\bname="([^"]*)"/i)?.[1]||"";
    const localVertices=[...vertexBlock[1].matchAll(/<vertex\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bz="([^"]+)"[^>]*\/?\s*>/gi)].map(m=>[+m[1],+m[2],+m[3]]);
    const localFaces=[...triangleBlock[1].matchAll(/<triangle\b[^>]*\bv1="(\d+)"[^>]*\bv2="(\d+)"[^>]*\bv3="(\d+)"[^>]*\/?\s*>/gi)].map(m=>[+m[1],+m[2],+m[3]]);
    if(!localFaces.length)continue;
    const objectAudit=auditTopology(localVertices,localFaces); assertStrictMesh(objectAudit,`3MF object ${id}`);
    objects.push({id,name,...objectAudit});
    const base=vertices.length;
    for(const vertex of localVertices)vertices.push(vertex);
    for(const face of localFaces)faces.push(face.map(i=>i+base));
    meshObjects++;
  }
  assert.ok(meshObjects>0,"3MF model has no explicit triangle meshes");
  return {...auditTopology(vertices,faces),meshObjects,objects};
}
function assertStrictMesh(report,label){
  assert.ok(report.triangles>0,`${label} contains no triangles`);
  for(const key of ["boundaryEdges","nonManifoldEdges","windingMismatches","degenerateFaces","duplicateFaces","nonManifoldVertices"])assert.equal(report[key],0,`${label} has ${report[key]} ${key}`);
  assert.ok(report.signedVolumeMm3>0,`${label} has non-positive signed volume`);
}
async function savedProject(decodePositions=true) {
  const saved=await command("save_project",{history:"all"});
  const archive=unzipSync(Buffer.from(saved.base64,"base64"));
  const project=JSON.parse(strFromU8(archive["project.json"]));
  const state=project.states.find((s)=>s.id===project.sceneStateId);
  const node=state.nodes.find((n)=>n.objectId===sourceObject.id);
  assert.ok(node?.importedMesh,"Saved object has no imported mesh");
  let positions;
  const asset=project.assets.find((a)=>a.id===(node.importedMesh.meshAssetId||node.importedMesh.sourceAssetId));
  assert.ok(asset,"Saved mesh asset is missing");
  const bytes=archive[asset.path];
  const meshResourceSha256=createHash("sha256").update(bytes).digest("hex");
  if(node.importedMesh.meshAssetId){
    if(decodePositions){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const count=v.getUint32(8,true);positions=Array.from({length:count},(_,i)=>v.getFloat64(16+i*8,true));}
    return {saved,archive,project,state,node:{...node,importedMesh:decodePositions?{...node.importedMesh,positions}:node.importedMesh},meshAssetSha256:meshResourceSha256,meshResourceSha256};
  }
  if(decodePositions){const g=new STLLoader().parse(bytes.slice().buffer),p=g.attributes.position;positions=Array.from({length:p.count},(_,i)=>[p.getX(i),p.getZ(i),-p.getY(i)]).flat();g.dispose();}
  return {saved,archive,project,state,node:{...node,importedMesh:decodePositions?{...node.importedMesh,positions}:node.importedMesh},meshAssetSha256:null,meshResourceSha256};
}
function fingerprint(project) { assert.ok(project.node?.importedMesh?.positions?.length); return JSON.stringify(project.node.importedMesh.positions); }
function checkpoint(archive, project, label) {
  project.metadata.projectName=label; project.metadata.projectId+=`-${Date.now()}`;
  archive["project.json"]=strToU8(JSON.stringify(project));
  const file=path.join(output,`${label.toLowerCase().replaceAll(" ","-")}.lyl`); writeFileSync(file,zipSync(archive)); return file;
}
async function reopen(file, projectName) {
  await page.locator('input[type="file"][accept*=".lyl"]').first().setInputFiles(file);
  await ready(projectName);
}

try {
  app=await electron.launch({executablePath:executable,cwd:output,timeout:90000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,PATH:process.env.SystemRoot+"\\System32",LAYERLING_DESKTOP_PROFILE:profile,LAYERLING_DESKTOP_TEST:"1"}});
  page=await app.firstWindow();
  appVersion=await app.evaluate(({app})=>app.getVersion());
  assert.equal(appVersion,expectedAppVersion,"Packaged app version did not match LAYERLING_EXPECTED_APP_VERSION exactly");
  assert.ok(/\.(?:8|9|10)$/.test(appVersion),`Expected packaged .8, .9 or .10 build, got ${appVersion}`);
  page.setDefaultTimeout(30000); page.on("pageerror",e=>errors.push(e.message)); page.on("request",r=>requests.push(r.url()));
  if(renderInstrumentationEnabled)await page.evaluate(()=>{window.__layerlingGeometryDiagnostics=true});
  await page.evaluate(()=>{
    const NativeWorker=window.Worker, records=[],instances=[];
    class ObservedWorker extends NativeWorker {
      constructor(url,options){
        super(url,options);
        const record={id:records.length,url:String(url),name:options?.name||null,createdAt:performance.now(),outgoing:[],incoming:[],terminateCalls:[]};
        this.__finishRecord=record; records.push(record); instances[record.id]=this;
        this.addEventListener("message",event=>{
          const d=event.data||{};
          record.incoming.push({at:performance.now(),type:d.type,revision:d.revision,message:d.message,error:d.error,stats:d.stats,timings:d.timings,requestMs:d.requestMs,audit:d.audit,surface:d.surface,encodedSurface:d.encodedSurface,surfaceCompletion:d.surfaceCompletion});
        });
        this.addEventListener("error",event=>record.incoming.push({at:performance.now(),type:"error-event",message:event.message}));
      }
      postMessage(message,...transfer){
        this.__finishRecord?.outgoing.push({at:performance.now(),type:message?.type,revision:message?.revision});
        return super.postMessage(message,...transfer);
      }
      terminate(){
        this.__finishRecord?.terminateCalls.push({at:performance.now()});
        return super.terminate();
      }
    }
    Object.defineProperty(window,"Worker",{configurable:true,writable:true,value:ObservedWorker});
    window.__hollowFinishWorkerTrace=records;
    window.__hollowFinishWorkerInstances=instances;
  });
  await sampleAppMemory();
  memoryTimer=setInterval(()=>{void sampleAppMemory();},1000);
  await page.getByRole("button",{name:"Create new 3D design",exact:true}).waitFor({timeout:90000});
  connection=JSON.parse(readFileSync(path.join(profile,"connection.json"),"utf8"));
  assert.equal(await page.evaluate(async()=>{try{await fetch("https://example.com");return false;}catch{return true;}}),true,"External network access was not blocked");
  let fixture;
  if(fixtureOverride && fixtureOverride.toLowerCase().endsWith(".lyl")) {
    const fixtureProject=JSON.parse(strFromU8(unzipSync(readFileSync(fixtureOverride))["project.json"]));
    const expectedProjectName=fixtureProject.metadata?.projectName;
    assert.ok(typeof expectedProjectName==="string"&&expectedProjectName.length,`LYL fixture has no projectName metadata: ${fixtureOverride}`);
    await page.locator('input[type="file"][accept*=".lyl"]').first().setInputFiles(fixtureOverride);
    await ready(expectedProjectName);
  } else {
    await page.getByRole("button",{name:"Create new 3D design",exact:true}).click(); await ready();
    if(fixtureOverride) fixture=fixtureOverride;
    else { fixture=path.join(output,"closed-hollow-cylinder.stl"); writeFileSync(fixture,hollowCylinderStl()); }
    assert.ok(fixture.toLowerCase().endsWith(".stl"),"LAYERLING_FINISH_FIXTURE must be an STL or LYL file");
    await page.locator('input[type="file"][accept*=".stl"]').first().setInputFiles(fixture);
    await ready(path.basename(fixture).replace(/\.[^.]+$/,""));
  }
  for(let i=0;i<150;i++){
    const objects=(await command("list_objects")).objects;
    sourceObject=fixtureOverride ? objects.filter(o=>o.importedTriangles>0).sort((a,b)=>b.importedTriangles-a.importedTriangles)[0] : objects.find(o=>o.name?.includes("hollow-cylinder"));
    if(sourceObject)break; await pause(100);
  }
  assert.ok(sourceObject,"No imported mesh was found in the selected fixture");
  await command("select_objects",{ids:[sourceObject.id]});
  const original=await savedProject(!stressOnly), originalFingerprint=stressOnly?original.meshResourceSha256:fingerprint(original);
  if(stressOnly){assert.ok(originalFingerprint,"Stress-only source mesh asset is missing");interaction.sourceMeshResourceSha256=originalFingerprint;}
  if(!stressOnly){
  await page.getByRole("button",{name:"Open Hollow Base",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Open Hollow Base"}); await dialog.waitFor();
  await waitPreviewReady(dialog);
  await dialog.getByLabel("Cutting axis").selectOption("1");
  await dialog.getByLabel("Retained side").selectOption("positive");
  await dialog.getByLabel("Cut position (mm)").fill(String(cutPosition));
  await dialog.getByRole("button",{name:"Preview",exact:true}).click();
  await dialog.getByRole("button",{name:"Cancel preview",exact:true}).click();
  await waitPreviewReady(dialog);
  const cancelTrace=await page.evaluate(()=>window.__hollowFinishWorkerTrace);
  const canceledWorker=cancelTrace.find(w=>w.name==="layerling-hollow-finishing"&&w.outgoing.some(m=>m.type==="preview")&&w.terminateCalls.length>0);
  assert.ok(canceledWorker,"Cancel preview did not terminate the active finishing worker");
  assert.ok(cancelTrace.some(w=>w.id>canceledWorker.id&&w.name==="layerling-hollow-finishing"&&w.incoming.some(m=>m.type==="ready")),"Cancel preview did not initialize a replacement finishing worker");
  const cancelApply=dialog.getByRole("button",{name:"Apply",exact:true});
  await cancelApply.waitFor({state:"visible"});
  assert.equal(await cancelApply.isEnabled(),false,"Canceled preview remained applicable");
  await injectStalePreviews(dialog,canceledWorker.id);
  assert.equal(fingerprint(await savedProject()),originalFingerprint,"Canceled preview changed source mesh");
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click(); await dialog.waitFor({state:"detached"});
  assert.equal(fingerprint(await savedProject()),originalFingerprint,"Cancel changed the source mesh");
  pass("Cancel discards preview and leaves source mesh intact");
  }
  await page.getByRole("button",{name:"Open Hollow Base",exact:true}).click();
  const applyDialog=page.getByRole("dialog",{name:"Open Hollow Base"}); await applyDialog.waitFor();
  await waitPreviewReady(applyDialog);
  await installInteractionMonitor();
  await applyDialog.getByLabel("Cutting axis").selectOption("1");
  await applyDialog.getByLabel("Retained side").selectOption("positive");
  await applyDialog.getByLabel("Cut position (mm)").fill(String(cutPosition));
  await runPlaneInteraction(applyDialog);
  if(renderInstrumentationEnabled)await interactionSnapshot("before-first-preview");
  if(stressOnly){
    await applyDialog.getByRole("button",{name:"Preview",exact:true}).click();
    await applyDialog.getByRole("button",{name:"Cancel preview",exact:true}).click();
    await waitPreviewReady(applyDialog);
    const trace=await page.evaluate(()=>window.__hollowFinishWorkerTrace||[]);
    const canceled=trace.filter(w=>w.name==="layerling-hollow-finishing"&&w.outgoing.some(m=>m.type==="preview")&&w.terminateCalls.length>0).at(-1);
    assert.ok(canceled,"Stress preview cancellation did not terminate its worker");
    assert.ok(trace.some(w=>w.id>canceled.id&&w.name==="layerling-hollow-finishing"&&w.incoming.some(m=>m.type==="ready")),"Stress preview cancellation did not initialize a replacement worker");
    await injectStalePreviews(applyDialog,canceled.id);
    const afterPreviewCancel=await savedProject(false);
    assert.equal(afterPreviewCancel.meshResourceSha256,originalFingerprint,"Canceled stress preview changed the source mesh");
    assert.equal(afterPreviewCancel.node.objectId,sourceObject.id,"Canceled stress preview changed source object identity");
    await applyDialog.getByRole("button",{name:"Cancel",exact:true}).click(); await applyDialog.waitFor({state:"detached"});
    const afterFullCancel=await savedProject(false);
    assert.equal(afterFullCancel.meshResourceSha256,originalFingerprint,"Full stress dialog cancel changed the source mesh");
    assert.equal(afterFullCancel.node.objectId,sourceObject.id,"Full stress dialog cancel changed source object identity");
    pass("Stress-only interaction, immediate preview cancel, replacement readiness, stale reply guards, and full cancel passed",{sourceRetained:true,sourceMeshResourceSha256:originalFingerprint,manufacturingReadiness:"not measured"});
  } else {
  await applyDialog.getByRole("button",{name:"Preview",exact:true}).click();
  await waitFinishingPreview(applyDialog);
  if(renderInstrumentationEnabled){
    await pause(100);
    interaction.firstValidPreview=await interactionSnapshot("first-valid-preview");
  }
  await applyDialog.getByRole("button",{name:"Preview",exact:true}).click();
  await waitFinishingPreview(applyDialog);
  if(renderInstrumentationEnabled){
    await pause(100);
    interaction.identicalCachedPreview=await interactionSnapshot("identical-cached-preview");
    const first=interaction.snapshots["first-valid-preview"],cached=interaction.snapshots["identical-cached-preview"];
    const uploadDelta=(cached?.bufferUploadCalls||0)-(first?.bufferUploadCalls||0);
    interaction.cachedUploadDeltaCalls=uploadDelta;
    if(/\.(?:9|10)$/.test(appVersion))assert.equal(uploadDelta,0,"Identical cached preview issued additional WebGL buffer uploads");
  }
  assert.match(await applyDialog.innerText(),/\(cached\)/,"Second identical preview did not report a cache hit");
  let finishingTrace=await page.evaluate(()=>window.__hollowFinishWorkerTrace);
  assert.ok(finishingTrace.some(w=>w.name==="layerling-hollow-finishing"&&w.incoming.some(m=>m.type==="preview"&&m.stats?.cacheHit===true)),"Finishing worker did not report stats.cacheHit=true for repeated preview");
  await runRepeatedCachedPreviewProbe(applyDialog,original.meshResourceSha256);
  const positionInput=applyDialog.getByLabel("Cut position (mm)");
  await positionInput.fill(String(cutPosition+0.2));
  const applyButton=applyDialog.getByRole("button",{name:"Apply",exact:true});
  await page.waitForFunction(()=>{
    const b=[...(document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]')?.querySelectorAll("button")||[])].find(x=>x.textContent?.trim()==="Apply");
    return b?.disabled===true;
  },null,{timeout:10000});
  assert.equal(await applyButton.isEnabled(),false,"Changing cut position left stale preview applicable");
  await positionInput.fill(String(cutPosition));
  await page.waitForFunction(()=>{
    const b=[...(document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]')?.querySelectorAll("button")||[])].find(x=>x.textContent?.trim()==="Apply");
    return b?.disabled===true;
  },null,{timeout:10000});
  assert.equal(await applyButton.isEnabled(),false,"Restoring cut position incorrectly reused a stale applicable preview");
  await applyDialog.getByRole("button",{name:"Preview",exact:true}).click();
  await waitFinishingPreview(applyDialog);
  assert.match(await applyDialog.innerText(),/\(cached\)/,"Restored cut position did not reuse its cached preview");
  await page.screenshot({path:path.join(output,"hollow-finishing-preview.png"),fullPage:true});
  await applyDialog.getByRole("button",{name:"Apply",exact:true}).click(); await applyDialog.waitFor({state:"detached"});
  const applied=await savedProject(), appliedFingerprint=fingerprint(applied);
  appliedMeshAssetSha256=applied.meshAssetSha256;
  assert.ok(appliedMeshAssetSha256,"Applied result did not save a Float64 mesh asset for SHA256 comparison");
  interaction.appliedMeshAssetSha256=appliedMeshAssetSha256;
  assert.notEqual(appliedFingerprint,originalFingerprint,"Apply did not change mesh positions");
  assert.equal(applied.node.objectId,sourceObject.id,"Apply changed object identity");
  pass("Plane cut preview applies to the same object",{id:sourceObject.id,axis:"local Y",positionMm:cutPosition,retainedSide:"positive",triangles:applied.node.importedMesh.triangleCount});
  for(let cycle=0;cycle<3;cycle++){
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    assert.equal(fingerprint(await savedProject()),originalFingerprint,`Undo ${cycle+1} did not restore source`);
    await page.getByRole("button",{name:"Redo",exact:true}).click();
    assert.equal(fingerprint(await savedProject()),appliedFingerprint,`Redo ${cycle+1} did not restore result`);
  }
  pass("Three Undo/Redo cycles restore exact source and result positions");
  const finalFile=checkpoint(applied.archive,applied.project,"Hollow finishing applied");
  await reopen(finalFile,"Hollow finishing applied");
  const reopened=await savedProject(); assert.equal(fingerprint(reopened),appliedFingerprint,"LYL reopen changed mesh positions");
  assert.equal(reopened.node.objectId,sourceObject.id,"LYL reopen changed object identity");
  pass("Distinct-project LYL save and reopen preserve finished mesh and identity");
  await command("select_objects",{ids:[sourceObject.id]});
  await page.keyboard.press("Control+e");
  const studio=page.getByRole("region",{name:"Precision Mesh Studio"}); await studio.waitFor();
  await studio.getByRole("button",{name:"Generate export preview",exact:true}).click();
  await page.waitForFunction(()=>{
    const section=document.querySelector('section[aria-label="Precision Mesh Studio"]');
    const button=[...(section?.querySelectorAll("button")||[])].find(b=>b.textContent?.trim()==="Generate export preview");
    return button&&!button.disabled&&document.querySelector(".precision-results");
  },null,{timeout:180000});
  const precisionAlert=studio.getByRole("alert");
  if(await precisionAlert.count())throw Error(`Precision Mesh Studio rejected finished mesh: ${await precisionAlert.innerText()}`);
  const precisionReady=await page.locator(".precision-results").getAttribute("data-ready");
  if(expectThinWarning){
    assert.equal(precisionReady,"false","Thin-wall mode must retain the manufacturing warning and must not claim print-ready");
    const thicknessWarning=studio.getByText(/Sampled normal-ray thickness .* below .* mm/i);
    await thicknessWarning.waitFor({state:"visible",timeout:180000});
    pass("Precision Mesh Studio retains sampled-thickness warning; geometry checks continue without marking print-ready",{warning:await thicknessWarning.innerText(),dataReady:precisionReady});
  } else {
    assert.equal(precisionReady,"true","Precision Mesh Studio did not validate the finished mesh");
    pass("Precision Mesh Studio preview marks the finished mesh ready");
  }
  await page.screenshot({path:path.join(output,"hollow-finishing-precision.png"),fullPage:true});
  // `export_mesh` is the MCP bridge action used by packaged validators; there is no `export_file` action.
  for(const format of ["stl","3mf"]){
    const exported=await command("export_mesh",{format,ids:[sourceObject.id]});
    assert.ok(exported.base64,`${format} export returned no bytes`);
    const bytes=Buffer.from(exported.base64,"base64");
    writeFileSync(path.join(output,`hollow-finished.${format}`),bytes);
    if(format==="stl"){
      exportAudits[format]=auditStl(bytes);
      assertStrictMesh(exportAudits[format],"Exported STL");
      const imported=await command("import_file",{fileName:`hollow-finished-reimport.${format}`,base64:exported.base64});
      assert.ok(imported.imported?.length,"STL reimport returned no objects");
    } else {
      assert.ok(bytes.byteLength>100,"Exported 3MF is unexpectedly small");
      exportAudits[format]=audit3mf(bytes);
      assertStrictMesh(exportAudits[format],"Exported 3MF");
      const imported=await command("import_file",{fileName:`hollow-finished-reimport.${format}`,base64:exported.base64});
      assert.ok(imported.imported?.length,"3MF reimport returned no objects");
    }
    pass(`${format.toUpperCase()} export passes exact-weld topology audit and independent editor reimport`,{bytes:bytes.byteLength,...exportAudits[format]});
  }
  writeFileSync(path.join(output,"mesh-audits.json"),JSON.stringify(exportAudits,null,2));
  }
  assert.deepEqual(errors,[]);
  pass("Packaged app launched with restricted PATH and external network blocked",{externalRequests:requests.filter(u=>/^https?:/i.test(u)&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u)).length});
} catch(error){errors.push(error.stack||String(error));console.error(error);if(page)await page.screenshot({path:path.join(output,"failure.png"),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{
  if(memoryTimer)clearInterval(memoryTimer);
  while(memorySampling)await pause(25);
  await sampleAppMemory();
  if(page)workerTrace=await page.evaluate(()=>window.__hollowFinishWorkerTrace||[]).catch(()=>[]);
  if(renderInstrumentationEnabled&&page){
    try{
      interaction.appVersion=appVersion;
      interaction.fixture=fixtureOverride||"synthetic closed hollow cylinder";
      interaction.cutPositionMm=cutPosition;
      await interactionSnapshot("before-app-close");
      const finalSnapshot=interaction.snapshots["before-app-close"];
      interaction.contextLossEvents=finalSnapshot?.contextEvents||[];
      interaction.renderingStateAtClose=finalSnapshot?{canvas:finalSnapshot.canvas,drawCalls:finalSnapshot.drawCalls,drawCallCPUms:finalSnapshot.drawCallCPUms,bufferUploadCalls:finalSnapshot.bufferUploadCalls,bufferUploadCPUms:finalSnapshot.bufferUploadCPUms,longTaskCount:finalSnapshot.longTaskCount,longTaskTotalMs:finalSnapshot.longTaskTotalMs}:null;
    }catch(error){interaction.captureError=String(error)}
  }
  const memoryValues=memorySamples.flatMap(s=>s.processes||[]).map(p=>p.memory||{});
  const peakMemory={
    peakWorkingSetSizeKiB:Math.max(0,...memoryValues.map(m=>m.peakWorkingSetSize||0)),
    maxObservedWorkingSetSizeKiB:Math.max(0,...memoryValues.map(m=>m.workingSetSize||0)),
    maxPrivateBytes:Math.max(0,...memoryValues.map(m=>m.privateBytes||0)),
  };
  writeFileSync(path.join(output,"mesh-audits.json"),JSON.stringify(exportAudits,null,2));
  if(renderInstrumentationEnabled)writeFileSync(path.join(output,"interaction.json"),JSON.stringify(interaction,null,2));
  writeFileSync(path.join(output,"measurements.json"),JSON.stringify({appVersion,stressOnly,repeatPreviewCount,fixture:fixtureOverride||"synthetic closed hollow cylinder",cutPositionMm:cutPosition,expectThinWarning,memorySource:"Electron app.getAppMetrics",peakMemory,memorySamples,workers:workerTrace,interaction:renderInstrumentationEnabled?interaction:undefined,resourceProbe:repeatedPreviewProbe||undefined,appliedMeshAssetSha256},null,2));
  writeFileSync(path.join(output,"results.json"),JSON.stringify({executable,appVersion,stressOnly,repeatPreviewCount,profile,checks,errors,exportAudits,peakMemory,resourceProbe:repeatedPreviewProbe||undefined,appliedMeshAssetSha256},null,2));
  if(app){
    await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.webContents.on("will-prevent-unload",event=>event.preventDefault());}).catch(()=>{});
    await app.close().catch(()=>{});
  }
  if(errors.length)process.exitCode=1;
}
