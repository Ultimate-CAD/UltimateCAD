import {verifyStl,verify3mf} from "./manufacturing-file-audit.mjs";
import { _electron as electron, chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { OcctKernel } from "occt-wasm";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const devUrl = process.env.LAYERLING_SKETCHER_DEV_URL;
const mode = devUrl ? "dev" : "packaged";
const exe = path.resolve(process.argv.slice(2).find((s) => s.endsWith(".exe")) || "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe");
const output = path.resolve(`.codex-run/sketch16/${mode}-${new Date().toISOString().replaceAll(":", "-")}`);
const profile = path.join(output, "profile");
mkdirSync(profile, { recursive: true });
const failedExternal = new Set(), externalResponses = [];
const checks = [], pageErrors = [], externalRequests = new Set(), workerUrls = new Set(), trackedPages = [];
let app, browser, context, page, connection, editorId, expectedProjectName, acceptanceCompleted = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (name, detail = undefined) => { checks.push({ name, detail }); console.log("PASS", name, detail ?? ""); };
const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/i.test(url);
function trackPage(target) {
  if (!trackedPages.includes(target)) trackedPages.push(target);
  target.setDefaultTimeout(30000);
  target.on("pageerror", (error) => pageErrors.push(error.message));
  target.on("request", (request) => { if (/^https?:/i.test(request.url()) && !isLocal(request.url())) externalRequests.add(request.url()); });
  target.on("requestfailed", request => failedExternal.add(request.url()));
  target.on("response", response => {
    if (/^https?:/i.test(response.url()) && !isLocal(response.url())) externalResponses.push(response.url());
  });
  target.on("worker", (worker) => workerUrls.add(worker.url()));
  target.route("**/*", (route) => /^https?:/i.test(route.request().url()) && !isLocal(route.request().url()) ? route.abort() : route.continue());
}

async function launch() {
  if (devUrl) {
    context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", timeout: 90000, args: ["--no-first-run", "--no-default-browser-check"] });
    page = context.pages()[0] ?? await context.newPage();
    for (const existing of context.pages()) trackPage(existing);
    context.on("page", trackPage);
    await page.goto(devUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  } else {
    app = await electron.launch({ executablePath: exe, cwd: output, timeout: 90000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PATH: process.env.SystemRoot + "\\System32", LAYERLING_DESKTOP_PROFILE: profile, LAYERLING_DESKTOP_TEST: "1" } });
    page = await app.firstWindow({ timeout: 90000 });
    trackPage(page);
    app.on("window", trackPage);
    connection = JSON.parse(readFileSync(path.join(profile, "connection.json"), "utf8"));
  }
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor({ timeout: 90000 });
  if (!connection) connection = { url: new URL(devUrl).origin, token: null };
}

async function getEditors() {
  const headers = connection.token ? { Authorization: `Bearer ${connection.token}` } : {};
  const response = await fetch(`${connection.url}/api/layerling-mcp`, { headers, signal: AbortSignal.timeout(10000) });
  assert.equal(response.ok, true, `MCP discovery HTTP ${response.status}`);
  return (await response.json()).editors ?? [];
}
async function editorReady(projectName = expectedProjectName, minLastSeen = 0) {
  const isExpectedName = (name) => !projectName || name === projectName || name.startsWith(`${projectName} `);
  for (let i = 0; i < 150; i++) {
    const editors = (await getEditors()).filter((e) => Date.now() - e.lastSeen < 10000 && e.lastSeen >= minLastSeen && isExpectedName(e.projectName)).sort((a, b) => b.lastSeen - a.lastSeen);
    for (const editor of editors) {
      const matchingPage = trackedPages.find((candidate) => !candidate.isClosed() && candidate.url() === editor.url
        && new URL(candidate.url()).searchParams.get("project") === editor.projectId);
      if (matchingPage) { editorId = editor.editorId; page = matchingPage; return editor; }
    }
    await pause(200);
  }
  const available = (await getEditors()).map((e) => ({ editorId: e.editorId, projectName: e.projectName, url: e.url, lastSeen: e.lastSeen }));
  throw new Error(`No recently seen Layerling editor has a live matching page${projectName ? ` for '${projectName}'` : ""} after ${minLastSeen}; editors: ${JSON.stringify(available)}; pages: ${JSON.stringify(trackedPages.filter((candidate) => !candidate.isClosed()).map((candidate) => candidate.url()))}`);
}
async function reopenProject(file, projectName) {
  const previousUrl = page.url();
  const started = Date.now();
  expectedProjectName = projectName;
  await page.locator('input[type="file"][accept*=".lyl"]').first().setInputFiles(file);
  await page.waitForURL((url) => url.href !== previousUrl);
  const restored = await editorReady(projectName, started);
  await page.bringToFront();
  pass("Imported project switched to its restored editor", { editorId: restored.editorId, url: restored.url, previousUrl });
}
async function command(action, params = {}, timeoutMs = 60000) {
  await editorReady();
  const headers = { "Content-Type": "application/json", ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) };
  const response = await fetch(`${connection.url}/api/layerling-mcp`, { method: "POST", headers,
    body: JSON.stringify({ type: "command", editorId, action, params, timeoutMs }), signal: AbortSignal.timeout(timeoutMs + 10000) });
  const result = await response.json();
  assert.ok(result.ok, `${action}: ${JSON.stringify(result)}`);
  return result.data;
}
async function saveProject() {
  const saved = await command("save_project", { history: "all" });
  const archive = unzipSync(Buffer.from(saved.base64, "base64"));
  const project = JSON.parse(strFromU8(archive["project.json"]));
  const state = project.states.find((candidate) => candidate.id === project.sceneStateId);
  assert.ok(state?.nodes, "LYL current scene state is missing");
  return { saved, archive, project, state };
}
function sketchNode(state, id) {
  return state.nodes.find((node) => node.objectId === id && node.definition?.sketchProfile?.constraintSketch);
}
function byId(objects, id) { return objects.find((object) => object.id === id); }
async function setDimension(name, value, valid = true) {
  const input = page.getByLabel(name, { exact: true }).first();
  await input.fill(String(value));
  await input.dispatchEvent("change");
  await page.locator(`.constraint-sketch-status[data-solve-valid=${valid}]`).waitFor();
}
async function openSketcher() {
  const panel = page.locator(".constraint-sketch-workbench");
  if (await panel.count()) return panel;
  await page.getByRole("button", { name: "Constrained Sketcher", exact: true }).click();
  await panel.waitFor();
  await panel.locator('.constraint-sketch-status[data-solve-valid="true"]').waitFor();
  return panel;
}
async function closeSketcher(panel) {
  await panel.locator("header").getByRole("button", { name: "Close", exact: true }).click();
  await panel.waitFor({ state: "detached" });
}
async function expectSavedGeometry(id, radius, pitchRadius, holeRadius, extrusion) {
  const current = await saveProject();
  const node = sketchNode(current.state, id);
  assert.ok(node, `Object ${id} has no persisted constraint sketch`);
  const sketch = node.definition.sketchProfile.constraintSketch;
  const dim = (name) => sketch.constraints.find((c) => c.name === name)?.value;
  assert.equal(dim("Plate radius"), radius);
  assert.equal(dim("Bolt circle radius"), pitchRadius);
  assert.equal(dim("Hole radius"), holeRadius);
  assert.equal(sketch.extrusionMm, extrusion);
  return { current, node, sketch };
}
async function waitSavedGeometry(id, radius, pitchRadius, holeRadius, extrusion, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await expectSavedGeometry(id, radius, pitchRadius, holeRadius, extrusion);
      assert.ok(result.node.cadBrepAssetId, "Solid B-Rep asset has not been persisted yet");
      return result;
    } catch (error) { lastError = error; await pause(500); }
  }
  throw new Error(`Persisted solid did not reach radius ${radius}, bolt circle ${pitchRadius}, hole radius ${holeRadius}: ${lastError?.message ?? "timeout"}`);
}
async function waitForNewSketchSolid(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await saveProject();
    const node = latest.state.nodes.find((entry) => entry.definition?.sketchProfile?.constraintSketch && entry.cadBrepAssetId);
    if (node) return { current: latest, node };
    await pause(500);
  }
  throw new Error(`Build did not persist a sketch source with an exact B-Rep; last nodes: ${JSON.stringify(latest?.state?.nodes?.map((n) => ({ objectId: n.objectId, sketch: Boolean(n.definition?.sketchProfile?.constraintSketch), brep: Boolean(n.cadBrepAssetId) })) ?? [])}`);
}
async function independentVolume(archive, project, node) {
  const projectAsset = project.assets.find((entry) => entry.id === node.cadBrepAssetId);
  const asset = projectAsset && archive[projectAsset.path];
  assert.ok(asset, "Exact B-Rep asset is missing from the LYL archive");
  const kernelPath = path.dirname(fileURLToPath(import.meta.resolve("occt-wasm")));
  const kernel = await OcctKernel.init({ wasm: path.join(kernelPath, "occt-wasm.wasm") });
  try {
    const solid = kernel.fromBREP(strFromU8(asset));
    return kernel.getVolume(solid);
  } finally { kernel.dispose?.(); }
}
function brepAssetBytes(current, node) {
  const asset = current.project.assets.find((entry) => entry.id === node.cadBrepAssetId);
  assert.ok(asset, `B-Rep asset record ${node.cadBrepAssetId} is missing`);
  const bytes = current.archive[asset.path];
  assert.ok(bytes, `B-Rep asset bytes ${asset.path} are missing`);
  return Buffer.from(bytes).toString("base64");
}
function assertPackagedSolverNotices() {
  if (mode !== "packaged") return;
  const resources = path.join(path.dirname(exe), "resources");
  const runtimeRoot = path.join(resources, "runtime/apps/web/public/assets/planegcs/1.3.0");
  const legalRoot = path.join(resources, "legal/sketcher");
  const sourceRoot = path.join(resources, "sources");
  const runtimeMetadata = JSON.parse(readFileSync(path.join(runtimeRoot, "SOURCE.json"), "utf8"));
  const sourceMetadata = JSON.parse(readFileSync(path.join(sourceRoot, "PlaneGCS-SOURCE.json"), "utf8"));
  const expected = { package: "@salusoft89/planegcs", version: "1.3.0", gitHead: "9d26baef0b240fe0eef4186d4e5e5e66ec3620b7", npmIntegrity: "sha512-ugIkFCPnKRK1Yed+5297S/RmmfgEhIp5Xxx8PYhgfbcS+AxYV3chZ8LMGlEbEqrkbK6fwmNVLtEpLFq5KDl2lw==", sourceArchiveSha256: "cf7d4e27fd13fd169956cfecd60e10df2551b545921e4fa654f3d51b26fc0363" };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(runtimeMetadata[key], value, `Packaged runtime SOURCE.json ${key} mismatch`);
    assert.equal(sourceMetadata[key], value, `Packaged sources metadata ${key} mismatch`);
  }
  assert.equal(runtimeMetadata.packageLicenseMetadata, "LGPL-2.0-or-later");
  assert.equal(sourceMetadata.packageLicenseMetadata, "LGPL-2.0-or-later");
  assert.equal(runtimeMetadata.distributedLicenseFile, "LICENSE (GNU LGPL 2.1)");
  assert.ok(existsSync(path.join(runtimeRoot, "LICENSE")), "Packaged runtime PlaneGCS LICENSE is missing");
  assert.ok(existsSync(path.join(legalRoot, "PlaneGCS-LICENSE.txt")), "Packaged legal PlaneGCS license is missing");
  assert.ok(existsSync(path.join(sourceRoot, "PlaneGCS-Source.zip")), "Packaged PlaneGCS source archive is missing");
  const sourceArchiveHash = createHash("sha256").update(readFileSync(path.join(sourceRoot, "PlaneGCS-Source.zip"))).digest("hex");
  assert.equal(sourceArchiveHash, expected.sourceArchiveSha256, "Packaged PlaneGCS source archive hash mismatch");
  const license = readFileSync(path.join(legalRoot, "PlaneGCS-LICENSE.txt"), "utf8");
  const notice = readFileSync(path.join(legalRoot, "PlaneGCS-NOTICE.txt"), "utf8");
  assert.ok(license.includes("GNU LESSER GENERAL PUBLIC LICENSE") && license.includes("Version 2.1"), "Packaged legal license is not the preserved LGPL 2.1 text");
  assert.ok(notice.includes("LGPL-2.0-or-later") && notice.includes("GNU LGPL 2.1") && notice.includes(expected.gitHead), "Packaged solver notice is missing the upstream license or source declarations");
  pass("Packaged PlaneGCS metadata, license text, notice and source archive verified", { version: runtimeMetadata.version, packageLicenseMetadata: runtimeMetadata.packageLicenseMetadata, gitHead: runtimeMetadata.gitHead });
}
async function runCancellationAndRetry() {
  await command("select_objects", { ids: [originalId] });
  const before = await waitSavedGeometry(originalId, 45, 16, 3, 5);
  const beforeDefinition = JSON.stringify(before.node.definition);
  const beforeBrep = brepAssetBytes(before.current, before.node);
  // Intercept the actual CAD protocol in this isolated test page. Production
  // worker chunk names are hashed and cannot identify a particular job.
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    const terminate = Worker.prototype.terminate;
    const probe = window.sketchCancelProbe = { held: null, terminated: false };
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.type === "build" && message.profile?.constraintSketch) {
        probe.held = this;
        return;
      }
      return send.call(this, message, ...args);
    };
    Worker.prototype.terminate = function () {
      if (this === probe.held) probe.terminated = true;
      return terminate.call(this);
    };
    probe.restore = () => {
      Worker.prototype.postMessage = send;
      Worker.prototype.terminate = terminate;
    };
  });
  try {
    const panel = await openSketcher();
    await setDimension("Plate radius", 46);
    await panel.getByRole("button", { name: "Build solid", exact: true }).click();
    const cancelButton = panel.locator("footer").getByRole("button", { name: "Close", exact: true });
    await cancelButton.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.sketchCancelProbe.held));
    await cancelButton.click();
    assert.equal(await page.evaluate(() => window.sketchCancelProbe.terminated), true);
    await cancelButton.waitFor({ state: "detached", timeout: 30000 });
    await pause(500);
    const canceled = await expectSavedGeometry(originalId, 45, 16, 3, 5);
    assert.equal(JSON.stringify(canceled.node.definition), beforeDefinition, "Canceled worker changed saved sketch or body definition");
    assert.equal(brepAssetBytes(canceled.current, canceled.node), beforeBrep, "Canceled worker changed exact B-Rep bytes");
    pass("Injected nonresponsive CAD worker canceled without partial scene mutation", { objectId: originalId });

    await page.evaluate(() => window.sketchCancelProbe.restore());
    const retryPanel = await openSketcher();
    await setDimension("Plate radius", 46);
    await retryPanel.getByRole("button", { name: "Build solid", exact: true }).click();
    const rebuilt = await waitSavedGeometry(originalId, 46, 16, 3, 5);
    assert.equal(rebuilt.node.objectId, originalId, "Retry replaced the original solid ID");
    pass("Removing the worker stall allowed a fresh build retry", { objectId: originalId });

    await setDimension("Plate radius", 45);
    await retryPanel.getByRole("button", { name: "Build solid", exact: true }).click();
    await waitSavedGeometry(originalId, 45, 16, 3, 5);
    cancelExperiment = "passed: stalled-worker cancellation, unchanged source/B-Rep, real-worker retry, restored radius 45";
  } finally {
    await page.evaluate(() => { window.sketchCancelProbe.restore(); delete window.sketchCancelProbe; });
  }
}

