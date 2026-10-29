import { _electron as electron } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const executable = path.resolve(process.argv.slice(2).find((value) => value.toLowerCase().endsWith(".exe")) || "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe");
const output = path.resolve(process.env.LAYERLING_VIEWPORT_BENCH_DIR || "dist/ultimate/windows/viewport-benchmark");
const requestedTiers = (process.env.LAYERLING_VIEWPORT_TIERS || "100000").split(",").map((value) => Number(value.trim())).filter((value) => [100000, 500000, 2000000].includes(value));
const tiers = [...new Set(requestedTiers)];
if (!tiers.length) throw Error("LAYERLING_VIEWPORT_TIERS must include 100000, 500000, or 2000000");
mkdirSync(output, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
const stats = (values) => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: values.length ? Math.max(...values) : null });
const hotspots = (profile) => {
  const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, samples]) => { const frame = nodes.get(id)?.callFrame || {}; return { functionName: frame.functionName || "(anonymous)", url: frame.url, lineNumber: frame.lineNumber, samples }; });
};

export function collarStl(triangleCount) {
  // A closed, hollow collar: outer and inner cylindrical walls plus annular ends.
  const segments = triangleCount === 100000 ? 100 : triangleCount === 500000 ? 500 : 1000;
  const rows = triangleCount / (4 * segments);
  const facetCount = 4 * segments * rows;
  const bytes = Buffer.allocUnsafe(84 + facetCount * 50);
  bytes.write("Layerling viewport benchmark collar", 0, "ascii");
  bytes.writeUInt32LE(facetCount, 80);
  const coord = (ring, row, segment) => {
    const angle = (segment % segments) * Math.PI * 2 / segments;
    const radius = ring === 0 ? 12 + .8 * Math.sin(row * Math.PI / Math.max(1, rows - 1)) : 8;
    return [radius * Math.cos(angle), (row / Math.max(1, rows - 1)) * 30, radius * Math.sin(angle)];
  };
  let offset = 84;
  const writeTriangle = (a, b, c) => {
    const u = b.map((value, i) => value - a[i]), v = c.map((value, i) => value - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n) || 1;
    for (const value of n) { bytes.writeFloatLE(value / length, offset); offset += 4; }
    for (const point of [a, b, c]) for (const value of point) { bytes.writeFloatLE(value, offset); offset += 4; }
    bytes.writeUInt16LE(0, offset); offset += 2;
  };
  for (let y = 0; y < rows - 1; y++) for (let j = 0; j < segments; j++) {
    const j1 = (j + 1) % segments;
    const o0 = coord(0, y, j), o1 = coord(0, y, j1), o2 = coord(0, y + 1, j), o3 = coord(0, y + 1, j1);
    const i0 = coord(1, y, j), i1 = coord(1, y, j1), i2 = coord(1, y + 1, j), i3 = coord(1, y + 1, j1);
    writeTriangle(o0, o2, o1); writeTriangle(o1, o2, o3);
    writeTriangle(i0, i1, i2); writeTriangle(i1, i3, i2);
  }
  for (let j = 0; j < segments; j++) {
    const j1 = (j + 1) % segments;
    const ob0 = coord(0, 0, j), ob1 = coord(0, 0, j1), ib0 = coord(1, 0, j), ib1 = coord(1, 0, j1);
    const ot0 = coord(0, rows - 1, j), ot1 = coord(0, rows - 1, j1), it0 = coord(1, rows - 1, j), it1 = coord(1, rows - 1, j1);
    writeTriangle(ob0, ob1, ib0); writeTriangle(ob1, ib1, ib0);
    writeTriangle(ot0, it0, ot1); writeTriangle(ot1, it0, it1);
  }
  if (offset !== bytes.length) throw Error(`STL size mismatch ${offset} != ${bytes.length}`);
  return bytes;
}

