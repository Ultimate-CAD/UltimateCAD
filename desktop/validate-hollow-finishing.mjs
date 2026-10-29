import { _electron as electron } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const executable = path.resolve(process.argv.slice(2).find((s) => s.endsWith(".exe")) || "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe");
const output = path.resolve(process.env.LAYERLING_HOLLOW_FINISHING_VALIDATION_DIR || "dist/ultimate/windows/hollow-finishing-validation");
const fixtureOverride = process.env.LAYERLING_FINISH_FIXTURE ? path.resolve(process.env.LAYERLING_FINISH_FIXTURE) : null;
const cutPosition = Number(process.env.LAYERLING_FINISH_POSITION ?? 3.1);
assert.ok(Number.isFinite(cutPosition), "LAYERLING_FINISH_POSITION must be a finite number");
const profile = path.join(output, `isolated-profile-${Date.now()}`);
mkdirSync(output, { recursive: true });
const checks = [], errors = [], requests = [];
let app, page, connection, editorId, sourceObject, exportAudits = {};
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
  });
  assert.match(await dialog.innerText(),/Ready/);
  await dialog.getByRole("button",{name:"Preview",exact:true}).waitFor({state:"visible"});
  assert.equal(await dialog.getByRole("button",{name:"Preview",exact:true}).isEnabled(),true);
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
    const base=vertices.length; vertices.push(...localVertices); faces.push(...localFaces.map(f=>f.map(i=>i+base))); meshObjects++;
  }
  assert.ok(meshObjects>0,"3MF model has no explicit triangle meshes");
  return {...auditTopology(vertices,faces),meshObjects,objects};
}
function assertStrictMesh(report,label){
  assert.ok(report.triangles>0,`${label} contains no triangles`);
  for(const key of ["boundaryEdges","nonManifoldEdges","windingMismatches","degenerateFaces","duplicateFaces","nonManifoldVertices"])assert.equal(report[key],0,`${label} has ${report[key]} ${key}`);
  assert.ok(report.signedVolumeMm3>0,`${label} has non-positive signed volume`);
}
async function savedProject() {
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
  if(node.importedMesh.meshAssetId){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const count=v.getUint32(8,true);positions=Array.from({length:count},(_,i)=>v.getFloat64(16+i*8,true));}
  else {const g=new STLLoader().parse(bytes.slice().buffer),p=g.attributes.position;positions=Array.from({length:p.count},(_,i)=>[p.getX(i),p.getZ(i),-p.getY(i)]).flat();g.dispose();}
  return {saved,archive,project,state,node:{...node,importedMesh:{...node.importedMesh,positions}}};
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
  const appVersion=await app.evaluate(({app})=>app.getVersion());
  assert.equal(appVersion,process.env.LAYERLING_EXPECTED_APP_VERSION||appVersion);
  assert.ok(appVersion.endsWith(".8"),`Expected packaged .8 build, got ${appVersion}`);
  page.setDefaultTimeout(30000); page.on("pageerror",e=>errors.push(e.message)); page.on("request",r=>requests.push(r.url()));
  await page.getByRole("button",{name:"Create new 3D design",exact:true}).waitFor({timeout:90000});
  connection=JSON.parse(readFileSync(path.join(profile,"connection.json"),"utf8"));
  assert.equal(await page.evaluate(async()=>{try{await fetch("https://example.com");return false;}catch{return true;}}),true,"External network access was not blocked");
  let fixture;
  if(fixtureOverride && fixtureOverride.toLowerCase().endsWith(".lyl")) {
    await page.locator('input[type="file"][accept*=".lyl"]').first().setInputFiles(fixtureOverride);
    await ready();
  } else {
    await page.getByRole("button",{name:"Create new 3D design",exact:true}).click(); await ready();
    if(fixtureOverride) fixture=fixtureOverride;
    else { fixture=path.join(output,"closed-hollow-cylinder.stl"); writeFileSync(fixture,hollowCylinderStl()); }
    assert.ok(fixture.toLowerCase().endsWith(".stl"),"LAYERLING_FINISH_FIXTURE must be an STL or LYL file");
    await page.locator('input[type="file"][accept*=".stl"]').first().setInputFiles(fixture);
    await ready(fixtureOverride ? undefined : "closed-hollow-cylinder");
  }
  for(let i=0;i<150;i++){
    const objects=(await command("list_objects")).objects;
    sourceObject=fixtureOverride ? objects.filter(o=>o.importedTriangles>0).sort((a,b)=>b.importedTriangles-a.importedTriangles)[0] : objects.find(o=>o.name?.includes("hollow-cylinder"));
    if(sourceObject)break; await pause(100);
  }
  assert.ok(sourceObject,"No imported mesh was found in the selected fixture");
  await command("select_objects",{ids:[sourceObject.id]});
  const original=await savedProject(), originalFingerprint=fingerprint(original);
  await page.getByRole("button",{name:"Open Hollow Base",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Open Hollow Base"}); await dialog.waitFor();
  await waitPreviewReady(dialog);
  await dialog.getByLabel("Cutting axis").selectOption("1");
  await dialog.getByLabel("Retained side").selectOption("positive");
  await dialog.getByLabel("Cut position (mm)").fill(String(cutPosition));
  await dialog.getByRole("button",{name:"Preview",exact:true}).click();
  await dialog.getByRole("button",{name:"Cancel preview",exact:true}).click();
  await waitPreviewReady(dialog);
  const cancelApply=dialog.getByRole("button",{name:"Apply",exact:true});
  await cancelApply.waitFor({state:"visible"});
  assert.equal(await cancelApply.isEnabled(),false,"Canceled preview remained applicable");
  assert.equal(fingerprint(await savedProject()),originalFingerprint,"Canceled preview changed source mesh");
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click(); await dialog.waitFor({state:"detached"});
  assert.equal(fingerprint(await savedProject()),originalFingerprint,"Cancel changed the source mesh");
  pass("Cancel discards preview and leaves source mesh intact");
  await page.getByRole("button",{name:"Open Hollow Base",exact:true}).click();
  const applyDialog=page.getByRole("dialog",{name:"Open Hollow Base"}); await applyDialog.waitFor();
  await waitPreviewReady(applyDialog);
  await applyDialog.getByLabel("Cutting axis").selectOption("1");
  await applyDialog.getByLabel("Retained side").selectOption("positive");
  await applyDialog.getByLabel("Cut position (mm)").fill(String(cutPosition));
  await applyDialog.getByRole("button",{name:"Preview",exact:true}).click();
  await page.waitForFunction(()=>{const d=document.querySelector('[role="dialog"][aria-label="Open Hollow Base"]');return d?.querySelector('[role="alert"]')||[...(d?.querySelectorAll('button')||[])].some(b=>b.textContent?.trim()==="Apply"&&!b.disabled);});
  assert.equal(await applyDialog.getByRole("alert").count(),0,await applyDialog.innerText());
  assert.equal(await applyDialog.getByRole("button",{name:"Apply",exact:true}).isEnabled(),true);
  await page.screenshot({path:path.join(output,"hollow-finishing-preview.png"),fullPage:true});
  await applyDialog.getByRole("button",{name:"Apply",exact:true}).click(); await applyDialog.waitFor({state:"detached"});
  const applied=await savedProject(), appliedFingerprint=fingerprint(applied);
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
  assert.equal(precisionReady,"true","Precision Mesh Studio did not validate the finished mesh");
  await page.screenshot({path:path.join(output,"hollow-finishing-precision.png"),fullPage:true});
  pass("Precision Mesh Studio preview marks the finished mesh ready");
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
      assert.ok(imported.objects?.length,"STL reimport returned no objects");
    } else {
      assert.ok(bytes.byteLength>100,"Exported 3MF is unexpectedly small");
      exportAudits[format]=audit3mf(bytes);
      assertStrictMesh(exportAudits[format],"Exported 3MF");
      const imported=await command("import_file",{fileName:`hollow-finished-reimport.${format}`,base64:exported.base64});
      assert.ok(imported.objects?.length,"3MF reimport returned no objects");
    }
    pass(`${format.toUpperCase()} export passes exact-weld topology audit and independent editor reimport`,{bytes:bytes.byteLength,...exportAudits[format]});
  }
  writeFileSync(path.join(output,"mesh-audits.json"),JSON.stringify(exportAudits,null,2));
  assert.deepEqual(errors,[]);
  pass("Packaged app launched with restricted PATH and external network blocked",{externalRequests:requests.filter(u=>/^https?:/i.test(u)&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u)).length});
} catch(error){errors.push(error.stack||String(error));console.error(error);if(page)await page.screenshot({path:path.join(output,"failure.png"),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{writeFileSync(path.join(output,"mesh-audits.json"),JSON.stringify(exportAudits,null,2));writeFileSync(path.join(output,"results.json"),JSON.stringify({executable,profile,checks,errors,exportAudits},null,2));if(app)await app.close().catch(()=>{});}