async function verifyNamedPad() {
  await command("select_objects", {ids:[originalId]});
  let panel = await openSketcher();
  await panel.getByRole("button",{name:"Drive pad with parameters"}).click();
  await panel.getByRole("button",{name:"Add parameter"}).click();
  await panel.getByLabel("Expression",{exact:true}).nth(1).fill("3 mm");
  await panel.getByLabel("Expression",{exact:true}).first().fill("2 * length1");
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  const saved = await waitSavedGeometry(originalId,45,16,3,6);
  const history = saved.sketch.featureHistory;
  assert.equal(history.pad.profileId,history.sketch.id);
  const expected = Math.PI*(45**2-6*3**2)*6;
  assert.ok(Math.abs(await independentVolume(saved.current.archive,saved.current.project,saved.node)-expected)<1e-6);
  await panel.getByLabel("Expression",{exact:true}).nth(1).fill("depth");
  await panel.getByRole("alert").filter({hasText:"cycle"}).waitFor();
  assert.ok(await panel.getByRole("button",{name:"Build solid",exact:true}).isDisabled());
  await closeSketcher(panel);
  await page.keyboard.press("Control+z");
  await waitSavedGeometry(originalId,45,16,3,5);
  await page.keyboard.press("Control+y");
  const redone = await waitSavedGeometry(originalId,45,16,3,6);
  assert.deepEqual(redone.sketch.featureHistory,history);
  const file = path.join(output,"editable-pad.lyl");
  writeFileSync(file,Buffer.from(redone.current.saved.base64,"base64"));
  await reopenProject(file,redone.current.project.metadata?.projectName);
  const reopened = await waitSavedGeometry(originalId,45,16,3,6);
  assert.deepEqual(reopened.sketch.featureHistory,history);
  assert.equal(brepAssetBytes(reopened.current,reopened.node),brepAssetBytes(saved.current,saved.node));
  pass("Named pad depth drives exact geometry, rejects cyclic edit and survives Undo/Redo and reopening", {objectId:originalId,padId:history.pad.id,volumeMm3:expected});
  await command("select_objects", {ids:[originalId]});
  panel = await openSketcher();
  await panel.getByRole("button",{name:"Add through-hole"}).click();
  await panel.getByRole("button",{name:"Add through-hole"}).click();
  await panel.getByLabel("Center X (mm)",{exact:true}).nth(1).fill("10");
  async function checkHoles(suppressed) {
    const deadline = Date.now()+30000;
    while (Date.now()<deadline) {
      const current = await saveProject();
      const node = sketchNode(current.state,originalId);
      const holes = node?.definition.sketchProfile.constraintSketch.featureHistory.holes;
      if (holes?.length===2 && holes[0].suppressed===suppressed && holes[1].xMm===10) {
        const volume=await independentVolume(current.archive,current.project,node);
        assert.ok(Math.abs(volume-(expected-(suppressed?1:2)*Math.PI*4*6))<1e-6);
        return {holes,current,node};
      }
      await pause(100);
    }
    throw Error("Hole replay failed to commit the requested features");
  }
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  const both=await checkHoles(false);
  await panel.getByLabel("Suppress hole").first().check();
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  const one=await checkHoles(true);
  assert.deepEqual(one.holes.map(h=>h.id),both.holes.map(h=>h.id));
  const holesFile=path.join(output,"suppressed-hole.lyl");
  writeFileSync(holesFile,Buffer.from(one.current.saved.base64,"base64"));
  await closeSketcher(panel);
  await page.keyboard.press("Control+z");
  await checkHoles(false);
  await page.keyboard.press("Control+y");
  await checkHoles(true);
  await reopenProject(holesFile,one.current.project.metadata?.projectName);
  const loaded=await checkHoles(true);
  assert.deepEqual(loaded.holes,one.holes);
  assert.equal(brepAssetBytes(loaded.current,loaded.node),brepAssetBytes(one.current,one.node));
  pass("Two linked hole cuts rebuild, suppress, undo and reload with correct exact volume and stable feature IDs");

  await command("select_objects",{ids:[originalId]});
  panel=await openSketcher();
  await panel.getByRole("button",{name:"Finish a hole rim"}).click();
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  await panel.getByText("Sketch solid built",{exact:true}).waitFor();
  const finished=await saveProject();
  const treated=sketchNode(finished.state,originalId);
  assert.equal(treated.definition.sketchProfile.constraintSketch.featureHistory.rimFinish.holeId,one.holes[1].id);
  const treatedVolume=await independentVolume(finished.archive,finished.project,treated);
  assert.ok(treatedVolume>0 && treatedVolume<expected-Math.PI*4*6);
  await panel.getByLabel("Treated hole",{exact:true}).selectOption(one.holes[0].id);
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  await panel.getByRole("alert").filter({hasText:"Missing feature face"}).waitFor();
  const rejected=await saveProject();
  assert.equal(brepAssetBytes(rejected,sketchNode(rejected.state,originalId)),brepAssetBytes(finished,treated));
  assert.deepEqual(sketchNode(rejected.state,originalId).definition,treated.definition);
  pass("Rim fillet on surviving hole succeeds; targeting suppressed hole reports missing face and preserves the exact body");

  await closeSketcher(panel);
  await command("select_objects",{ids:[originalId]});
  panel=await openSketcher();
  await panel.getByLabel("Suppress treatment").check();
  await panel.getByRole("button",{name:"Pattern hole",exact:true}).last().click();
  await panel.getByLabel("Pattern type",{exact:true}).selectOption("circular");
  await panel.getByLabel("Instances",{exact:true}).fill("4");
  await panel.getByLabel("Angular step (deg)",{exact:true}).fill("90");
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  await panel.getByText("Sketch solid built",{exact:true}).waitFor();
  const repeated=await saveProject();
  const repeatedNode=sketchNode(repeated.state,originalId);
  assert.equal(repeatedNode.definition.sketchProfile.constraintSketch.featureHistory.holes[1].pattern.count,4);
  assert.ok(Math.abs(await independentVolume(repeated.archive,repeated.project,repeatedNode)-(expected-4*Math.PI*4*6))<1e-6);
  const patternFile=path.join(output,"circular-pattern.lyl");
  writeFileSync(patternFile,Buffer.from(repeated.saved.base64,"base64"));
  await closeSketcher(panel);
  await reopenProject(patternFile,repeated.project.metadata?.projectName);
  const reopenedPattern=await saveProject();
  const patternNode=sketchNode(reopenedPattern.state,originalId);
  assert.deepEqual(patternNode.definition,repeatedNode.definition);
  assert.equal(brepAssetBytes(reopenedPattern,patternNode),brepAssetBytes(repeated,repeatedNode));
  pass("Editable circular hole pattern reproduces the analytic volume and survives reopening");

  await command("select_objects",{ids:[originalId]});
  panel=await openSketcher();
  await panel.getByRole("button",{name:"Add sketch pocket"}).click();
  await panel.getByRole("button",{name:"Edit pocket profile"}).click();
  await setDimension("Pocket radius",3.5);
  await panel.getByRole("button",{name:"Save sketch",exact:true}).click();
  await panel.getByLabel("Pocket depth (mm)").fill("1.5");
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  await panel.getByText("Sketch solid built",{exact:true}).waitFor();
  const pocket=await saveProject();
  const pocketNode=sketchNode(pocket.state,originalId);
  const pocketVolume=await independentVolume(pocket.archive,pocket.project,pocketNode);
  assert.ok(Math.abs(pocketVolume-(expected-4*Math.PI*4*6-Math.PI*3.5**2*1.5))<1e-6);
  const pocketFile=path.join(output,"profile-pocket.lyl");
  writeFileSync(pocketFile,Buffer.from(pocket.saved.base64,"base64"));
  await closeSketcher(panel);
  await reopenProject(pocketFile,pocket.project.metadata?.projectName);
  const loadedPocket=await saveProject();
  assert.deepEqual(sketchNode(loadedPocket.state,originalId).definition,pocketNode.definition);
  assert.equal(brepAssetBytes(loadedPocket,sketchNode(loadedPocket.state,originalId)),brepAssetBytes(pocket,pocketNode));
  pass("Editable constrained pocket sketch and blind depth regenerate, preserve analytic volume and reopen");

}