const instrumentation = `(() => {
  const data = { frames: [], longTasks: [], worker: [], gpu: { frames: [], live: { buffers: 0, textures: 0, programs: 0, shaders: 0, framebuffers: 0, renderbuffers: 0, vertexArrays: 0 } }, perf: [] };
  Object.defineProperty(window, '__viewportBench', { value: data });
  let previous = null, draws = { arrays: 0, elements: 0, instances: 0 };
  const recordFrame = (timestamp) => {
    if (previous !== null) data.frames.push({ at: timestamp, delta: timestamp - previous });
    previous = timestamp;
    data.gpu.frames.push({ at: timestamp, ...draws, live: { ...data.gpu.live } });
    draws = { arrays: 0, elements: 0, instances: 0 };
  };
  const raf = window.requestAnimationFrame.bind(window);
  const sampleFrame = (timestamp) => { recordFrame(timestamp); raf(sampleFrame); };
  raf(sampleFrame);
  try { new PerformanceObserver((list) => data.longTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })))) .observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((list) => data.perf.push(...list.getEntries().map((entry) => ({ name: entry.name, duration: entry.duration, start: entry.startTime })))) .observe({ type: 'measure', buffered: true }); } catch {}
  const byteSize = (value, depth = 0) => { try { if (value == null || depth > 2) return 0; if (typeof value === 'string') return value.length * 2; if (value.byteLength != null) return value.byteLength; if (ArrayBuffer.isView(value)) return value.byteLength; if (Array.isArray(value)) return value.length * (value.length ? Math.max(1, byteSize(value[0], depth + 1)) : 8); if (typeof value === 'object') { const keys = Object.keys(value).slice(0, 20); return keys.reduce((sum, key) => sum + key.length * 2 + byteSize(value[key], depth + 1), 0); } return 8; } catch { return null; } };
  const logWorker = (direction, name, message) => { let keys = [], type = null; try { keys = Object.keys(message || {}).slice(0, 30); type = message?.type ?? message?.kind ?? message?.action ?? null; } catch {} data.worker.push({ direction, name, at: performance.now(), type, keys, bytes: byteSize(message) }); };
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, { construct(Target, args) { const worker = Reflect.construct(Target, args); const name = worker.name || String(args[0]); const add = worker.addEventListener.bind(worker); add('message', (event) => logWorker('receive', name, event.data), true); worker.addEventListener = function(type, listener, options) { if (type === 'message') { const wrapped = typeof listener === 'function' ? (event) => listener.call(this, event) : { handleEvent(event) { return listener.handleEvent(event); } }; return add(type, wrapped, options); } return add(type, listener, options); }; const post = worker.postMessage.bind(worker); worker.postMessage = (message, transfer) => { logWorker('send', name, message); return transfer === undefined ? post(message) : post(message, transfer); }; return worker; } });
  const kinds = { createBuffer: 'buffers', deleteBuffer: 'buffers', createTexture: 'textures', deleteTexture: 'textures', createProgram: 'programs', deleteProgram: 'programs', createShader: 'shaders', deleteShader: 'shaders', createFramebuffer: 'framebuffers', deleteFramebuffer: 'framebuffers', createRenderbuffer: 'renderbuffers', deleteRenderbuffer: 'renderbuffers', createVertexArray: 'vertexArrays', deleteVertexArray: 'vertexArrays' };
  for (const prototype of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype].filter(Boolean)) {
    for (const method of ['drawArrays', 'drawArraysInstanced', 'drawElements', 'drawElementsInstanced']) { const original = prototype[method]; if (original) prototype[method] = function(...args) { if (method.includes('Instanced')) draws.instances++; else if (method.includes('Elements')) draws.elements++; else draws.arrays++; return original.apply(this, args); }; }
    for (const [method, kind] of Object.entries(kinds)) { const original = prototype[method]; if (original) prototype[method] = function(...args) { const result = original.apply(this, args); if (method.startsWith('create') && result) data.gpu.live[kind]++; else if (method.startsWith('delete') && args[0]) data.gpu.live[kind] = Math.max(0, data.gpu.live[kind] - 1); return result; }; }
  }
})();`;

