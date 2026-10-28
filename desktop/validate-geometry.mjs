import { _electron as electron } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync, strFromU8 } from 'fflate';
import { BoxGeometry, SphereGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const args = process.argv.slice(2);
const baseline = args.includes('--baseline');
const executable = path.resolve(args.find(argument => argument.toLowerCase().endsWith('.exe')) || 'dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe');
const output = path.resolve(process.env.LAYERLING_GEOMETRY_VALIDATION_DIR || 'dist/ultimate/windows/geometry-validation');
const profile = path.join(output, 'private profile with spaces');
const resultPath = path.join(output, baseline ? 'baseline-results.json' : 'results.json');
mkdirSync(output, { recursive: true });

let app, page, connection, editorId, mainProcess;
const runId = randomUUID(), startedAt = new Date().toISOString();
const checks = [], errors = [], shutdowns = [], commandLatencies = [];
let heartbeat = null;
const executeFile = promisify(execFile);
const pass = (name, detail) => { checks.push({ name, result: 'PASS', detail }); console.log('PASS', name, detail || ''); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function indexedGeometryStl(positions, indices) {
  const triangles = indices.length / 3;
  const bytes = Buffer.alloc(84 + triangles * 50);
  bytes.write('Layerling dense geometry acceptance', 0, 'ascii');
  bytes.writeUInt32LE(triangles, 80);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let face = 0; face < triangles; face += 1) {
    const ids = indices.slice(face * 3, face * 3 + 3);
    const points = ids.map(index => positions.slice(index * 3, index * 3 + 3));
    const [a, b, c] = points;
    const u = b.map((value, axis) => value - a[axis]);
    const v = c.map((value, axis) => value - a[axis]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...normal) || 1;
    const offset = 84 + face * 50;
    normal.forEach((value, axis) => view.setFloat32(offset + axis * 4, value / length, true));
    points.flat().forEach((value, index) => view.setFloat32(offset + 12 + index * 4, value, true));
    view.setUint16(offset + 48, 0, true);
  }
  return { bytes, triangles };
}

function boxStl(divisions, splitFirstFaces = 0) {
  const geometry = new BoxGeometry(40, 30, 20, divisions, divisions, divisions);
  const positions = Array.from(geometry.attributes.position.array);
  const indices = Array.from(geometry.index.array);
  if (splitFirstFaces > 0) {
    const extra = [];
    for (let i = 0; i < splitFirstFaces * 3; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3), center = positions.length / 3;
      positions.push(...[0, 1, 2].map(axis => (positions[a * 3 + axis] + positions[b * 3 + axis] + positions[c * 3 + axis]) / 3));
      indices.splice(i, 3, a, b, center);
      extra.push(b, c, center, c, a, center);
    }
    indices.push(...extra);
  }
  geometry.dispose();
  return indexedGeometryStl(positions, indices);
}

function curvedSphereStl() {
  const geometry = new SphereGeometry(20, 128, 64);
  const positions = Array.from(geometry.attributes.position.array);
  const indices = Array.from(geometry.index.array);
  geometry.dispose();
  return indexedGeometryStl(positions, indices);
}

async function launch() {
  app = await electron.launch({ executablePath: executable, cwd: output, timeout: 90000, env: { ...process.env,
    ELECTRON_RUN_AS_NODE: undefined, PATH: process.env.SystemRoot + '\\System32',
    LAYERLING_DESKTOP_PROFILE: profile, LAYERLING_DESKTOP_TEST: '1' } });
  mainProcess = await app.evaluate(() => ({ pid: process.pid, parentPid: process.ppid, executable: process.execPath }));
  assert.equal(mainProcess.executable.toLowerCase(), executable.toLowerCase());
  assert.ok(Number.isInteger(mainProcess.pid) && mainProcess.pid > 0);
  page = await app.firstWindow({ timeout: 90000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Create new 3D design', exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Create new 3D design', exact: true }).click();
  connection = JSON.parse(readFileSync(path.join(profile, 'connection.json'), 'utf8'));
}