async function verifyRevolve() {
  const panel=await openSketcher();
  await panel.getByRole("button",{name:"New sketch",exact:true}).click();
  await panel.locator("summary").filter({hasText:"Geometry"}).click();
  await panel.getByRole("button",{name:"Circle",exact:true}).click();
  await panel.getByLabel("X (mm)",{exact:true}).fill("-10");
  await panel.getByLabel("Radius (mm)",{exact:true}).fill("3");
  await panel.getByRole("button",{name:"Drive pad with parameters"}).click();
  await panel.getByLabel("Base operation",{exact:true}).selectOption("revolve");
  await panel.locator('.constraint-sketch-status[data-solve-valid="true"]').waitFor();
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  let built;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    const data=await saveProject();
    const node=data.state.nodes.find(n=>n.definition?.sketchProfile?.constraintSketch?.featureHistory?.pad.kind==="revolve");
    if(node?.cadBrepAssetId){built={data,node};break;}
    await pause(100);
  }
  assert.ok(built,"Revolve did not build");
  const identity=built.node.objectId;
  assert.ok(Math.abs(await independentVolume(built.data.archive,built.data.project,built.node)-180*Math.PI**2)<1e-6);
  await panel.getByLabel("Expression",{exact:true}).nth(1).fill("90 deg");
  await panel.locator('.constraint-sketch-status[data-solve-valid="true"]').waitFor();
  await panel.getByRole("button",{name:"Build solid",exact:true}).click();
  await panel.getByText("Sketch solid built",{exact:true}).waitFor();
  const partial=await saveProject();
  const partialNode=sketchNode(partial.state,identity);
  assert.ok(Math.abs(await independentVolume(partial.archive,partial.project,partialNode)-45*Math.PI**2)<1e-6);
  await panel.getByLabel("Expression",{exact:true}).nth(1).fill("0 deg");
  await panel.getByRole("alert").filter({hasText:"Revolve needs"}).waitFor();
  assert.ok(await panel.getByRole("button",{name:"Build solid",exact:true}).isDisabled());
  await closeSketcher(panel);
  await page.keyboard.press("Control+z");
  const undone=await saveProject();
  assert.ok(Math.abs(await independentVolume(undone.archive,undone.project,sketchNode(undone.state,identity))-180*Math.PI**2)<1e-6);
  await page.keyboard.press("Control+y");
  const file=path.join(output,"revolve.lyl");
  writeFileSync(file,Buffer.from(partial.saved.base64,"base64"));
  await reopenProject(file,partial.project.metadata?.projectName);
  const reopened=await saveProject();
  assert.deepEqual(sketchNode(reopened.state,identity).definition,partialNode.definition);
  assert.equal(brepAssetBytes(reopened,sketchNode(reopened.state,identity)),brepAssetBytes(partial,partialNode));
  pass("Editable full and partial revolve match analytic volume, reject zero sweep, undo and reopen with stable identity");
}