async function runTier(triangles) {
  const runDir = path.join(output, `${triangles}-${Date.now()}`), profile = path.join(runDir, "isolated-profile");
  mkdirSync(runDir, { recursive: true });
  const fixture = path.join(runDir, `collar-${triangles}.stl`);
  const stl = collarStl(triangles); writeFileSync(fixture, stl);
  const report = { tier: triangles, fixture: { path: fixture, bytes: stl.length, triangles: stl.readUInt32LE(80) }, startedAt: new Date().toISOString(), actions: [], errors: [], limitations: [], runtime: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, executable }, instrumentationOverhead: "Same initScript hooks are active throughout the run; draw/resource counters are page-side instrumentation, not renderer.info." };
  let app, page, connection, editorId;
  const command = async (action, params = {}) => {
    const response = await fetch(connection.url + "/api/layerling-mcp", { method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "command", editorId, action, params, timeoutMs: 60000 }), signal: AbortSignal.timeout(70000) });
    const result = await response.json(); if (!result.ok) throw Error(`${action}: ${JSON.stringify(result)}`); return result.data;
  };
  const readyEditor = async (projectName) => {
    const end = Date.now() + 30000;
    while (Date.now() < end) { const result = await fetch(connection.url + "/api/layerling-mcp", { headers: { Authorization: `Bearer ${connection.token}` } }); const json = await result.json(); const editor = json.editors?.filter((entry) => Date.now() - entry.lastSeen < 10000 && (!projectName || entry.projectName === projectName)).sort((a, b) => b.lastSeen - a.lastSeen)[0]; if (editor) { editorId = editor.editorId; return editor; } await pause(200); }
    throw Error("No fresh Layerling MCP editor appeared within 30 seconds");
  };
  try {
    console.log(`BENCH tier=${triangles} stage=launch executable=${executable}`);
    app = await electron.launch({ executablePath: executable, cwd: runDir, timeout: 90000, args: ["--window-size=1424,900", "--force-device-scale-factor=1"], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PATH: process.env.SystemRoot + "\\System32", LAYERLING_DESKTOP_PROFILE: profile, LAYERLING_DESKTOP_TEST: "1" } });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1424, height: 900 });
    await page.addInitScript(instrumentation);
    page.on("pageerror", (error) => report.errors.push(error.message));
    if (!(await page.evaluate(() => Boolean(window.__viewportBench)).catch(() => false))) await page.evaluate((source) => (0, eval)(source), instrumentation);
    await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor({ timeout: 90000 });
    let instrumentationState = await page.evaluate(() => ({ active: Boolean(window.__viewportBench), devicePixelRatio, viewport: { width: innerWidth, height: innerHeight } }));
    if (!instrumentationState.active) {
      await page.evaluate((source) => (0, eval)(source), instrumentation);
      instrumentationState = await page.evaluate(() => ({ active: Boolean(window.__viewportBench), injectedInCurrentDocument: true, devicePixelRatio, viewport: { width: innerWidth, height: innerHeight } }));
    }
    if (!instrumentationState.active) throw Error("Page instrumentation was not installed in the isolated app document");
    report.instrumentationState = instrumentationState;
    console.log(`BENCH tier=${triangles} stage=instrumented viewport=${instrumentationState.viewport.width}x${instrumentationState.viewport.height} dpr=${instrumentationState.devicePixelRatio}`);
    connection = JSON.parse(readFileSync(path.join(profile, "connection.json"), "utf8"));
    await page.getByRole("button", { name: "Create new 3D design", exact: true }).click(); await readyEditor();
    await page.locator('input[type="file"][accept*=".stl"]').first().setInputFiles(fixture); await readyEditor(`collar-${triangles}`);
    const objectDeadline = Date.now() + (triangles >= 2000000 ? 180000 : 90000); let object;
    while (Date.now() < objectDeadline) { object = (await command("list_objects")).objects.find((entry) => entry.importedTriangles === triangles); if (object) break; await pause(400); }
    if (!object) throw Error(`Imported object with ${triangles} triangles not listed before deadline`);
    report.imported = { id: object.id, triangles: object.importedTriangles };
    console.log(`BENCH tier=${triangles} stage=imported triangles=${object.importedTriangles}`);
    const mainCanvas = page.locator("canvas").first(), mainBox = await mainCanvas.boundingBox();
    if (!mainBox) throw Error("Main viewport canvas missing");
    const center = { x: mainBox.x + mainBox.width / 2, y: mainBox.y + mainBox.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    const action = async (name, fn) => {
      await cdp.send("Profiler.start");
      const started = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame((t) => resolve({ at: t, frameCount: window.__viewportBench.frames.length, longTaskCount: window.__viewportBench.longTasks.length }))));
      const wallStart = Date.now(); await fn();
      const ended = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame((t) => resolve({ at: t, frameCount: window.__viewportBench.frames.length, longTaskCount: window.__viewportBench.longTasks.length }))));
      const stopped = await cdp.send("Profiler.stop");
      const profileFile = path.join(runDir, `${name}.cpuprofile`); writeFileSync(profileFile, JSON.stringify(stopped.profile));
      const interval = await page.evaluate(({ start, end }) => ({ frames: window.__viewportBench.frames.slice(start.frameCount, end.frameCount), longTasks: window.__viewportBench.longTasks.slice(start.longTaskCount, end.longTaskCount) }), { start: started, end: ended });
      const deltas = interval.frames.map((frame) => frame.delta).filter((delta) => delta > 0 && delta < 1000);
      const meanDeltaMs = deltas.length ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length : null;
      const targetFrameMs = 1000 / 60;
      const droppedFrames = deltas.reduce((sum, delta) => sum + Math.max(0, Math.ceil(delta / targetFrameMs) - 1), 0);
      report.actions.push({ name, startedAt: started.at, endedAt: ended.at, fromRafMs: ended.at - started.at, wallMs: Date.now() - wallStart, frameStats: { sampleCount: deltas.length, meanDeltaMs, averageFps: meanDeltaMs ? 1000 / meanDeltaMs : null, targetFps: 60, targetFrameMs, droppedFrames, deltaMs: stats(deltas) }, longTasksMs: stats(interval.longTasks.map((entry) => entry.duration)), cpuProfile: profileFile, topHotspots: hotspots(stopped.profile) });
      console.log(`BENCH tier=${triangles} stage=action name=${name} frames=${deltas.length} avgFps=${meanDeltaMs ? (1000 / meanDeltaMs).toFixed(1) : "n/a"}`);
    };
    await action("select-body", async () => { await page.mouse.click(center.x, center.y); });
    await command("select_objects", { ids: [object.id] });
    await action("orbit-fixed-right-drag", async () => { await page.mouse.move(center.x, center.y); await page.mouse.down({ button: "right" }); await page.mouse.move(center.x + 96, center.y + 38, { steps: 12 }); await page.mouse.up({ button: "right" }); });
    await action("pan-fixed-middle-drag", async () => { await page.mouse.move(center.x, center.y); await page.mouse.down({ button: "middle" }); await page.mouse.move(center.x + 48, center.y + 24, { steps: 8 }); await page.mouse.up({ button: "middle" }); });
    await action("zoom-fixed-wheel", async () => { await page.mouse.move(center.x, center.y); await page.mouse.wheel(0, -160); });
    await action("idle-main-2s", async () => pause(2000));
    const smoothSessionCount = process.env.LAYERLING_VIEWPORT_SKIP_SESSIONS === "1" ? 0 : triangles >= 2000000 ? 1 : 3;
    const sessionSnapshot = async () => page.evaluate(() => ({ at: performance.now(), heap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null, gpuLive: { ...(window.__viewportBench?.gpu?.live || {}) } }));
    report.smoothMeshSessions = [];
    if (smoothSessionCount === 0) report.sessionMeasurementsReusedFrom = { "100000": ".codex-run/viewport7/baseline/100000-1793244850474/report.json", "500000": ".codex-run/viewport7/baseline/500000-1793244983447/report.json", "2000000": ".codex-run/viewport7/baseline/2000000-1793245050669/report.json" }[String(triangles)];
    for (let index = 0; index < smoothSessionCount; index++) {
      const openedAt = Date.now();
      const beforeSnapshot = await sessionSnapshot();
      await page.getByRole("button", { name: "Smooth Mesh", exact: true }).click();
      const sessionDialog = page.getByRole("dialog", { name: "Smooth Mesh" });
      const sessionDeadline = Date.now() + (triangles >= 2000000 ? 120000 : 45000);
      while (Date.now() < sessionDeadline && !(await sessionDialog.count())) await pause(200);
      if (!(await sessionDialog.count())) { report.smoothMeshSessions.push({ index: index + 1, state: "open-timeout", elapsedMs: Date.now() - openedAt }); continue; }
      let state = "deadline";
      try { state = await page.waitForFunction(() => { const d = document.querySelector('[role="dialog"][aria-label="Smooth Mesh"]'); const alert = d?.querySelector('[role="alert"]')?.textContent?.trim(); const preview = [...(d?.querySelectorAll("button") || [])].find((button) => button.textContent?.trim() === "Preview"); return alert ? `error:${alert}` : preview && !preview.disabled ? "ready" : false; }, null, { timeout: triangles >= 2000000 ? 120000 : 45000 }).then((handle) => handle.jsonValue()); } catch {}
      const openSnapshot = await sessionSnapshot();
      const cancel = sessionDialog.getByRole("button", { name: "Cancel", exact: true });
      if (await cancel.count()) await cancel.click(); else await page.keyboard.press("Escape");
      await sessionDialog.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      const closedSnapshot = await sessionSnapshot();
      report.smoothMeshSessions.push({ index: index + 1, state, elapsedMs: Date.now() - openedAt, beforeSnapshot, openSnapshot, closedSnapshot, gpuLiveLeakDelta: Object.fromEntries(Object.keys(beforeSnapshot.gpuLive).map((key) => [key, closedSnapshot.gpuLive[key] - beforeSnapshot.gpuLive[key]])), heapUsedDelta: beforeSnapshot.heap && closedSnapshot.heap ? closedSnapshot.heap.used - beforeSnapshot.heap.used : null });
      if (state.startsWith("error:")) report.limitations.push(`Smooth Mesh session ${index + 1} capability refusal: ${state.slice(6)}`);
      if (state === "deadline") report.limitations.push(`Smooth Mesh session ${index + 1} remained unverified until the ${triangles >= 2000000 ? 120 : 45}s readiness deadline`);
    }
    await page.getByRole("button", { name: "Smooth Mesh", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Smooth Mesh" });
    const dialogDeadline = Date.now() + (triangles >= 2000000 ? 120000 : 60000);
    while (Date.now() < dialogDeadline && !(await dialog.count())) await pause(250);
    if (!(await dialog.count())) throw Error("Smooth Mesh dialog did not open before deadline");
    const canvas = dialog.locator("canvas"); await canvas.waitFor({ timeout: 30000 });
    const canvasBox = await canvas.boundingBox(); if (!canvasBox) throw Error("Smooth Mesh canvas has no bounds");
    let smoothReadyState = "deadline";
    try {
      smoothReadyState = await page.waitForFunction(() => { const d = document.querySelector('[role="dialog"][aria-label="Smooth Mesh"]'); const alert = d?.querySelector('[role="alert"]')?.textContent?.trim(); const preview = [...(d?.querySelectorAll("button") || [])].find((button) => button.textContent?.trim() === "Preview"); return alert ? `error:${alert}` : preview && !preview.disabled ? "ready" : false; }, null, { timeout: triangles >= 2000000 ? 120000 : 45000 }).then((handle) => handle.jsonValue());
    } catch {}
    report.smoothMeshReady = smoothReadyState;
    if (smoothReadyState.startsWith("error:")) report.limitations.push(`Smooth Mesh capability refusal: ${smoothReadyState.slice(6)}`);
    if (smoothReadyState === "deadline") report.limitations.push(`Smooth Mesh readiness was unverified: Preview never enabled and no named error appeared before ${triangles >= 2000000 ? 120 : 45}s deadline`);
    const brushPoint = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
    if (smoothReadyState === "ready") {
      await action("idle-smoothmesh-2s", async () => pause(2000));
      const workerStart = await page.evaluate(() => window.__viewportBench.worker.length);
      const paintStarted = await page.evaluate(() => performance.now());
      await action("smooth-brush-paint-center", async () => { await page.mouse.move(brushPoint.x, brushPoint.y); await page.mouse.down(); await page.mouse.move(brushPoint.x + 14, brushPoint.y, { steps: 3 }); await page.mouse.up(); });
      const selectionDeadline = Date.now() + (triangles >= 2000000 ? 120000 : 45000);
      let selectionReply = null;
      while (Date.now() < selectionDeadline) {
        selectionReply = await page.evaluate((start) => window.__viewportBench.worker.slice(start).find((message) => message.direction === "receive" && /select/i.test(String(message.type || message.keys.join(" ")))) || null, workerStart);
        if (selectionReply) break; await pause(100);
      }
      report.selectionReply = selectionReply ? { type: selectionReply.type, at: selectionReply.at, latencyMs: selectionReply.at - paintStarted } : null;
      if (!selectionReply) report.limitations.push("No worker receive message with a selection-like type was observed after brush paint before deadline");
      const previewStarted = await page.evaluate(() => performance.now());
      await action("smooth-preview", async () => { const preview = dialog.getByRole("button", { name: "Preview", exact: true }); if (await preview.isEnabled().catch(() => false)) await preview.click(); });
      const previewDeadline = Date.now() + (triangles >= 2000000 ? 180000 : 90000);
      let previewState = "timeout";
      while (Date.now() < previewDeadline) {
        previewState = await dialog.evaluate((node) => { const alert = node.querySelector('[role="alert"]')?.textContent?.trim(); const button = [...node.querySelectorAll("button")].find((item) => item.textContent?.includes("Apply smoothing")); return alert ? `error:${alert}` : button && !button.disabled ? "ready" : "pending"; });
        if (previewState !== "pending") break; await pause(150);
      }
      if (previewState.startsWith("error:")) report.limitations.push(`Preview capability refusal: ${previewState.slice(6)}`);
      if (previewState === "timeout") report.limitations.push(`Preview did not return a ready or named error state within ${triangles >= 2000000 ? 180 : 90}s`);
      report.actionReplies = await page.evaluate(({ workerStart, previewStarted }) => {
        const worker = window.__viewportBench.worker.slice(workerStart);
        const previewReply = worker.find((message) => message.direction === "receive" && /preview/i.test(String(message.type || message.keys.join(" "))));
        return { worker, previewReply: previewReply ? { type: previewReply.type, at: previewReply.at, latencyMs: previewReply.at - previewStarted } : null };
      }, { workerStart, previewStarted });
    } else {
      report.actionReplies = { skipped: true, reason: smoothReadyState };
      report.limitations.push("Brush and preview actions skipped because Smooth Mesh did not reach ready state");
    }
    await page.screenshot({ path: path.join(runDir, "viewport-benchmark.png"), fullPage: false });
    await pause(250);
    report.page = await page.evaluate(() => {
      const data = window.__viewportBench || {};
      return { frames: data.frames || [], longTasks: data.longTasks || [], gpu: data.gpu || {}, worker: data.worker || [], memory: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit } : null, unsupported: [!performance.memory ? "performance.memory unavailable in this Chromium build" : null, !data.gpu?.frames?.length ? "No intercepted WebGL calls observed" : null].filter(Boolean) };
    });
    report.workers = [];
    for (const worker of page.workers()) {
      try { report.workers.push(await worker.evaluate(() => ({ url: self.location?.href || null, timeOrigin: performance.timeOrigin, now: performance.now(), memory: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit } : null }))); } catch (error) { report.workers.push({ error: error.message }); }
    }
    if (report.workers.some((worker) => !worker.memory)) report.limitations.push("Worker performance.memory is not exposed by this Chromium worker context; worker messages include send/receive timestamps and estimated payload sizes, while CDP CPU profiles cover the renderer interaction thread.");
    try { report.processMetrics = await app.evaluate(({ app }) => ({ at: Date.now(), app: app.getAppMetrics().map((item) => ({ pid: item.pid, type: item.type, cpu: item.cpu, memory: item.memory, creationTime: item.creationTime, integrityLevel: item.integrityLevel })), gpuFeatureStatus: app.getGPUFeatureStatus() })); } catch (error) { report.limitations.push(`Electron process/GPU metrics unavailable: ${error.message}`); }
    report.summary = { fps: stats(report.page.frames.filter((frame) => frame.delta > 0 && frame.delta < 1000).map((frame) => 1000 / frame.delta)), frameDeltaMs: stats(report.page.frames.map((frame) => frame.delta)), longTaskMs: stats(report.page.longTasks.map((entry) => entry.duration)), gpuDrawCallsPerFrame: stats((report.page.gpu.frames || []).map((frame) => frame.arrays + frame.elements + frame.instances)), gpuLiveResources: report.page.gpu.live, workerMessageBytes: stats(report.page.worker.map((message) => message.bytes).filter(Number.isFinite)) };
  } catch (error) {
    report.errors.push(error.stack || String(error));
    if (page) await page.screenshot({ path: path.join(runDir, "failure.png"), fullPage: false }).catch(() => {});
    try { report.page = await page.evaluate(() => window.__viewportBench || null); } catch {}
  } finally {
    if (app) {
      try { report.processMetricsAfter = await app.evaluate(({ app }) => app.getAppMetrics().map((item) => ({ pid: item.pid, type: item.type, cpu: item.cpu, memory: item.memory }))); } catch {}
      await app.close().catch(() => {});
    }
    report.finishedAt = new Date().toISOString();
    const reportFile = path.join(runDir, "report.json"); writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ tier: triangles, report: reportFile, errors: report.errors.length, summary: report.summary || null }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const tier of tiers) await runTier(tier);
}