async function bounded(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function closeApplication() {
  if (!app) return;
  const closing = app, identity = mainProcess;
  app = null;
  const tracePath = path.join(output, `shutdown-${runId}-${shutdowns.length}.jsonl`);
  const result = { pid: identity.pid, mode: 'graceful', startedAt: new Date().toISOString(), tracePath };
  shutdowns.push(result);
  console.log('CLOSE begin', identity.pid);
  try {
    await bounded(closing.evaluate(({ app, BrowserWindow }, tracePath) => {
      const fs = process.getBuiltinModule('fs');
      const trace = event => fs.appendFileSync(tracePath, JSON.stringify({ event, at: new Date().toISOString() }) + '\n');
      app.on('before-quit', () => trace('before-quit'));
      app.on('will-quit', () => trace('will-quit'));
      for (const window of BrowserWindow.getAllWindows()) window.webContents.on('will-prevent-unload', () => trace('will-prevent-unload'));
      let attempts = 0;
      const retry = setInterval(() => { if (++attempts > 8) return clearInterval(retry); trace('quit-retry'); app.quit(); }, 1000);
    }, tracePath), 5000, 'Could not prepare graceful shutdown');
    await bounded(closing.close(), 12000, 'Electron graceful close timed out');
  } catch (error) {
    result.mode = 'verified-owned-tree-fallback'; result.reason = error.message;
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
    throw new Error(`Packaged application required shutdown fallback: ${error.message}`);
  } finally {
    result.finishedAt = new Date().toISOString();
    result.events = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    console.log('CLOSE complete', identity.pid, result.mode, result.events.map(item => item.event).join(','));
  }
}

async function editorReady() {
  for (let n = 0; n < 150; n += 1) {
    const response = await fetch(connection.url + '/api/layerling-mcp', { headers: { Authorization: `Bearer ${connection.token}` } });
    const result = await response.json();
    if (result.editors?.length && Date.now() - result.editors[0].lastSeen < 10000) {
      editorId = result.editors[0].editorId;
      return result.editors[0];
    }
    await pause(200);
  }
  throw new Error('Editor did not register with MCP');
}

async function commandResponse(action, params = {}) {
  const started = performance.now();
  try {
    const response = await fetch(connection.url + '/api/layerling-mcp', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'command', editorId, action, params, timeoutMs: 180000 }), signal: AbortSignal.timeout(185000) });
    const result = await response.json();
    commandLatencies.push({ action, ms: performance.now() - started, httpStatus: response.status, ok: result.ok });
    return result;
  } catch (error) {
    commandLatencies.push({ action, ms: performance.now() - started, error: error.message });
    throw error;
  }
}
async function command(action, params = {}) {
  const result = await commandResponse(action, params);
  assert.ok(result.ok, `${action}: ${JSON.stringify(result)}`);
  return result.data;
}

async function waitForMesh(triangles) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const scene = await command('list_objects');
    const object = scene.objects.find(candidate => candidate.kind === 'mesh' && candidate.importedTriangles === triangles);
    if (object) return object;
    await pause(250);
  }
  throw new Error(`Imported mesh with ${triangles} triangles did not appear`);
}

async function waitForShape(id, predicate, message) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const scene = await command('list_objects');
    const object = scene.objects.find(candidate => candidate.id === id);
    if (object && predicate(object)) return object;
    await pause(200);
  }
  throw new Error(message);
}

async function importMesh(triangles, generated) {
  assert.equal(generated.triangles, triangles);
  const file = path.join(output, `dense-box-${triangles}.stl`);
  writeFileSync(file, generated.bytes);
  await page.locator('input[type=file][accept*=".stl"]').first().setInputFiles(file);
  const object = await waitForMesh(triangles);
  pass(`Dashboard STL import retains ${triangles} input triangles`, { id: object.id, kind: object.kind, triangles: object.importedTriangles });
  return object;
}

function validateManufacturingStl(bytes) {
  const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const position = geometry.getAttribute('position');
  assert.ok(position.count > 0 && position.count % 3 === 0);
  const edges = new Map(); let volume = 0;
  const point = i => [position.getX(i), position.getY(i), position.getZ(i)];
  const key = p => p.map(n => Math.round(n * 10000)).join(',');
  for (let i = 0; i < position.count; i += 3) {
    const [a, b, c] = [point(i), point(i + 1), point(i + 2)];
    assert.ok([...a, ...b, ...c].every(Number.isFinite));
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const edge = [key(u), key(v)].sort().join('|');
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }
  }
  const result = { triangles: position.count / 3, volume: Math.abs(volume), boundaryEdges: [...edges.values()].filter(count => count !== 2).length };
  geometry.dispose();
  assert.ok(result.volume > 0.001, 'Manufacturing STL has no positive volume');
  assert.equal(result.boundaryEdges, 0, 'Manufacturing STL has unmatched triangle edges');
  return result;
}

