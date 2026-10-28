import { _electron as electron } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync, strFromU8 } from 'fflate';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const args = process.argv.slice(2);
const executable = path.resolve(args.find(argument => argument.toLowerCase().endsWith('.exe')) || 'dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe');
const sourceFile = path.resolve(process.env.LAYERLING_ORGANIC_SOURCE_FILE || '.codex-run/organic-repro/source.lyl');
const output = path.resolve(process.env.LAYERLING_ORGANIC_VALIDATION_DIR || 'dist/ultimate/windows/organic-validation');
const profile = path.join(output, 'private organic validation profile');
const resultsFile = path.join(output, 'results.json');
const finalProjectFile = path.join(output, 'hollowed-organic.lyl');
const finalStlFile = path.join(output, 'hollowed-organic.stl');
const screenshotFile = path.join(output, 'hollowed-organic-section.png');
mkdirSync(output, { recursive: true });
assert.ok(existsSync(sourceFile), `Captured organic source file does not exist: ${sourceFile}`);
assert.ok(existsSync(executable), `Packaged Layerling executable does not exist: ${executable}`);
assert.notEqual(path.resolve(sourceFile), path.resolve(finalProjectFile), 'Validation output must never overwrite the captured source project');

let app, page, connection, editorId, mainProcess;
const executeFile = promisify(execFile);
const runId = randomUUID();
const startedAt = new Date().toISOString();
const errors = [], checks = [], requests = [], workers = [], commandLatencies = [], progressSamples = [];
const workerHandles = [];
let heartbeat = null;
let sourceSha256 = createHash('sha256').update(readFileSync(sourceFile)).digest('hex');
const pass = (name, detail) => { checks.push({ name, result: 'PASS', detail }); console.log('PASS', name, detail ?? ''); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch() {
  app = await electron.launch({ executablePath: executable, cwd: output, timeout: 90000, env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    PATH: process.env.SystemRoot + '\\System32',
    LAYERLING_DESKTOP_PROFILE: profile,
    LAYERLING_DESKTOP_TEST: '1',
  } });
  mainProcess = await app.evaluate(() => ({ pid: process.pid, parentPid: process.ppid, executable: process.execPath }));
  assert.equal(mainProcess.executable.toLowerCase(), executable.toLowerCase());
  page = await app.firstWindow({ timeout: 90000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  page.on('request', request => requests.push(request.url()));
  page.on('worker', worker => { workers.push(worker.url()); workerHandles.push(worker); });
  await page.getByRole('button', { name: 'Create new 3D design', exact: true }).waitFor({ timeout: 60000 });
  connection = JSON.parse(readFileSync(path.join(profile, 'connection.json'), 'utf8'));
}

async function bounded(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function closeApplication() {
  if (!app) return;
  const closing = app;
  const identity = mainProcess;
  app = null;
  try {
    await bounded(closing.evaluate(({ app, BrowserWindow }) => {
      app.on('before-quit', () => {});
      app.on('will-quit', () => {});
      for (const window of BrowserWindow.getAllWindows()) window.webContents.on('will-prevent-unload', () => {});
      let attempts = 0;
      const retry = setInterval(() => { if (++attempts > 8) return clearInterval(retry); app.quit(); }, 1000);
    }), 5000, 'Could not prepare graceful shutdown');
    await bounded(closing.close(), 12000, 'Packaged app graceful close timed out');
  } catch (error) {
    // Only terminate this validator's app tree, after checking its PID, parent and executable.
    const { stdout } = await executeFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter 'ProcessId=${identity.pid}' | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 5000 });
    const live = stdout.trim() ? JSON.parse(stdout) : null;
    if (live) {
      assert.equal(live.ProcessId, identity.pid);
      assert.equal(live.ParentProcessId, identity.parentPid, 'Refusing cleanup after process ownership changed');
      assert.equal(live.ExecutablePath?.toLowerCase(), executable.toLowerCase(), 'Refusing cleanup of an unverified process');
      assert.ok(live.CommandLine?.toLowerCase().includes(executable.toLowerCase()), 'Refusing cleanup without the launch command');
      await executeFile(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(identity.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    }
    throw new Error(`Packaged validation app required a scoped shutdown fallback: ${error.message}`);
  }
}

async function editorReady() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await fetch(connection.url + '/api/layerling-mcp', { headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    const active = result.editors?.find(candidate => Date.now() - candidate.lastSeen < 10000);
    if (active) { editorId = active.editorId; return active; }
    await pause(200);
  }
  throw new Error('Packaged editor did not register with its isolated MCP endpoint');
}

async function command(action, params = {}, timeoutMs = 15000) {
  const started = performance.now();
  const response = await fetch(connection.url + '/api/layerling-mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'command', editorId, action, params, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 10000),
  });
  const result = await response.json();
  commandLatencies.push({ action, milliseconds: performance.now() - started, httpStatus: response.status, ok: result.ok });
  assert.ok(result.ok, `${action}: ${JSON.stringify(result)}`);
  return result.data;
}

async function listObjects() { return (await command('list_objects')).objects; }

async function waitForObject(id, predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = (await listObjects()).find(candidate => candidate.id === id);
    if (last && predicate(last)) return last;
    await pause(1500);
  }
  throw new Error(`${message}; last object state: ${JSON.stringify(last)}`);
}

function organicTarget(objects) {
  const matches = objects.filter(object => {
    const d = object.dimensions;
    return object.kind === 'mesh'
      && d
      && Math.abs(d.width - 47.578) < 0.02
      && Math.abs(d.depth - 39.387) < 0.02
      && Math.abs(d.height - 120.45) < 0.02
      && object.importedTriangles === 4812;
  });
  assert.equal(matches.length, 1, `Expected one captured 4,812-triangle cutgroup at 47.578 x 39.387 x 120.45 mm; found ${matches.length}`);
  return matches[0];
}

async function exportStl(id) {
  const exported = await command('export_mesh', { format: 'stl', ids: [id] }, 30000);
  assert.ok(exported.base64, 'STL export returned no data');
  return Buffer.from(exported.base64, 'base64');
}

async function validateStl(bytes) {
  const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const attribute = geometry.getAttribute('position');
  assert.ok(attribute.count >= 3 && attribute.count % 3 === 0, 'STL has no complete triangle list');
  const point = index => [attribute.getX(index), attribute.getY(index), attribute.getZ(index)];
  const area = triangle => {
    const u = triangle[1].map((value, axis) => value - triangle[0][axis]);
    const v = triangle[2].map((value, axis) => value - triangle[0][axis]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  let zeroAreaTriangles = 0;
  let validTriangleCount = 0;
  let signedVolume = 0;
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let offset = 0; offset < attribute.count; offset += 3) {
    const triangle = [point(offset), point(offset + 1), point(offset + 2)];
    assert.ok(triangle.flat().every(Number.isFinite), `STL has non-finite coordinates in triangle ${offset / 3}`);
    for (const vertex of triangle) vertex.forEach((value, axis) => {
      bounds.min[axis] = Math.min(bounds.min[axis], value);
      bounds.max[axis] = Math.max(bounds.max[axis], value);
    });
    if (Math.hypot(...area(triangle)) <= 1e-12) { zeroAreaTriangles += 1; continue; }
    signedVolume += (triangle[0][0] * (triangle[1][1] * triangle[2][2] - triangle[1][2] * triangle[2][1])
      + triangle[0][1] * (triangle[1][2] * triangle[2][0] - triangle[1][0] * triangle[2][2])
      + triangle[0][2] * (triangle[1][0] * triangle[2][1] - triangle[1][1] * triangle[2][0])) / 6;
    validTriangleCount += 1;
  }
  assert.ok(validTriangleCount > 0, 'STL has no nonzero-area triangles');

  // Keep the existing strict 1e-4 mm float-quantized edge audit. A failure is reported,
  // then independently checked with Manifold; the edge tolerance is never relaxed.
  const quantize = vertex => vertex.map(value => Math.round(value * 10000)).join(',');
  const vertProperties = new Float32Array(validTriangleCount * 9);
  const triVerts = new Uint32Array(validTriangleCount * 3);
  const edgeKeys = new Float64Array(validTriangleCount * 3);
  const vertexIds = new Map();
  const vertexId = vertex => {
    const key = quantize(vertex);
    let id = vertexIds.get(key);
    if (id === undefined) { id = vertexIds.size; vertexIds.set(key, id); }
    return id;
  };
  let vertexOffset = 0;
  let edgeOffset = 0;
  for (let offset = 0; offset < attribute.count; offset += 3) {
    const triangle = [point(offset), point(offset + 1), point(offset + 2)];
    if (Math.hypot(...area(triangle)) <= 1e-12) continue;
    const ids = triangle.map(vertexId);
    for (const vertex of triangle) for (const coordinate of vertex) vertProperties[vertexOffset++] = coordinate;
    for (let corner = 0; corner < 3; corner += 1) {
      const a = ids[corner], b = ids[(corner + 1) % 3];
      const low = Math.min(a, b), high = Math.max(a, b);
      edgeKeys[edgeOffset++] = low * 2 ** 32 + high;
    }
  }
  assert.ok(vertexIds.size < 2 ** 21, 'Quantized edge-key packing exceeded its validated exact-integer range');
  edgeKeys.sort();
  let boundaryEdges = 0;
  for (let index = 0; index < edgeKeys.length;) {
    let end = index + 1;
    while (end < edgeKeys.length && edgeKeys[end] === edgeKeys[index]) end += 1;
    if (end - index !== 2) boundaryEdges += 1;
    index = end;
  }
  for (let index = 0; index < triVerts.length; index += 1) triVerts[index] = index;

  let manifoldStatus = 'not-checked';
  let manifoldVolume = null;
  const manifoldModule = await import('manifold-3d');
  const runtime = await manifoldModule.default();
  runtime.setup();
  const mesh = new runtime.Mesh({ numProp: 3, vertProperties, triVerts, tolerance: 1e-5 });
  let solid;
  try {
    mesh.merge();
    solid = runtime.Manifold.ofMesh(mesh);
    manifoldStatus = solid.status();
    if (manifoldStatus === 'NoError') manifoldVolume = solid.volume();
  } finally {
    solid?.delete();
    if (typeof mesh.delete === "function") mesh.delete();
    geometry.dispose();
  }
  assert.equal(manifoldStatus, 'NoError', `Manifold rejected exported mesh: ${manifoldStatus}`);
  assert.ok(manifoldVolume > 0, 'Manifold found no positive-volume solid');
  assert.ok(Math.abs(signedVolume) > 0.001, 'STL has no positive oriented volume');
  assert.equal(boundaryEdges, 0, `Strict 1e-4 mm STL edge audit found ${boundaryEdges} unmatched edges`);
  return {
    triangles: validTriangleCount,
    filteredZeroAreaTriangles: zeroAreaTriangles,
    signedVolumeMm3: signedVolume,
    manifoldVolumeMm3: manifoldVolume,
    manifoldStatus,
    quantizedBoundaryEdges: boundaryEdges,
    bounds,
  };
}

async function startHeartbeat() {
  await page.evaluate(() => {
    const state = { frames: 0, maxGapMs: 0, last: performance.now(), raf: 0, stop: false };
    const tick = now => { state.maxGapMs = Math.max(state.maxGapMs, now - state.last); state.last = now; state.frames += 1; if (!state.stop) state.raf = requestAnimationFrame(tick); };
    window.__organicHeartbeat = state;
    state.raf = requestAnimationFrame(tick);
  });
}

async function stopHeartbeat() {
  return page.evaluate(() => {
    const state = window.__organicHeartbeat;
    if (!state) return null;
    state.stop = true;
    cancelAnimationFrame(state.raf);
    return { frames: state.frames, maxGapMs: state.maxGapMs };
  });
}

function latestShell(object) { return object?.edgeTreatments?.filter(feature => feature.kind === 'shell').at(-1); }

function validateSavedProject(projectBytes, id) {
  const archive = unzipSync(projectBytes);
  assert.ok(archive['project.json'], 'Saved LYL has no project.json');
  const project = JSON.parse(strFromU8(archive['project.json']));
  const state = project.states.find(candidate => candidate.id === project.sceneStateId);
  assert.ok(state, 'Saved LYL current state is missing');
  const resultNode = state.nodes.find(node => node.objectId === id);
  assert.ok(resultNode, `Saved LYL has no current object node for ${id}`);
  const history = resultNode.edgeTreatmentHistory ?? [];
  const entry = history.at(-1);
  assert.equal(entry?.feature?.kind, 'shell', 'Saved LYL has no reversible shell history');
  assert.equal(entry.feature.meshHollow?.method, 'mesh-sdf', 'Saved LYL dropped mesh hollowing statistics');
  assert.ok(entry.feature.meshHollow.measuredErrorMm <= entry.feature.meshHollow.maxErrorMm, 'Saved LYL error exceeds its selected accuracy');
  const beforeNode = state.nodes.find(node => node.nodeId === entry.beforeNodeId);
  assert.equal(beforeNode?.objectType, 'group', 'The pre-hollow captured group was not retained as history');
  assert.ok(beforeNode.groupedShapeNodeIds?.length > 0, 'The original group children were not retained in hollow history');
  const byNodeId = new Map(state.nodes.map(node => [node.nodeId, node]));
  assert.ok(beforeNode.groupedShapeNodeIds.every(childId => byNodeId.has(childId)), 'One or more original group children are missing from the saved LYL');
  assert.equal(resultNode.cadBrepAssetId, undefined, 'Mesh-only hollow result incorrectly retained a CAD BREP');
  assert.equal(resultNode.definition.cadBrepFrame, undefined, 'Mesh-only hollow result incorrectly retained a CAD BREP frame');
  return { project, stateId: state.id, resultNode, feature: entry.feature, beforeGroupChildren: beforeNode.groupedShapeNodeIds.length };
}

try {
  await launch();
  pass('Packaged executable launched with an isolated validator profile', { executable, profile });

  // Open the captured design from the dashboard before creating any blank design.
  await page.locator('input[type=file][accept*=".lyl"]').first().setInputFiles(sourceFile);
  await editorReady();
  const sourceTarget = organicTarget(await listObjects());
  const id = sourceTarget.id;
  const sourceFileHashBefore = createHash('sha256').update(readFileSync(sourceFile)).digest('hex');
  assert.equal(sourceFileHashBefore, sourceSha256);
  const originalStl = await exportStl(id);
  const originalStlSha256 = createHash('sha256').update(originalStl).digest('hex');
  const original = {
    id,
    color: sourceTarget.color,
    position: sourceTarget.position,
    dimensions: sourceTarget.dimensions,
    triangles: sourceTarget.importedTriangles,
    groupedCount: sourceTarget.groupedCount,
    sourceLylSha256: sourceFileHashBefore,
    sourceMeshSha256: originalStlSha256,
  };
  assert.equal(sourceTarget.importedTriangles, 4812);
  assert.ok(sourceTarget.groupedCount > 0, 'Captured cutgroup no longer has its source children');
  pass('Loaded the private captured cutgroup without creating a new design', original);

  // First run a real UI hollow and cancel while the worker is actively building the cavity.
  await command('select_objects', { ids: [id] });
  await page.getByRole('button', { name: 'Hollow', exact: true }).click();
  const cancelPanel = page.locator('.shell-panel');
  await cancelPanel.waitFor({ state: 'visible' });
  await cancelPanel.getByRole('button', { name: 'Closed (cavity inside)', exact: true }).click();
  await cancelPanel.locator('.edge-modifier-slider input[type="text"]').fill('2');
  await cancelPanel.locator('.edge-modifier-slider input[type="text"]').press('Enter');
  await cancelPanel.getByLabel('Mesh hollow accuracy').selectOption('0.1');
  assert.equal(await cancelPanel.getByLabel('Mesh hollow accuracy').inputValue(), '0.1');
  await startHeartbeat();
  const workerCountBeforeCancelRun = workerHandles.length;
  await cancelPanel.getByRole('button', { name: 'Hollow', exact: true }).click();
  await page.waitForFunction(() => /building mesh cavity/i.test(document.querySelector('.shell-panel [role="status"]')?.textContent ?? ''), null, { timeout: 90000 });
  progressSamples.push({ phase: 'cancel-run', text: await cancelPanel.locator('[role="status"]').innerText() });
  const startedWorkers = workerHandles.slice(workerCountBeforeCancelRun);
  assert.ok(startedWorkers.length > 0, 'No worker started for the cancellable mesh hollow run');
  const activeWorker = startedWorkers.find(worker => /meshHollow/i.test(worker.url())) ?? startedWorkers.at(-1);
  const workerClosed = new Promise(resolve => activeWorker.once('close', () => resolve(true)));
  await cancelPanel.locator('.edge-modifier-footer button.secondary').click();
  assert.equal(await bounded(workerClosed, 5000, `Canceled worker remained active (${activeWorker.url()})`), true);
  await cancelPanel.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await pause(1000);
  const afterCancel = await waitForObject(id, object => !latestShell(object), 15000, 'Canceled worker committed a hollow feature');
  assert.equal(afterCancel.id, id);
  const stlAfterCancel = await exportStl(id);
  const stlAfterCancelHash = createHash('sha256').update(stlAfterCancel).digest('hex');
  assert.equal(stlAfterCancelHash, originalStlSha256, 'Canceled hollow changed the original source mesh');
  assert.equal(createHash('sha256').update(readFileSync(sourceFile)).digest('hex'), sourceFileHashBefore, 'Validator changed the private captured source LYL');
  pass('Cancel stopped active mesh hollowing without changing source id, mesh, or source file', { id, progress: progressSamples.at(-1), sourceStlSha256: originalStlSha256 });

  // Run the actual hollow from the packaged UI. MCP is used only for short reads/exports;
  // the hollow itself never crosses the MCP 60-second command limit.
  await command('select_objects', { ids: [id] });
  await page.getByRole('button', { name: 'Hollow', exact: true }).click();
  const shellPanel = page.locator('.shell-panel');
  await shellPanel.waitFor({ state: 'visible' });
  await shellPanel.getByRole('button', { name: 'Closed (cavity inside)', exact: true }).click();
  await shellPanel.locator('.edge-modifier-slider input[type="text"]').fill('2');
  await shellPanel.locator('.edge-modifier-slider input[type="text"]').press('Enter');
  await shellPanel.getByLabel('Mesh hollow accuracy').selectOption('0.1');
  const wallValue = await shellPanel.locator('.edge-modifier-slider input[type="text"]').inputValue();
  assert.match(wallValue, /^2(?:\.0+)?(?:\s*mm)?$/i, `Expected a 2 mm wall, got ${wallValue}`);
  await startHeartbeat();
  const hollowStartedAt = new Date().toISOString();
  await shellPanel.getByRole('button', { name: 'Hollow', exact: true }).click();
  const deadline = Date.now() + 330_000;
  let hollowed;
  while (Date.now() < deadline) {
    const status = await shellPanel.locator('[role="status"]').innerText().catch(() => '');
    const failure = await shellPanel.locator('[role="alert"]').innerText({ timeout: 200 }).catch(() => '');
    if (failure) throw new Error(`Mesh hollowing UI failed: ${failure}`);
    if (status && progressSamples.at(-1)?.text !== status) progressSamples.push({ phase: 'hollow-run', text: status, at: new Date().toISOString() });
    const current = (await listObjects()).find(object => object.id === id);
    const feature = latestShell(current);
    if (feature?.meshHollow?.method === 'mesh-sdf') { hollowed = current; break; }
    await pause(2500);
  }
  assert.ok(hollowed, 'The UI hollow did not finish within the worker timeout window');
  const hollowFeature = latestShell(hollowed);
  const stats = hollowFeature.meshHollow;
  assert.ok(stats.measuredErrorMm <= stats.maxErrorMm, `Measured cavity error ${stats.measuredErrorMm} exceeds ${stats.maxErrorMm} mm`);
  assert.equal(stats.maxErrorMm, 0.1);
  assert.equal(hollowed.id, id, "Hollowing changed the object's identity");
  assert.equal(hollowed.color, original.color, 'Hollowing changed the source color');
  for (const dimension of ['width', 'depth', 'height']) assert.ok(Math.abs(hollowed.dimensions[dimension] - original.dimensions[dimension]) <= 0.01, `Inward hollow changed outside ${dimension}`);
  for (const axis of ['x', 'z', 'elevation']) assert.ok(Math.abs(hollowed.position[axis] - original.position[axis]) <= 0.01, `Inward hollow moved outside ${axis}`);
  assert.deepEqual(hollowFeature.shellOptions, { direction: 'inward', meshAccuracyMm: 0.1 });
  pass('Packaged UI hollow retained source identity and outside dimensions', { id, triangles: stats.resultTriangles, accuracy: stats.maxErrorMm, measuredError: stats.measuredErrorMm, durationMs: stats.durationMs });

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitForObject(id, object => !latestShell(object), 30000, 'Undo did not restore the original source group');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  hollowed = await waitForObject(id, object => latestShell(object)?.meshHollow?.method === 'mesh-sdf', 30000, 'Redo did not restore mesh hollow history');
  assert.equal(hollowed.id, id);
  pass('UI Undo and Redo restore the original group and sampled hollow feature');

  // The section plane uses Three.js axes; y is vertical. Center it at the captured object's mid-height.
  try {
    const section = await command('set_section_view', { enabled: true, orientation: 'world', axis: 'y', offset: original.position.elevation + original.dimensions.height / 2, showPlane: false });
    await pause(500);
    await page.screenshot({ path: screenshotFile, fullPage: true });
    pass('Captured a section-view screenshot through the packaged editor', section);
  } catch (error) {
    checks.push({ name: 'Section-view screenshot', result: 'SKIP', detail: error.message });
    console.warn('SKIP section-view screenshot', error.message);
  }

  const saved = await command('save_project', { history: 'all' }, 30000);
  const projectBytes = Buffer.from(saved.base64, 'base64');
  assert.ok(projectBytes.length > 0);
  writeFileSync(finalProjectFile, projectBytes);
  const savedProject = validateSavedProject(projectBytes, id);
  pass('Saved LYL retains hollow stats and the complete pre-hollow group snapshot', { bytes: projectBytes.length, stats: savedProject.feature.meshHollow, beforeGroupChildren: savedProject.beforeGroupChildren });

  const finalStl = await exportStl(id);
  writeFileSync(finalStlFile, finalStl);
  const manufacturingMesh = await validateStl(finalStl);
  pass('Exported STL passes finite-coordinate, zero-area-filtered topology and Manifold checks', manufacturingMesh);

  heartbeat = await stopHeartbeat();
  assert.ok(heartbeat.frames > 0, 'Animation-frame heartbeat did not run');
  pass('Renderer animation-frame responsiveness measured during worker hollowing', heartbeat);
  await closeApplication();

  await launch();
  await page.goto(connection.url);
  await page.getByRole('button', { name: 'Open a design or import geometry', exact: true }).waitFor({ timeout: 60000 });
  await page.locator('input[type=file][accept*=".lyl"]').first().setInputFiles(finalProjectFile);
  await editorReady();
  const reopened = await waitForObject(id, object => latestShell(object)?.meshHollow?.method === 'mesh-sdf', 60000, 'Reopened LYL lost the hollow result');
  assert.equal(reopened.id, id);
  assert.deepEqual(latestShell(reopened).meshHollow, stats, 'Reopened LYL changed saved mesh-hollow statistics');
  const reopenedStl = await exportStl(id);
  assert.equal(createHash('sha256').update(reopenedStl).digest('hex'), createHash('sha256').update(finalStl).digest('hex'), 'Reopened project exports different mesh bytes');
  assert.equal(createHash('sha256').update(readFileSync(sourceFile)).digest('hex'), sourceFileHashBefore, 'Private captured source LYL changed during validation');
  pass('Graceful restart and LYL reopen preserve identity, hollow statistics, children history, and STL bytes', { id, sourceLylSha256: sourceFileHashBefore, hollowedLyl: finalProjectFile, hollowedStl: finalStlFile });
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    writeFileSync(path.join(output, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => 'unavailable'));
  }
  errors.push(error.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  if (heartbeat && page) heartbeat = await stopHeartbeat().catch(() => heartbeat);
  await closeApplication().catch(error => { errors.push(`Shutdown: ${error.stack ?? error}`); process.exitCode = 1; });
  const sourceFileHashAfter = existsSync(sourceFile) ? createHash('sha256').update(readFileSync(sourceFile)).digest('hex') : null;
  if (sourceFileHashAfter !== sourceSha256) { errors.push('Private captured source LYL hash changed during validation'); process.exitCode = 1; }
  writeFileSync(resultsFile, JSON.stringify({
    runId, startedAt, finishedAt: new Date().toISOString(), executable, sourceFile, sourceFileSha256: sourceSha256,
    sourceFileSha256After: sourceFileHashAfter, output, checks, errors, commandLatencies, progressSamples, heartbeat, workers,
    requests: requests.filter(url => url.startsWith(connection?.url ?? '\u0000')).map(url => url.replace(connection.url, '')),
    artifacts: { project: existsSync(finalProjectFile) ? finalProjectFile : null, stl: existsSync(finalStlFile) ? finalStlFile : null, screenshot: existsSync(screenshotFile) ? screenshotFile : null },
  }, null, 2));
}
