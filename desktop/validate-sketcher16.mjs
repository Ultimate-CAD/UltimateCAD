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
      const matchingPage = trackedPages.find((candidate) => !candidate.isClosed() && candidate.url() === editor.url);
      if (matchingPage) { editorId = editor.editorId; page = matchingPage; return editor; }
    }
    await pause(200);
  }
  const available = (await getEditors()).map((e) => ({ editorId: e.editorId, projectName: e.projectName, url: e.url, lastSeen: e.lastSeen }));
  throw new Error(`No recently seen Layerling editor has a live matching page${projectName ? ` for '${projectName}'` : ""} after ${minLastSeen}; editors: ${JSON.stringify(available)}; pages: ${JSON.stringify(trackedPages.filter((candidate) => !candidate.isClosed()).map((candidate) => candidate.url()))}`);
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
  assert.ok(notice.includes("LGPL-2.0-or-later") && notice.includes("Version 2.1") && notice.includes(expected.gitHead), "Packaged solver notice is missing the upstream license or source declarations");
  pass("Packaged PlaneGCS metadata, license text, notice and source archive verified", { version: runtimeMetadata.version, packageLicenseMetadata: runtimeMetadata.packageLicenseMetadata, gitHead: runtimeMetadata.gitHead });
}
async function runCancellationAndRetry() {
  const cadWorkerUrl = [...workerUrls].find((url) => /sketchCad.*worker/i.test(url));
  if (!cadWorkerUrl) { cancelExperiment = "not-run: no sketch CAD worker URL observed"; return; }
  const reloadStarted = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await editorReady(expectedProjectName, reloadStarted);
  await command("select_objects", { ids: [originalId] });
  const before = await waitSavedGeometry(originalId, 45, 16, 3, 5);
  const beforeDefinition = JSON.stringify(before.node.definition);
  const beforeBrep = brepAssetBytes(before.current, before.node);
  await page.route(cadWorkerUrl, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "self.onmessage = () => {};" }));
  let routeActive = true;
  try {
    const panel = await openSketcher();
    await setDimension("Plate radius", 46);
    await panel.getByRole("button", { name: "Build solid", exact: true }).click();
    const cancelButton = panel.locator("footer").getByRole("button", { name: "Close", exact: true });
    await cancelButton.waitFor({ state: "visible", timeout: 30000 });
    await cancelButton.click();
    await cancelButton.waitFor({ state: "detached", timeout: 30000 });
    await pause(500);
    const canceled = await expectSavedGeometry(originalId, 45, 16, 3, 5);
    assert.equal(JSON.stringify(canceled.node.definition), beforeDefinition, "Canceled worker changed saved sketch or body definition");
    assert.equal(brepAssetBytes(canceled.current, canceled.node), beforeBrep, "Canceled worker changed exact B-Rep bytes");
    pass("Injected nonresponsive CAD worker canceled without partial scene mutation", { workerUrl: cadWorkerUrl, objectId: originalId });

    await page.unroute(cadWorkerUrl);
    routeActive = false;
    const retryPanel = await openSketcher();
    await setDimension("Plate radius", 46);
    await retryPanel.getByRole("button", { name: "Build solid", exact: true }).click();
    const rebuilt = await waitSavedGeometry(originalId, 46, 16, 3, 5);
    assert.equal(rebuilt.node.objectId, originalId, "Retry replaced the original solid ID");
    pass("Removing the worker stall allowed a fresh build retry", { workerUrl: cadWorkerUrl, objectId: originalId });

    await setDimension("Plate radius", 45);
    await retryPanel.getByRole("button", { name: "Build solid", exact: true }).click();
    await waitSavedGeometry(originalId, 45, 16, 3, 5);
    cancelExperiment = "passed: stalled-worker cancellation, unchanged source/B-Rep, real-worker retry, restored radius 45";
  } finally {
    if (routeActive) await page.unroute(cadWorkerUrl).catch(() => {});
  }
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
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).click();
  await editorReady();
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
  await page.goto(new URL("/", connection.url).href, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"][accept*=".lyl"]').first().setInputFiles(file);
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor();
  expectedProjectName = changedArchive.project.metadata?.projectName;
  await editorReady();
  objects = (await command("list_objects")).objects;
  assert.ok(byId(objects, originalId), "Imported project lost the source solid ID");
  await command("select_objects", { ids: [originalId] });
  const reopenedPanel = await openSketcher();
  assert.equal(await reopenedPanel.getByLabel("Plate radius", { exact: true }).first().inputValue(), "45");
  assert.equal(await reopenedPanel.getByLabel("Bolt circle radius", { exact: true }).first().inputValue(), "16");
  assert.equal(await reopenedPanel.getByLabel("Hole radius", { exact: true }).first().inputValue(), "3");
  assert.equal((await saveProject()).state.nodes.filter((node) => node.definition?.sketchProfile?.constraintSketch).length, 1);
  await closeSketcher(reopenedPanel);
  pass("Saved LYL reopens with original sketch ID and edited dimensions");

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
  await page.goto(new URL("/", connection.url).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor();
  await page.locator('input[type="file"][accept*=".lyl"]').first().setInputFiles(mixedFile);
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor();
  expectedProjectName = mixed.project.metadata?.projectName;
  await editorReady();
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
  assert.deepEqual(pageErrors, [], `Renderer page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual([...externalRequests], [], `Unexpected external requests: ${[...externalRequests].join(", ")}`);
  pass("No renderer errors or external network requests", { blockedExternalRequests: externalRequests.size, workers: [...workerUrls] });
  acceptanceCompleted = true;
} catch (error) {
  writeFileSync(path.join(output, "failure.json"), JSON.stringify({ error: error?.stack ?? String(error), checks, pageErrors, externalRequests: [...externalRequests], cancelExperiment }, null, 2));
  throw error;
} finally {
  writeFileSync(path.join(output, "report.json"), JSON.stringify({ mode, executable: mode === "packaged" ? exe : null, output, originalId, checks, pageErrors, externalRequests: [...externalRequests], cancelExperiment, complete: acceptanceCompleted }, null, 2));
  if (app) await app.close().catch(() => {});
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