async function verifyAssembly() {
  const root=(await command("create_shape",{kind:"box",name:"Ground",width:10,depth:10,height:10,x:100})).object;
  const child=(await command("create_shape",{kind:"box",name:"Arm",width:10,depth:10,height:10,x:120})).object;
  await page.getByRole("button",{name:"Assembly workspace",exact:true}).click();
  const panel=page.getByRole("region",{name:"Assembly workspace"});
  // section with an accessible name is a region.
  await panel.getByLabel("Grounded component",{exact:true}).selectOption(root.id);
  await panel.getByLabel("Attach component",{exact:true}).selectOption(child.id);
  await panel.getByLabel("Joint type",{exact:true}).selectOption("revolute");
  await panel.getByRole("button",{name:"Add joint",exact:true}).click();
  await panel.getByLabel("Position 1",{exact:true}).fill("90");
  async function savedChild(x,z) {
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      const saved=await saveProject(),node=saved.state.nodes.find(n=>n.objectId===child.id);
      if(node && Math.abs(node.definition.x-x)<1e-6 && Math.abs(node.definition.z-z)<1e-6)return {saved,node};
      await pause(100);
    }
    throw Error("Assembly component did not reach expected joint position");
  }
  const rotated=await savedChild(100,-20);
  const owner=rotated.saved.state.nodes.find(n=>n.objectId===root.id);
  assert.equal(owner.definition.assembly.joints[0].position,90);
  await panel.getByRole("button",{name:"Close assembly"}).click();
  await page.keyboard.press("Control+z");await savedChild(120,0);
  await page.keyboard.press("Control+y");await savedChild(100,-20);
  const file=path.join(output,"hinge.lyl");writeFileSync(file,Buffer.from(rotated.saved.saved.base64,"base64"));
  await reopenProject(file,rotated.saved.project.metadata?.projectName);
  const loaded=await savedChild(100,-20);
  assert.deepEqual(loaded.saved.state.nodes.find(n=>n.objectId===root.id).definition.assembly,owner.definition.assembly);
  await page.getByRole("button",{name:"Assembly workspace",exact:true}).click();
  await panel.getByRole("button",{name:"Remove joint"}).click();
  await panel.getByLabel("Joint type",{exact:true}).selectOption("slider");
  await panel.getByRole("button",{name:"Add joint",exact:true}).click();
  await panel.getByLabel("Axis x 1",{exact:true}).fill("1");
  await panel.getByLabel("Axis y 1",{exact:true}).fill("0");
  await panel.getByLabel("Position 1",{exact:true}).fill("25");
  await savedChild(125,-20);
  await panel.getByRole("button",{name:"Check grounded / selected overlap"}).click();
  await panel.getByRole("status").filter({hasText:"No intersecting material"}).waitFor({timeout:60000});
  await panel.getByLabel("Axis z 1",{exact:true}).fill("1");
  await panel.getByLabel("Axis x 1",{exact:true}).fill("0");
  await panel.getByLabel("Position 1",{exact:true}).fill("20");
  await savedChild(100,0);
  await panel.getByRole("button",{name:"Check grounded / selected overlap"}).click();
  await panel.getByRole("status").filter({hasText:"Intersecting material detected"}).waitFor({timeout:60000});
  await panel.getByRole("button",{name:"Remove joint"}).click();
  await panel.getByLabel("Joint type",{exact:true}).selectOption("fixed");
  await panel.getByRole("button",{name:"Add joint",exact:true}).click();
  await savedChild(100,0);
  await panel.getByRole("button",{name:"Close assembly"}).click();
  pass("Independent assembly components retain exact revolute, slider and fixed constraints through Undo, reopening and worker overlap checks");
}

