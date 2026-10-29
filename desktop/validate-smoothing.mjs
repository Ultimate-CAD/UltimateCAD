import { _electron as electron } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const executable = path.resolve(process.argv.slice(2).find((s) => s.endsWith(".exe")) || "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe");
const output = path.resolve(process.env.LAYERLING_SMOOTHING_VALIDATION_DIR || "dist/ultimate/windows/smoothing-validation");
const profile = path.join(output, `isolated-profile-${Date.now()}`);
mkdirSync(output, { recursive: true });
const checks = [], errors = [], requests = [];
let app, page, connection, editorId;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (name, detail) => { checks.push({ name, detail }); console.log("PASS", name, detail ?? ""); };

function collarStl(segments = 48, rows = 21) {
  const facets = [];
  const vertices = [];
  const faces = [];
  for (let y = 0; y < rows; y++) {
    for (let j = 0; j < segments; j++) {
      const angle = j * 2 * Math.PI / segments;
      const radius = 10 + 2 * Math.exp(-(((y - 10) / 1.2) ** 2)) + Math.max(0, 4 - y) * 0.4;
      vertices.push([radius * Math.cos(angle), y, radius * Math.sin(angle)]);
    }
  }
  for (let y = 0; y < rows - 1; y++) {
    for (let j = 0; j < segments; j++) {
      const a = y * segments + j;
      const b = y * segments + ((j + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      faces.push([a, c, b], [b, c, d]);
    }
  }
  vertices.push([0, 0, 0], [0, rows - 1, 0]);
  const bottomCenter = vertices.length - 2;
  const topCenter = vertices.length - 1;
  for (let j = 0; j < segments; j++) {
    const next = (j + 1) % segments;
    faces.push([bottomCenter, j, next], [topCenter, (rows - 1) * segments + next, (rows - 1) * segments + j]);
  }
  const toStl = ([x, y, z]) => [x, -z, y];
  const tri = ([ia, ib, ic]) => {
    const a = toStl(vertices[ia]);
    const b = toStl(vertices[ib]);
    const c = toStl(vertices[ic]);
    const u = b.map((v, i) => v - a[i]), v = c.map((x, i) => x - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const d = Math.hypot(...n) || 1;
    facets.push(` facet normal ${n.map((x) => x / d).join(" ")}\n  outer loop\n   vertex ${a.join(" ")}\n   vertex ${b.join(" ")}\n   vertex ${c.join(" ")}\n  endloop\n endfacet`);
  };
  for (const face of faces) tri(face);
  return `solid smoothing-collar\n${facets.join("\n")}\nendsolid smoothing-collar\n`;
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
    const editor = json.editors?.filter((e) => Date.now() - e.lastSeen < 10000 && (!projectName || e.projectName === projectName)).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (editor) { editorId = editor.editorId; return editor; }
    await pause(200);
  }
  throw Error("Editor did not register with MCP");
}
async function objectById(id) {
  return (await command("list_objects")).objects.find((object) => object.id === id);
}
async function waitForObject(id, predicate, label) {
  for (let i = 0; i < 150; i++) { const object = await objectById(id); if (object && predicate(object)) return object; await pause(100); }
  throw Error(`Object ${id} did not reach ${label}`);
}
async function savedProject() {
  const saved = await command("save_project", { history: "all" });
  const archive = unzipSync(Buffer.from(saved.base64, "base64"));
  const project = JSON.parse(strFromU8(archive["project.json"]));
  const state = project.states.find((candidate) => candidate.id === project.sceneStateId);
  const stored = state.nodes.find((candidate) => candidate.objectId === sourceObject.id);
  const asset = project.assets.find(a => a.id === (stored?.importedMesh?.meshAssetId || stored?.importedMesh?.sourceAssetId));
  assert.ok(asset, 'Saved mesh asset is missing');
  const bytes = archive[asset.path];let positions;
  if(stored.importedMesh.meshAssetId){
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(8, true);positions = Array.from({length:count},(_,i)=>view.getFloat64(16+i*8,true));
  } else {
    const geometry=new STLLoader().parse(bytes.slice().buffer),p=geometry.attributes.position;
    const points=Array.from({length:p.count},(_,i)=>[p.getX(i),p.getZ(i),-p.getY(i)]);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const p of points)p.forEach((v,j)=>{min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);});
    positions=points.flatMap(p=>p.map((v,j)=>v-(j===1?min[j]:(min[j]+max[j])/2)));geometry.dispose();
  }
  const node = {...stored, importedMesh:{...stored.importedMesh,positions}};
  return { saved, archive, project, state, node };
}
function sourceFingerprint(node) {
  assert.ok(node?.importedMesh?.positions?.length, "Saved object has no imported mesh source positions");
  return JSON.stringify(node.importedMesh.positions);
}
function checkpoint(archive, project, fileName, suffix) {
  project.metadata.projectName = `Smoothing ${suffix} checkpoint`;
  project.metadata.projectId += `-${suffix}-${Date.now()}`;
  archive["project.json"] = strToU8(JSON.stringify(project));
  const file = path.join(output, fileName);
  writeFileSync(file, zipSync(archive));
  return file;
}
async function reopen(file, projectName) {
  await page.locator('input[type="file"][accept*=".lyl"]').first().setInputFiles(file);
  const editor = await ready(projectName);
  return editor;
}