async function startHeartbeat() {
  await page.evaluate(() => {
    const state = { frames: 0, maxGapMs: 0, last: performance.now(), raf: 0, stop: false };
    const tick = now => {
      state.maxGapMs = Math.max(state.maxGapMs, now - state.last);
      state.last = now; state.frames += 1;
      if (!state.stop) state.raf = requestAnimationFrame(tick);
    };
    window.__geometryHeartbeat = state;
    state.raf = requestAnimationFrame(tick);
  });
}
async function stopHeartbeat() {
  if (!page) return null;
  return page.evaluate(() => {
    const state = window.__geometryHeartbeat;
    if (!state) return null;
    state.stop = true; cancelAnimationFrame(state.raf);
    return { frames: state.frames, maxGapMs: state.maxGapMs };
  });
}

async function runBaseline() {
  await editorReady();
  const object = await importMesh(14772, boxStl(35, 36));
  const result = await commandResponse('list_edges', { id: object.id });
  assert.equal(result.ok, false, `Baseline unexpectedly prepared 14,772 triangles: ${JSON.stringify(result)}`);
  assert.match(JSON.stringify(result), /4000/);
  pass('Pre-change 14,772-triangle list_edges guard reports its 4,000-triangle limit', result);
}

async function runCurrent() {
  await editorReady();
  const acceptance = await importMesh(14772, boxStl(35, 36));
  const acceptanceEdges = await command('list_edges', { id: acceptance.id });
  assert.equal(acceptanceEdges.selectableEdgeIds.length, 12);
  const accepted = await command('apply_edge_treatment', { id: acceptance.id, kind: 'chamfer', amount: 0.5, edgeIds: 'all' });
  assert.equal(accepted.object.id, acceptance.id);
  pass('14,772-triangle imported mesh supports actual chamfer with stable identity');
  const object = await importMesh(20172, boxStl(41));
  const { id } = object;
  await startHeartbeat();

  const edgeResult = await command('list_edges', { id });
  assert.equal(edgeResult.object.id, id);
  assert.equal(edgeResult.edges.length, 12);
  assert.equal(edgeResult.selectableEdgeIds.length, 12);
  pass('20,172-triangle box reduces to 12 selectable CAD edges', { edges: edgeResult.edges.length, selectable: edgeResult.selectableEdgeIds.length });

  const curvedMesh = curvedSphereStl();
  const curvedObject = await importMesh(curvedMesh.triangles, curvedMesh);
  const originalMesh = await command('export_mesh', { format: 'stl', ids: [curvedObject.id] });
  const originalMeshHash = createHash('sha256').update(Buffer.from(originalMesh.base64, 'base64')).digest('hex');
  await command('select_objects', { ids: [curvedObject.id] });
  await page.getByRole('button', { name: 'Fillet', exact: true }).click();
  const cancelFillet = page.getByRole('button', { name: 'Cancel fillet', exact: true });
  await cancelFillet.waitFor({ state: 'visible' });
  const panelText = await page.locator('.edge-modifier-panel').innerText();
  assert.match(panelText, /Preparing edges/i, 'Cancellation must occur while the worker is preparing edges');
  await cancelFillet.click();
  await waitForShape(curvedObject.id, current => current.edgeTreatments.length === 0, 'Canceled edge preparation changed the object');
  await pause(1200);
  const afterCancel = await waitForShape(curvedObject.id, current => current.edgeTreatments.length === 0, 'A canceled worker committed late');
  assert.equal(afterCancel.id, curvedObject.id);
  const unchangedMesh = await command('export_mesh', { format: 'stl', ids: [curvedObject.id] });
  const unchangedMeshHash = createHash('sha256').update(Buffer.from(unchangedMesh.base64, 'base64')).digest('hex');
  assert.equal(unchangedMeshHash, originalMeshHash, 'Canceled worker changed the source mesh');
  const restartedEdges = await command('list_edges', { id });
  assert.equal(restartedEdges.object.id, id, 'CAD worker did not restart after cancellation');
  assert.equal(restartedEdges.edges.length, 12);
  pass('Cancel during curved-mesh worker preparation terminates/restarts the worker without changing source id or mesh', { id: curvedObject.id, triangles: curvedObject.importedTriangles, status: panelText.match(/Preparing edges[^\n]*/i)?.[0], meshSha256: unchangedMeshHash, recoveredBoxEdges: restartedEdges.edges.length });

  await command('select_objects', { ids: [id] });
  const applied = await command('apply_edge_treatment', { id, kind: 'fillet', amount: 1, edgeIds: 'all' });
  assert.equal(applied.object.id, id);
  assert.equal(applied.object.edgeTreatments.at(-1).kind, 'fillet');
  pass('Apply all-edge fillet preserves object identity', { id, edgeIds: applied.object.edgeTreatments.at(-1).edgeIds });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitForShape(id, current => current.edgeTreatments.length === 0, 'Undo did not remove the fillet');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await waitForShape(id, current => current.edgeTreatments.at(-1)?.kind === 'fillet', 'Redo did not restore the fillet');
  pass('Fillet can be undone and redone in the packaged UI');

  const hollow = await command('hollow_object', { id, thickness: 2, openings: 'none', edges: 'sharp', direction: 'outward', tolerance: 1e-6 });
  assert.equal(hollow.object.id, id);
  assert.equal(hollow.direction, 'outward');
  assert.equal(hollow.tolerance, 1e-6);
  const savedFeature = hollow.object.edgeTreatments.at(-1);
  assert.deepEqual(savedFeature.shellOptions, { direction: 'outward', tolerance: 1e-6 });
  pass('Closed sharp hollow preserves outward direction and tolerance', { id, options: savedFeature.shellOptions });

  const saved = await command('save_project', { history: 'all' });
  const projectFile = path.join(output, 'geometry-roundtrip.lyl');
  const projectBytes = Buffer.from(saved.base64, 'base64');
  writeFileSync(projectFile, projectBytes);
  const project = JSON.parse(strFromU8(unzipSync(projectBytes)['project.json']));
  const hollowNode = project.features.find(feature => feature.type === 'shell');
  assert.ok(hollowNode, 'Saved LYL package has no shell feature');
  assert.deepEqual(hollowNode.parameters.shellOptions, { direction: 'outward', tolerance: 1e-6 });
  pass('Saved LYL feature contains shell options', { bytes: projectBytes.length, shellOptions: hollowNode.parameters.shellOptions });

  const exported = await command('export_mesh', { format: 'stl', ids: [id] });
  const stl = Buffer.from(exported.base64, 'base64');
  const mesh = validateManufacturingStl(stl);
  writeFileSync(path.join(output, 'geometry-hollow.stl'), stl);
  pass('Hollow STL has finite triangles, positive volume, and closed edges', mesh);

  heartbeat = await stopHeartbeat();
  const savedSummary = hollow.object;
  await closeApplication();
  await launch();
  await editorReady();
  await page.locator('input[type=file][accept*=".lyl"]').first().setInputFiles(projectFile);
  const restored = await waitForShape(id, current => current.edgeTreatments.some(feature => feature.kind === 'shell'), 'Saved geometry project did not restore its hollowed object');
  const restoredShell = restored.edgeTreatments.find(feature => feature.kind === 'shell');
  assert.deepEqual(restoredShell.shellOptions, { direction: 'outward', tolerance: 1e-6 });
  assert.equal(restored.id, savedSummary.id);
  assert.equal(restored.color, savedSummary.color);
  assert.deepEqual(restored.position, savedSummary.position);
  assert.deepEqual(restored.rotation, savedSummary.rotation);
  assert.deepEqual(restored.dimensions, savedSummary.dimensions);
  pass('Closing and reopening the saved LYL retains shell options, CAD object id, transform, and color', { id: restored.id, shellOptions: restoredShell.shellOptions });
  return { mesh, savedBytes: projectBytes.length };
}