async function verifyFem() {
  const beam=(await command("create_shape",{kind:"box",name:"SI cantilever",width:1000,depth:100,height:100})).object;
  await command("select_objects",{ids:[beam.id]});
  await page.getByRole("button",{name:"Structural analysis",exact:true}).click();
  const panel=page.getByRole("region",{name:"Structural analysis"});
  await panel.getByLabel("Mesh size (mm)",{exact:true}).fill("50");
  await panel.getByRole("button",{name:"Mesh and solve",exact:true}).click();
  await panel.getByRole("status").filter({hasText:"Linear static solve completed"}).waitFor({timeout:120000});
  const solved=await saveProject(),node=solved.state.nodes.find(n=>n.objectId===beam.id),study=node.definition.femStudy;
  assert.ok(Math.abs(study.result.maxDisplacementM-.0002)/.0002<.025);
  assert.ok(study.result.forceResidualN<.01 && study.result.momentResidualNm<.01);
  assert.equal(study.result.units.stress,"Pa");
  assert.ok(study.result.maxVonMisesPa>0);
  await panel.getByLabel("Deformation magnification",{exact:true}).fill("100");
  await panel.getByLabel("Deformed FEM result preview",{exact:true}).locator("canvas").waitFor();
  const file=path.join(output,"solved-beam.lyl");writeFileSync(file,Buffer.from(solved.saved.base64,"base64"));
  await panel.getByRole("button",{name:"Close analysis"}).click();
  await reopenProject(file,solved.project.metadata?.projectName);
  const restored=await saveProject();
  assert.deepEqual(restored.state.nodes.find(n=>n.objectId===beam.id).definition.femStudy,study);
  await command("select_objects",{ids:[beam.id]});
  await page.getByRole("button",{name:"Structural analysis",exact:true}).click();
  await panel.getByText(/Maximum displacement/).waitFor();
  await panel.getByLabel("Mesh size (mm)",{exact:true}).fill("5");
  await panel.getByRole("button",{name:"Mesh and solve",exact:true}).click();
  await panel.getByRole("button",{name:"Cancel analysis",exact:true}).click();
  await panel.getByRole("button",{name:"Mesh and solve",exact:true}).waitFor({state:"visible",timeout:30000});
  await panel.getByRole("button",{name:"Close analysis"}).click();
  const after=await saveProject();
  assert.deepEqual(after.state.nodes.find(n=>n.objectId===beam.id).definition.femStudy,study);
  pass("Bundled CAD meshing and CalculiX solve produce verified SI displacement/stress, render, save/reopen and cancel without losing saved results",{nodes:study.result.nodes,displacementM:study.result.maxDisplacementM,forceResidualN:study.result.forceResidualN});
}