let sourceObject;
try {
  app = await electron.launch({ executablePath: executable, cwd: output, timeout: 90000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PATH: process.env.SystemRoot + "\\System32", LAYERLING_DESKTOP_PROFILE: profile, LAYERLING_DESKTOP_TEST: "1" } });
  page = await app.firstWindow();
  if(process.env.LAYERLING_EXPECTED_APP_VERSION)assert.equal(await app.evaluate(({app})=>app.getVersion()),process.env.LAYERLING_EXPECTED_APP_VERSION);
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor({ timeout: 90000 });
  connection = JSON.parse(readFileSync(path.join(profile, "connection.json"), "utf8"));
  const restricted = await page.evaluate(async () => { try { await fetch("https://example.com"); return false; } catch { return true; } });
  assert.equal(restricted, true, "External network access was not blocked");
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).click();
  await ready();
  const fixture = path.join(output, "deterministic-collar.stl");
  writeFileSync(fixture, collarStl());
  await page.locator('input[type="file"][accept*=".stl"]').first().setInputFiles(fixture);
  await ready("deterministic-collar");
  for (let i = 0; i < 120; i++) {
    sourceObject = (await command("list_objects")).objects.find((object) => object.importedTriangles === 2016);
    if (sourceObject) break;
    await pause(100);
  }
  assert.ok(sourceObject, "Generated collar STL did not import as 2016 triangles");
  await command("select_objects", { ids: [sourceObject.id] });
  const beforeCancel = await savedProject();
  const initialSource = sourceFingerprint(beforeCancel.node);
  await page.getByRole("button", { name: "Smooth Mesh", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Smooth Mesh" });
  await dialog.waitFor();
  const canvas = dialog.locator("canvas");
  await canvas.waitFor();
  await page.waitForFunction(() => { const d = document.querySelector('[role="dialog"][aria-label="Smooth Mesh"]'); const b = [...(d?.querySelectorAll('button') ?? [])].find((x) => x.textContent?.trim() === 'Preview'); return b && !b.disabled; });
  await dialog.getByLabel("Brush radius").fill("5");
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 100 && box.height > 100, "Smoothing viewport did not render");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(() => { const d = document.querySelector('[role="dialog"][aria-label="Smooth Mesh"]'); const b = [...(d?.querySelectorAll('button') ?? [])].find((x) => x.textContent?.includes('Apply smoothing')); return (d?.querySelector('[role="alert"]')?.textContent?.trim()) || (b && !b.disabled); });
  assert.equal(await dialog.getByRole("alert").count(), 0, await dialog.innerText());
  assert.equal(await dialog.getByRole("button", { name: "Apply smoothing", exact: true }).isEnabled(), true);
  const previewText = await dialog.innerText();
  await page.screenshot({ path: path.join(output, "smoothing-preview.png"), fullPage: true });
  await dialog.getByLabel('Subtract selection').check();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.up();await pause(300);
  await dialog.getByRole('button',{name:'Preview',exact:true}).click();
  await dialog.getByRole('button',{name:'Apply smoothing',exact:true}).waitFor();
  await page.waitForFunction(()=>{const d=document.querySelector('[aria-label="Smooth Mesh"]');return d?.querySelector('[role="alert"]')||[...d.querySelectorAll('button')].some(b=>b.textContent==='Apply smoothing'&&!b.disabled);});
  assert.equal(await dialog.getByRole('alert').count(),0,await dialog.innerText());
  assert.notEqual(await dialog.innerText(),previewText,'Subtract did not change the smoothing measurement');
  await dialog.getByLabel('Subtract selection').uncheck();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down({button:'right'});await page.mouse.move(box.x+box.width/2+110,box.y+box.height/2,{steps:10});await page.mouse.up({button:'right'});
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.up();await pause(300);
  await dialog.getByRole('button',{name:'Preview',exact:true}).click();
  await page.waitForFunction(()=>{const d=document.querySelector('[aria-label="Smooth Mesh"]');return d?.querySelector('[role="alert"]')||[...d.querySelectorAll('button')].some(b=>b.textContent==='Apply smoothing'&&!b.disabled);});
  assert.equal(await dialog.getByRole('alert').count(),0,await dialog.innerText());
  let smoothingWorker;
  for(const candidate of page.workers())if(await candidate.evaluate(()=>self.name).catch(()=>null)==='layerling-local-smoothing')smoothingWorker=candidate;
  assert.ok(smoothingWorker,'Smoothing worker was not isolated');
  const workerClosed=new Promise(resolve=>smoothingWorker.on('close',resolve));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await Promise.race([workerClosed,pause(5000).then(()=>{throw Error('Cancel did not terminate smoothing worker');})]);
  await page.getByRole("dialog", { name: "Smooth Mesh" }).waitFor({ state: "detached" });
  const afterCancel = await savedProject();
  assert.equal(sourceFingerprint(afterCancel.node), initialSource, "Cancel changed source mesh positions");
  pass("Painted preview enables Apply and Cancel leaves source positions unchanged", { triangles: sourceObject.importedTriangles, radiusMm: 5, previewText });

  const initialFile = checkpoint(afterCancel.archive, afterCancel.project, "smoothing-original-checkpoint.lyl", "original");
  const initialName = `Smoothing original checkpoint`;
  await reopen(initialFile, initialName);
  await waitForObject(sourceObject.id, (object) => object.importedTriangles === 2016, "original imported mesh on fresh LYL reopen");
  sourceObject = await objectById(sourceObject.id);
  await command("select_objects", { ids: [sourceObject.id] });
  await page.getByRole("button", { name: "Smooth Mesh", exact: true }).click();
  const dialog2 = page.getByRole("dialog", { name: "Smooth Mesh" });
  await dialog2.waitFor();
  const canvas2 = dialog2.locator("canvas"), box2 = await canvas2.boundingBox();
  assert.ok(box2, "Reopened smoothing viewport is missing");
  await page.waitForFunction(() => { const d=document.querySelector('[role="dialog"][aria-label="Smooth Mesh"]'); const b=[...(d?.querySelectorAll('button')??[])].find(x=>x.textContent?.trim()==='Preview'); return b&&!b.disabled; });
  await dialog2.getByLabel("Brush radius").fill("5");
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  await dialog2.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(() => { const d=document.querySelector('[role="dialog"][aria-label="Smooth Mesh"]'); const b=[...(d?.querySelectorAll('button')??[])].find(x=>x.textContent?.includes('Apply smoothing')); return d?.querySelector('[role="alert"]')?.textContent?.trim() || (b&&!b.disabled); });
  assert.equal(await dialog2.getByRole("alert").count(), 0, await dialog2.innerText());
  assert.equal(await dialog2.getByRole("button", { name: "Apply smoothing", exact: true }).isEnabled(), true);
  if(/ultimate\.(7|8)$/.test(process.env.LAYERLING_EXPECTED_APP_VERSION??'')){
    await dialog2.getByLabel('Smoothing iterations').fill('21');
    assert.equal(await dialog2.getByRole('button',{name:'Apply smoothing',exact:true}).isEnabled(),false,'Changed iterations left stale preview applicable');
    await dialog2.getByLabel('Smoothing iterations').fill('20');
    await dialog2.getByRole('button',{name:'Preview',exact:true}).click();
    await command('select_objects',{ids:[]});
    await page.waitForFunction(()=>{const d=document.querySelector('[aria-label="Smooth Mesh"]');return d?.querySelector('[role="alert"]')||[...d.querySelectorAll('button')].some(b=>b.textContent==='Apply smoothing'&&!b.disabled);});
    assert.equal(await dialog2.getByRole('alert').count(),0,await dialog2.innerText());
    await command('select_objects',{ids:[sourceObject.id]});
  }
  await dialog2.getByRole("button", { name: "Apply smoothing", exact: true }).click();
  await dialog2.waitFor({ state: "detached" });
  let smoothedProject = await savedProject();
  const smoothedSource = sourceFingerprint(smoothedProject.node);
  assert.notEqual(smoothedSource, initialSource, "Apply did not change the imported source positions");
  assert.equal(smoothedProject.node.objectId, sourceObject.id, "Smoothing changed object identity");
  const afterApply = await objectById(sourceObject.id);
  assert.equal(afterApply.importedTriangles, sourceObject.importedTriangles, "Smoothing changed triangle count");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const undone = await waitForObject(sourceObject.id, (object) => object.importedTriangles === 2016, "Undo to original source");
  const undoneProject = await savedProject();
  assert.equal(sourceFingerprint(undoneProject.node), initialSource, "Undo did not restore source positions");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await waitForObject(sourceObject.id, (object) => object.importedTriangles === afterApply.importedTriangles, "Redo to smoothed source");
  smoothedProject = await savedProject();
  assert.equal(sourceFingerprint(smoothedProject.node), smoothedSource, "Redo did not restore smoothed positions");
  if(/ultimate\.(7|8)$/.test(process.env.LAYERLING_EXPECTED_APP_VERSION??''))for(let cycle=0;cycle<2;cycle++){
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(sourceFingerprint((await savedProject()).node),initialSource,'Repeated Undo changed source');
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    smoothedProject=await savedProject();assert.equal(sourceFingerprint(smoothedProject.node),smoothedSource,'Repeated Redo changed result');
  }
  const finalFile = checkpoint(smoothedProject.archive, smoothedProject.project, "smoothing-applied-checkpoint.lyl", "applied");
  const finalName = "Smoothing applied checkpoint";
  await reopen(finalFile, finalName);
  const reopened = await waitForObject(sourceObject.id, (object) => object.importedTriangles === afterApply.importedTriangles, "smoothed source after fresh LYL reopen");
  const reopenedProject = await savedProject();
  assert.equal(sourceFingerprint(reopenedProject.node), smoothedSource, "Fresh LYL reopen changed source positions");
  assert.equal(reopened.id, sourceObject.id, "Fresh LYL reopen changed object identity");
  pass("Localized smoothing changes source positions, preserves identity, supports Undo/Redo and survives a fresh LYL reopen", { triangles: reopened.importedTriangles, sourcePositions: reopenedProject.node.importedMesh.positions.length, smoothingPanelText: previewText });
  assert.deepEqual(errors, []);
  pass("Packaged app launched with System32-only PATH and external network blocked", { externalRequests: requests.filter((url) => /^https?:/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)).length });
} catch (error) {
  errors.push(error.stack || String(error)); console.error(error);
  if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(output, "results.json"), JSON.stringify({ executable, profile, checks, errors }, null, 2));
  if (app) await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.on("will-prevent-unload", (event) => event.preventDefault());
    }
  }).catch(() => {});
  if (app) await app.close().catch(() => {});
}
