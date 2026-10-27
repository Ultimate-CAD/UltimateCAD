// Executes the real packaged/installed Electron app; does not start a development server.
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { testStdioMcp } from './mcp-smoke.mjs';
const exe = path.resolve(process.argv[2] || 'dist/windows/win-unpacked/Layerling Desktop.exe');
const out = path.resolve(process.env.LAYERLING_VALIDATION_DIR || 'dist/windows/validation');
const profile = path.join(out, 'profile with spaces');
mkdirSync(out, { recursive: true });
const checks = [], errors = [], requests = [], workers = [];
const record = (name, detail = '') => { checks.push({ name, result: 'PASS', detail }); console.log('PASS', name, detail); };
let app, page, connection, editorId;
let originalWasm, replacementPath, replacementHash;
if (process.env.LAYERLING_TEST_WASM_REPLACEMENT === '1') {
  replacementPath = path.join(path.dirname(exe), 'resources/runtime/apps/web/public/occt/5.8.0/occt-wasm.wasm');
  originalWasm = readFileSync(replacementPath);
  const name = Buffer.from('layerling-desktop-replacement-test');
  const customSection = Buffer.concat([Buffer.from([0, name.length + 1, name.length]), name]);
  const replacement = Buffer.concat([originalWasm, customSection]);
  writeFileSync(replacementPath, replacement);
  replacementHash = createHash('sha256').update(replacement).digest('hex');
}
const connect = () => JSON.parse(readFileSync(path.join(profile, 'connection.json'), 'utf8'));
async function launch() {
  app = await electron.launch({ executablePath: exe, cwd: out, timeout: 90000,
    args: process.env.LAYERLING_TEST_DPI ? [`--force-device-scale-factor=${process.env.LAYERLING_TEST_DPI}`] : [],
    env: { ...process.env, PATH: process.env.SystemRoot + '\\System32', ELECTRON_RUN_AS_NODE: undefined,
      LAYERLING_DESKTOP_PROFILE: profile, LAYERLING_DESKTOP_TEST: '1' } });
  page = await app.firstWindow({ timeout: 90000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  page.on('request', request => requests.push(request.url()));
  page.on('worker', worker => workers.push(worker.url()));
  await page.getByRole('button', { name: 'Create new 3D design', exact: true }).waitFor({ timeout: 60000 });
  connection = connect();
}
async function command(action, params = {}) {
  const response = await fetch(connection.url + '/api/layerling-mcp', { method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'command', editorId, action, params, timeoutMs: 120000 }), signal: AbortSignal.timeout(125000) });
  const result = await response.json();
  assert.ok(result.ok, `${action}: ${JSON.stringify(result)}`);
  return result.data;
}
async function editorReady() {
  for (let n = 0; n < 100; n++) {
    const response = await fetch(connection.url + '/api/layerling-mcp', { headers: { Authorization: `Bearer ${connection.token}` } });
    const result = await response.json();
    if (result.editors?.length && Date.now() - result.editors[0].lastSeen < 10000) {
      editorId = result.editors[0].editorId;
      return result.editors[0];
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Editor did not register with MCP');
}
try {
  await launch();
  record('Packaged executable launches with System32-only PATH, external cwd and profile containing spaces', exe);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
  });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  record('Renderer sandbox/context isolation and Node disabled');
  assert.equal((await fetch(connection.url)).status, 403);
  assert.equal((await fetch(connection.url + '/api/layerling-mcp')).status, 403);
  assert.equal((await fetch(connection.url, { headers: { Authorization: `Bearer ${connection.token}`, Origin: 'https://evil.example' } })).status, 403);
  record('Unauthenticated app/MCP and foreign origin requests rejected');
  await page.getByRole('button', { name: 'Create new 3D design', exact: true }).click();
  const editor = await editorReady();
  record('Production MCP editor discovery', editor.projectName);
  record('Bundled stdio MCP with no installed Node', JSON.stringify(await testStdioMcp(exe, profile)));
  // All external network traffic is denied by the shipped Electron session from startup.
  const externalBlocked = await page.evaluate(async () => {
    try { await fetch('https://example.com'); return false; } catch { return true; }
  });
  assert.equal(externalBlocked, true);
  record('External network access denied before modeling');
  const box = (await command('create_shape', { kind: 'box', name: 'Desktop acceptance box', width: 30, depth: 25, height: 20 })).object;
  assert.equal(box.dimensions.width, 30);
  record('Create primitive', box.id);
  const resized = await command('update_object', { id: box.id, width: 34 });
  assert.equal(resized.object.dimensions.width, 34);
  record('Modify dimensions', 'width 30 -> 34 mm');
  const hole = (await command('create_shape', { kind: 'cylinder', width: 10, depth: 10, height: 40, elevation: -5 })).object;
  const cut = await command('boolean_cut', { solidIds: [box.id], holeIds: [hole.id] });
  assert.ok(cut.object);
  record('Boolean subtraction through geometry worker', cut.object.id);
  const shellBox = (await command('create_shape', { kind: 'box', name: 'Desktop acceptance shell', width: 30, depth: 30, height: 25, x: 55 })).object;
  const shell = await command('hollow_object', { id: shellBox.id, thickness: 2, openings: 'top', edges: 'sharp' });
  assert.equal(shell.thickness, 2);
  record('OCCT WASM hollow operation', shell.object.id);
  if (replacementHash) {
    const response = await fetch(connection.url + '/occt/5.8.0/occt-wasm.wasm', { headers: { Authorization: `Bearer ${connection.token}` } });
    const servedHash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    assert.equal(servedHash, replacementHash);
    record('Replaceable LGPL WASM loads and hollows successfully', replacementHash);
  }
  const exported = {};
  for (const format of ['stl', 'obj', '3mf']) {
    const result = await command('export_mesh', { format });
    assert.ok(result.base64 && result.bytes > 0);
    writeFileSync(path.join(out, `acceptance.${format}`), Buffer.from(result.base64, 'base64'));
    exported[format] = result;
    record(`Export ${format.toUpperCase()}`, `${result.bytes} bytes`);
  }
  // Use the existing import pipeline, which parses the STL bytes in the installed renderer.
  const imported = await command('import_file', { fileName: 'acceptance.stl', base64: exported.stl.base64 });
  record('Import mesh through existing file pipeline', JSON.stringify(imported).slice(0, 200));
  const saved = await command('save_project', { history: 'all' });
  assert.ok(saved.base64 && saved.bytes > 0);
  const projectFile = path.join(out, 'acceptance.lyl');
  writeFileSync(projectFile, Buffer.from(saved.base64, 'base64'));
  record('Serialize editable LYL project', `${saved.bytes} bytes`);
  // Exercise the native browser download pipeline and STEP's production lazy kernel.
  await app.evaluate(({ session }, directory) => {
    session.fromPartition('persist:layerling').on('will-download', (_event, item) => {
      item.setSavePath(directory + '/' + item.getFilename());
    });
  }, out);
  await command('select_objects', { ids: [shellBox.id] });
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  await exportButton.click();
  await page.getByRole('radio', { name: /^STEP:/ }).click();
  await page.locator('.export-primary-button').click();
  let stepPath;
  const downloadDeadline = Date.now() + 120000;
  while (Date.now() < downloadDeadline) {
    const name = readdirSync(out).find(name => name.endsWith('.step'));
    if (name) {
      const candidate = path.join(out, name);
      if (readFileSync(candidate, 'utf8').includes('END-ISO-10303-21')) { stepPath = candidate; break; }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(stepPath, 'Native STEP download did not complete');
  assert.ok(existsSync(stepPath));
  assert.match(readFileSync(stepPath, 'utf8'), /ISO-10303-21/);
  record('STEP export via UI and native download', path.basename(stepPath));
  const scene = await command('get_scene');
  writeFileSync(path.join(out, 'scene-before-restart.json'), JSON.stringify(scene, null, 2));
  await page.screenshot({ path: path.join(out, 'installed-editor.png') });
  const dpi = await page.evaluate(() => ({ devicePixelRatio: window.devicePixelRatio, width: innerWidth, height: innerHeight, canvas: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight })) }));
  assert.ok(dpi.canvas.some(c => c.width > 0 && c.height > 0));
  record('Canvas renders at host DPI', JSON.stringify(dpi));
  const url = page.url();
  // The renderer auto-saves locally; Ctrl+S intentionally opens a native Save As
  // for a new unlinked design and is verified separately through Windows UI.
  await page.waitForTimeout(1500);
  const oldUrl = connection.url;
  await app.close(); app = null;
  assert.equal(existsSync(path.join(profile, 'connection.json')), false);
  let alive = false;
  try { await fetch(oldUrl, { signal: AbortSignal.timeout(1500) }); alive = true; } catch { /* stopped */ }
  assert.equal(alive, false);
  record('Shutdown removes connection secret and stops server');
  await launch();
  assert.equal(connection.url, oldUrl);
  await page.goto(url);
  await editorReady();
  const restored = await command('get_scene');
  writeFileSync(path.join(out, 'scene-after-restart.json'), JSON.stringify(restored, null, 2));
  assert.ok(JSON.stringify(restored).includes('Desktop acceptance shell'));
  record('Project/settings persist after executable restart');
  // Reopen the actual .lyl file through the dashboard's existing native file input.
  await page.goto(connection.url);
  await page.getByRole('button', { name: 'Open a design or import geometry', exact: true }).waitFor();
  await page.locator('input[type=file][accept*=".lyl"]').first().setInputFiles(projectFile);
  await editorReady();
  const reopened = await command('get_scene');
  assert.ok(JSON.stringify(reopened).includes('Desktop acceptance shell'));
  record('Reopen saved LYL via existing dashboard file input');
  const internal = requests.filter(url => url.startsWith(connection.url));
  record('Offline local asset requests', `${internal.length} loopback requests; external requests blocked by shipped session`);
  record('CAD workers started', JSON.stringify([...new Set(workers)].map(url => url.replace(connection.url, ''))));
  assert.deepEqual(errors, []);
  record('No renderer exceptions or failing local HTTP responses');
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    writeFileSync(path.join(out, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => 'unavailable'));
    writeFileSync(path.join(out, 'failure-buttons.json'), JSON.stringify(await page.getByRole('button').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, label: n.getAttribute('aria-label'), title: n.title }))).catch(() => []), null, 2));
  }
  checks.push({ name: 'Validation failure', result: 'FAIL', detail: error.stack });
  console.error(error);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  if (originalWasm) { writeFileSync(replacementPath, originalWasm); record('Original WASM restored after replacement verification', createHash('sha256').update(originalWasm).digest('hex')); }
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ executable: exe, checks, errors, requests, workers }, null, 2));
}