async function verifyLibrary() {
  await page.getByRole("button",{name:"Offline design library",exact:true}).click();
  const panel=page.getByRole("region",{name:"Offline design library"});
  const fixtures=process.env.LAYERLING_LIBRARY_FIXTURES.split("|");
  await panel.getByLabel("Bulk library import",{exact:true}).setInputFiles(fixtures);
  await panel.getByRole("status").filter({hasText:"Indexing finished"}).waitFor({timeout:120000});
  const count=await panel.locator("article").count();
  assert.equal(count,4);
  assert.equal(await panel.locator("article img").count(),4);
  const stl=panel.getByRole("article",{name:"library-tetra.stl",exact:true});
  await stl.getByLabel("Tags library-tetra.stl",{exact:true}).fill("Tinkercad, bracket");
  await stl.getByLabel("Category library-tetra.stl",{exact:true}).fill("Mechanical");
  await panel.getByLabel("Search library",{exact:true}).fill("bracket");
  assert.equal(await panel.locator("article").count(),1);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"Offline design library",exact:true}).click();
  await panel.getByLabel("Search library",{exact:true}).fill("Mechanical");
  await panel.getByRole("article",{name:"library-tetra.stl",exact:true}).waitFor();
  assert.equal(await panel.locator("article").count(),1);
  const verification=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open("layerling-offline-library",1);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    const tx=db.transaction(["library-meta","library-files"],"readonly");
    const get=(store)=>new Promise((resolve,reject)=>{const q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    const [records,files]=await Promise.all([get("library-meta"),get("library-files")]);db.close();
    for(const f of files){
      const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",f.bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
      if(hash!==f.id)throw Error("Original library bytes changed");
    }
    return {count:files.length,ready:records.every(r=>r.status==="ready"),tags:records.find(r=>r.name==="library-tetra.stl").tags};
  });
  assert.equal(verification.count,4);assert.equal(verification.ready,true);assert.deepEqual(verification.tags,["Tinkercad","bracket"]);
  await panel.getByRole("button",{name:"Open model",exact:true}).click();
  await editorReady();
  assert.ok((await command("list_objects")).objects.length>0);
  pass("Bulk STL/OBJ/STEP/LYL originals preserve hashes, deduplicate, thumbnail, filter metadata, persist and open through normal import");
}

async function verifyImageRelief() {
  await page.getByRole("button",{name:"Image-to-solid designer",exact:true}).click();
  const panel=page.getByRole("region",{name:"Image-to-solid designer"});
  for(const suffix of ["jpeg","webp","png"]){
    await panel.getByLabel("Source image",{exact:true}).setInputFiles(path.resolve("tests/fixtures/image-relief/checker."+suffix));
    await panel.getByLabel("Image geometry preview",{exact:true}).locator("canvas").waitFor();
  }
  await panel.getByLabel("Width (mm)",{exact:true}).fill("20");
  await panel.getByLabel("Sampling resolution (long side)",{exact:true}).fill("16");
  await panel.getByLabel("Simulated backlighting",{exact:true}).check();
  await panel.getByLabel("Simulated backlit preview",{exact:true}).locator("canvas").waitFor();
  await panel.getByRole("button",{name:"Apply image solid",exact:true}).click();
  let id;
  async function waitImage(mode,min) {
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      const saved=await saveProject(),node=saved.state.nodes.find(n=>n.definition?.imageRelief?.settings.mode===mode&&n.definition.imageRelief.settings.minThickness===min);
      if(node){if(id)assert.equal(node.objectId,id);else id=node.objectId;return {saved,node};}
      await pause(100);
    }
    throw Error("Image solid was not generated");
  }
  const first=await waitImage("lithophane",.8);
  assert.equal(first.node.definition.width,20);assert.equal(first.node.definition.depth,20);
  const imageAsset=first.saved.project.assets.find(a=>a.id===first.node.definition.imageRelief.assetId);
  assert.deepEqual(Buffer.from(first.saved.archive[imageAsset.path]),readFileSync(path.resolve("tests/fixtures/image-relief/checker.png")));
  await panel.getByLabel("Image modeling mode",{exact:true}).selectOption("relief");
  await panel.getByLabel("Minimum thickness / base (mm)",{exact:true}).fill("1");
  await panel.getByRole("button",{name:"Apply image solid",exact:true}).click();
  const changed=await waitImage("relief",1);
  await panel.getByRole("button",{name:"Close image designer"}).click();
  await page.keyboard.press("Control+z");await waitImage("lithophane",.8);
  await page.keyboard.press("Control+y");await waitImage("relief",1);
  const file=path.join(output,"editable-image-solid.lyl");writeFileSync(file,Buffer.from(changed.saved.saved.base64,"base64"));
  await reopenProject(file,changed.saved.project.metadata?.projectName);
  const restored=await waitImage("relief",1);
  assert.deepEqual(restored.node.definition,changed.node.definition);
  await command("select_objects",{ids:[id]});
  await page.getByRole("button",{name:"Image-to-solid designer",exact:true}).click();
  assert.equal(await panel.getByLabel("Width (mm)",{exact:true}).inputValue(),"20");
  await panel.getByLabel("Simulated backlighting",{exact:true}).check();
  await panel.getByLabel("Simulated backlit preview",{exact:true}).locator("canvas").waitFor();
  await panel.getByLabel("Sampling resolution (long side)",{exact:true}).fill("512");
  await panel.getByLabel("Simulated backlit preview",{exact:true}).locator("canvas").waitFor();
  await page.evaluate(()=>{
    const original=Worker.prototype.postMessage,terminate=Worker.prototype.terminate;
    const probe=window.imageCancelProbe={held:null,terminated:false};
    Worker.prototype.postMessage=function(message,...args){if(message?.source?.settings?.resolution===512){probe.held=this;return;}return original.call(this,message,...args);};
    Worker.prototype.terminate=function(){if(this===probe.held)probe.terminated=true;return terminate.call(this);};
    probe.restore=()=>{Worker.prototype.postMessage=original;Worker.prototype.terminate=terminate;};
  });
  try{
    await panel.getByRole("button",{name:"Apply image solid",exact:true}).click();
    await page.waitForFunction(()=>Boolean(window.imageCancelProbe.held));
    await panel.getByRole("button",{name:"Cancel image generation",exact:true}).click();
    assert.equal(await page.evaluate(()=>window.imageCancelProbe.terminated),true);
    const cancelled=await saveProject();
    assert.deepEqual(cancelled.state.nodes.find(n=>n.objectId===id).definition,changed.node.definition);
  }finally{await page.evaluate(()=>{window.imageCancelProbe.restore();delete window.imageCancelProbe;});}
  pass("Canceled image geometry worker terminates and preserves the saved source, parameters and mesh");
  await panel.getByRole("button",{name:"Close image designer"}).click();
  if(mode==="packaged"){
    await app.evaluate(({BrowserWindow})=>{
      BrowserWindow.getAllWindows()[0].webContents.session.on("will-download",(_event,item)=>{
        if(!globalThis.__imageExportTarget)return;
        item.setSavePath(globalThis.__imageExportTarget);
        item.once("done",(_event,state)=>{globalThis.__imageExportDone=state;});
      });
    });
    for(const format of ["stl","3mf"]){
      await page.keyboard.press("Control+e");
      const studio=page.getByRole("region",{name:"Precision Mesh Studio"});
      await studio.getByRole("radio",{name:new RegExp("^"+format.toUpperCase()+":")}).check();
      await studio.getByRole("button",{name:"Generate export preview",exact:true}).click();
      await studio.locator('.precision-results[data-ready="true"]').waitFor({timeout:120000});
      const target=path.join(output,"image-solid."+format);
      await app.evaluate((_electron,file)=>{globalThis.__imageExportTarget=file;globalThis.__imageExportDone=null;},target);
      await studio.getByRole("button",{name:format==="stl"?"Export validated Binary STL":"Export validated 3MF",exact:true}).click();
      await page.waitForTimeout(200);
      let done;
      for(let i=0;i<600;i++){done=await app.evaluate(()=>globalThis.__imageExportDone);if(done)break;await pause(100);}
      assert.equal(done,"completed");
      const audit=format==="stl"?verifyStl(target):verify3mf(target);
      assert.ok(audit.volumeMm3>0);
      pass("Image solid manufacturing export independently reimports with strict closed topology",{format,audit});
      await studio.getByRole("button",{name:"Close",exact:true}).click();
    }
  }
  pass("PNG/JPEG/WebP flat image solids preview, regenerate same identity, retain exact original, undo and reopen",{objectId:id});
}