try {
  await launch();
  pass('Packaged executable launches with System32-only PATH and isolated geometry-validation profile', { executable, pid: mainProcess.pid, mode: baseline ? 'baseline' : 'current' });
  if (baseline) await runBaseline();
  else await runCurrent();
  assert.deepEqual(errors, []);
  pass('No renderer exceptions during geometry workflow');
} catch (error) {
  console.error(error);
  errors.push({ message: error.message, stack: error.stack });
  checks.push({ name: 'Validation failure', result: 'FAIL', detail: error.stack });
  process.exitCode = 1;
  if (page) {
    await page.screenshot({ path: path.join(output, `${baseline ? 'baseline-' : ''}failure.png`) }).catch(() => {});
    writeFileSync(path.join(output, `${baseline ? 'baseline-' : ''}failure-dom.txt`), await page.locator('body').innerText().catch(() => ''));
  }
} finally {
  heartbeat ??= await stopHeartbeat().catch(() => null);
  const report = finishedAt => writeFileSync(resultPath, JSON.stringify({ runId, mode: baseline ? 'baseline' : 'current', startedAt, finishedAt, executable, checks, errors, commandLatencies, heartbeat, shutdowns }, null, 2));
  report(null);
  try { await closeApplication(); }
  catch (error) { console.error(error); errors.push({ message: error.message, stack: error.stack }); checks.push({ name: 'Packaged application shutdown', result: 'FAIL', detail: error.stack }); process.exitCode = 1; }
  report(new Date().toISOString());
  console.log('REPORT', resultPath);
}