let originalId, cancelExperiment = "not-run";
try {
  await launch();
  pass("Started isolated sketcher validation", { mode, output, executable: mode === "packaged" ? exe : undefined });
  assertPackagedSolverNotices();
  const expectedVersion = process.env.LAYERLING_SKETCHER_EXPECTED_VERSION || process.env.LAYERLING_EXPECTED_APP_VERSION;
  if (mode === "packaged" && expectedVersion) {
    const actualVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
    assert.equal(actualVersion, expectedVersion, "Packaged app version does not match requested acceptance version");
    pass("Packaged app version matches acceptance expectation", actualVersion);
  }
  if(process.env.LAYERLING_TEST_LIBRARY==="1"){await verifyLibrary();}else{
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).click();
  await editorReady();
  if(process.env.LAYERLING_TEST_IMAGE === "1") { await verifyImageRelief(); } else if(process.env.LAYERLING_TEST_FEM === "1") { await verifyFem(); } else if(process.env.LAYERLING_TEST_ASSEMBLY === "1") { await verifyAssembly(); } else {
  const panel = await openSketcher();
  assert.equal(await panel.locator('.constraint-sketch-status[data-solve-valid="true"]').count(), 1);
  assert.match(await panel.locator('[role="status"]').first().innerText(), /Degrees of freedom:\s*0/);
  assert.equal(await panel.getByLabel("Plate radius", { exact: true }).first().inputValue(), "40");
  assert.equal(await panel.getByLabel("Bolt circle radius", { exact: true }).first().inputValue(), "28");
  assert.equal(await panel.getByLabel("Hole radius", { exact: true }).first().inputValue(), "2.5");
  pass("Default six-hole plate solves fully constrained", { dof: 0 });
  await panel.getByRole("button", { name: "Build solid", exact: true }).click();
  let objects = (await command("list_objects")).objects;
  const firstBuilt = await waitForNewSketchSolid();
  const firstNode = firstBuilt.node;
  originalId = firstNode.objectId;
  const first = await waitSavedGeometry(originalId, 40, 28, 2.5, 5);
  pass("Initial sketch solid persisted with its source and exact B-Rep", { objectId: originalId, cadBrepAssetId: first.node.cadBrepAssetId });

  await setDimension("Plate radius", 45);
  await setDimension("Bolt circle radius", 16);
  await setDimension("Hole radius", 3);
  const dofText = await panel.locator(".constraint-sketch-status").innerText();
  assert.match(dofText, /Degrees of freedom:\s*0/);
  await panel.getByRole("button", { name: "Build solid", exact: true }).click();
  objects = (await command("list_objects")).objects;
  let changed = await waitSavedGeometry(originalId, 45, 16, 3, 5);
  assert.equal(changed.node.objectId, originalId, "Rebuild changed the object ID");
  const measuredVolume = await independentVolume(changed.current.archive, changed.current.project, changed.node);
  const expectedVolume = Math.PI * (45 ** 2 - 6 * 3 ** 2) * 5;
  assert.ok(Math.abs(measuredVolume - expectedVolume) <= 1e-6, `Independent OCCT volume ${measuredVolume} differs from ${expectedVolume}`);
  pass("Edited dimensions rebuild same object and match independent OCCT volume", { objectId: originalId, measuredVolume, expectedVolume, tolerance: 1e-6 });

  await closeSketcher(panel);
  await page.keyboard.press("Control+z");
  await waitSavedGeometry(originalId, 40, 28, 2.5, 5);
  await page.keyboard.press("Control+y");
  await waitSavedGeometry(originalId, 45, 16, 3, 5);
  pass("Editor undo and redo restore persisted sketch parameters");

  const changedArchive = await saveProject();
  const file = path.join(output, "edited-mounting-plate.lyl");
  writeFileSync(file, Buffer.from(changedArchive.saved.base64, "base64"));
  await reopenProject(file, changedArchive.project.metadata?.projectName);
  objects = (await command("list_objects")).objects;
  assert.ok(byId(objects, originalId), "Imported project lost the source solid ID");
  const restored = await waitSavedGeometry(originalId, 45, 16, 3, 5);
  assert.deepEqual(restored.node.definition, changed.node.definition, "Reopen changed the sketch entities, constraints or body definition");
  assert.equal(brepAssetBytes(restored.current, restored.node), brepAssetBytes(changed.current, changed.node), "Reopen changed the exact B-Rep asset");
  const restoredVolume = await independentVolume(restored.current.archive, restored.current.project, restored.node);
  assert.ok(Math.abs(restoredVolume - expectedVolume) <= 1e-6, "Restored OCCT geometry differs from the edited plate");
  await command("select_objects", { ids: [originalId] });
  const reopenedPanel = await openSketcher();
  assert.equal(await reopenedPanel.getByLabel("Plate radius", { exact: true }).first().inputValue(), "45");
  assert.equal(await reopenedPanel.getByLabel("Bolt circle radius", { exact: true }).first().inputValue(), "16");
  assert.equal(await reopenedPanel.getByLabel("Hole radius", { exact: true }).first().inputValue(), "3");
  assert.match(await reopenedPanel.locator(".constraint-sketch-status").innerText(), /Degrees of freedom:\s*0/);
  assert.equal((await saveProject()).state.nodes.filter((node) => node.definition?.sketchProfile?.constraintSketch).length, 1);
  await closeSketcher(reopenedPanel);
  pass("Saved LYL reopens with original sketch ID, entities, constraints, dimensions and exact geometry", { restoredVolume, expectedVolume });

  const beforeInvalid = JSON.stringify((await saveProject()).state.nodes.find((node) => node.objectId === originalId)?.definition);
  const invalidPanel = await openSketcher();
  await setDimension("Plate radius", -1, false);
  assert.equal(await invalidPanel.locator('.constraint-sketch-status[data-solve-valid="true"]').count(), 0);
  assert.equal(await invalidPanel.getByRole("button", { name: "Build solid", exact: true }).isDisabled(), true);
  assert.equal(JSON.stringify((await saveProject()).state.nodes.find((node) => node.objectId === originalId)?.definition), beforeInvalid, "Invalid dimension mutated the saved body");
  await setDimension("Plate radius", 45);
  await invalidPanel.getByRole("button", { name: "Build solid", exact: true }).click();
  changed = await waitSavedGeometry(originalId, 45, 16, 3, 5);
  pass("Invalid radius blocks build without changing body; corrected sketch rebuilds");
  await closeSketcher(invalidPanel);
  await command("select_objects", { ids: [originalId] });

  const emptyPanel = await openSketcher();
  await emptyPanel.getByRole("button", { name: "New sketch", exact: true }).click();
  await emptyPanel.locator('.constraint-sketch-status[data-solve-valid="true"]').waitFor();
  await emptyPanel.locator("summary").filter({ hasText: "Geometry" }).click();
  await emptyPanel.getByRole("button", { name: "Point", exact: true }).click();
  await emptyPanel.getByRole("button", { name: "Save sketch", exact: true }).click();
  objects = (await command("list_objects")).objects;
  let mixed;
  const deadline = Date.now() + 45000;
  do {
    mixed = await saveProject();
    if (mixed.state.nodes.filter((node) => node.definition?.sketchProfile?.constraintSketch).length === 2) break;
    await pause(500);
  } while (Date.now() < deadline);
  assert.equal(mixed.state.nodes.filter((node) => node.definition?.sketchProfile?.constraintSketch).length, 2, "Saved point sketch was not persisted");
  const sketchOnlyNode = mixed.state.nodes.find((node) => node.objectId !== originalId && node.definition?.sketchProfile?.constraintSketch);
  assert.ok(sketchOnlyNode?.definition?.sketchOnly, "Saved point sketch is not explicitly sketch-only");
  assert.ok(!sketchOnlyNode.cadBrepAssetId, "Sketch-only point was represented with an exact solid B-Rep");
  assert.equal(JSON.stringify(mixed.state.nodes.find((node) => node.objectId === originalId)?.definition), JSON.stringify(changed.node.definition), "Saving sketch-only object changed the existing solid");
  const mixedFile = path.join(output, "mixed-solid-and-sketch.lyl");
  writeFileSync(mixedFile, Buffer.from(mixed.saved.base64, "base64"));
  await reopenProject(mixedFile, mixed.project.metadata?.projectName);
  objects = (await command("list_objects")).objects;
  const reopenedMixed = await saveProject();
  const reopenedSolid = reopenedMixed.state.nodes.find((node) => node.objectId === originalId);
  assert.ok(reopenedSolid?.cadBrepAssetId, "Mixed project reopen lost the original solid");
  assert.ok(reopenedMixed.state.nodes.some((node) => node.definition?.sketchOnly && node.definition?.sketchProfile?.constraintSketch), "Mixed project reopen lost sketch-only geometry");
  pass("Pure point sketch persists beside an unchanged solid through project reopen");

  const pageScreenshot = path.join(output, "mixed-sketch-project.png");
  await page.screenshot({ path: pageScreenshot, fullPage: false });
  pass("Captured mixed project viewport", pageScreenshot);
  await runCancellationAndRetry();
  if (process.env.LAYERLING_TEST_FEATURE_HISTORY === "1") { await verifyNamedPad(); await verifyRevolve(); }
  }
  }
  assert.deepEqual(pageErrors, [], `Renderer page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(externalResponses, [], "External endpoint responded");
  for (const address of externalRequests) {
    const url = new URL(address);
    assert.ok(url.hostname === "local.adguard.org" && ["user-script","content-script"].includes(url.searchParams.get("type")) && failedExternal.has(address), "Unexpected or unblocked external request: " + address);
  }
  pass("No renderer errors or successful external requests", { deniedWorkstationInjectorRequests: [...externalRequests], workers: [...workerUrls] });
  acceptanceCompleted = true;
} catch (error) {
  writeFileSync(path.join(output, "failure.json"), JSON.stringify({ error: error?.stack ?? String(error), checks, pageErrors, externalRequests: [...externalRequests], cancelExperiment }, null, 2));
  throw error;
} finally {
  writeFileSync(path.join(output, "report.json"), JSON.stringify({ mode, executable: mode === "packaged" ? exe : null, output, originalId, checks, pageErrors, externalRequests: [...externalRequests], cancelExperiment, complete: acceptanceCompleted }, null, 2));
  if (app) {
    await app.evaluate(({app}) => { setInterval(() => app.quit(), 1000).unref(); });
    await app.close();
  }
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
