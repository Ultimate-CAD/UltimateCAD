import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { verify3mf } from "./manufacturing-file-audit.mjs";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
const executable = path.resolve(
  process.argv.slice(2).find((value) => value.endsWith(".exe")) ||
    "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe",
);
const sourceStl = path.resolve(
  process.env.LAYERLING_CERTIFICATION_STL ||
    ".codex-run/adaptive10/manufacturing-1793350350780/result.stl",
);
const output = path.resolve(`.codex-run/certification13/packaged-${Date.now()}`);
const profile = path.join(output, "isolated-profile");
const expectedVersion = process.env.LAYERLING_EXPECTED_APP_VERSION || "1.114.0-ultimate.13";
const mkdir = (directory) => mkdirSync(directory, { recursive: true });
mkdir(output);

const checks = [];
const errors = [];
const pageErrors = [];
const requests = [];
const requestFailures = [];
let app;
let page;
let connection;
let editorId;
let child;
let intentionalWorkerFailure = false;
let summaryDetails = {};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (name, detail = {}) => {
  checks.push({ name, detail });
  console.log("PASS", name);
};

async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function command(action, params = {}) {
  const response = await fetch(`${connection.url}/api/layerling-mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "command", editorId, action, params, timeoutMs: 60000 }),
    signal: AbortSignal.timeout(70000),
  });
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function ready(projectName) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const response = await fetch(`${connection.url}/api/layerling-mcp`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
    const json = await response.json();
    const editor = json.editors
      ?.filter((item) => Date.now() - item.lastSeen < 10000 && (!projectName || item.projectName === projectName))
      .sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (editor) {
      editorId = editor.editorId;
      return;
    }
    await pause(200);
  }
  throw Error("Packaged editor did not register with local MCP");
}

function objectSnapshot(object) {
  return Object.fromEntries(
    ["id", "name", "kind", "color", "hole", "locked", "position", "dimensions", "rotation", "importedTriangles"]
      .map((key) => [key, object?.[key] ?? null]),
  );
}

async function selectedSnapshot(id) {
  const selected = await command("select_objects", { ids: [id] });
  assert.deepEqual(selected.selectedIds, [id]);
  const listed = await command("list_objects");
  const object = listed.objects?.find((item) => item.id === id);
  assert.ok(object, `Selected MCP object ${id} was not listed`);
  return objectSnapshot(object);
}

async function openStudio() {
  if (!(await page.getByRole("region", { name: "Precision Mesh Studio" }).count()))
    await page.keyboard.press("Control+e");
  await page.getByRole("region", { name: "Precision Mesh Studio" }).waitFor();
}

async function waitVerdict(status, timeout = 30000) {
  const indicator = page.locator(`[role="status"][data-verdict="${status}"]`);
  await indicator.waitFor({ timeout });
  return indicator.innerText();
}

async function runPreview(timeout = 180000) {
  await page.getByRole("button", { name: "Generate export preview", exact: true }).click();
  await page.getByRole("button", { name: "Generate export preview", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector('section[aria-label="Precision Mesh Studio"] button')?.disabled,
    null,
    { timeout },
  );
  await page.locator(".precision-results").waitFor({ timeout });
}

async function download(button, fileName) {
  const target = path.join(output, fileName);
  await app.evaluate((_electron, file) => {
    globalThis.__certificationDownloadTarget = file;
    globalThis.__certificationDownloadDone = null;
  }, target);
  await button.click();
  for (let attempt = 0; attempt < 600; attempt++) {
    const state = await app.evaluate(() => globalThis.__certificationDownloadDone);
    if (state) {
      assert.equal(state, "completed", `Download ended with ${state}`);
      assert.ok(readFileSync(target).length > 0);
      return target;
    }
    await pause(100);
  }
  throw Error(`Timed out waiting for Electron download: ${fileName}`);
}

function binaryTetrahedraStl() {
  const tetra = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  const points = [[0, 0, 0], [0, 2, 0], [2, 0, 0], [0, 0, 2]];
  const vertices = [...points, ...points.map((p) => p.map((v) => v + 0.25))];
  const faces = [...tetra, ...tetra.map((face) => face.map((i) => i + 4))];
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.write("Certification intersecting tetrahedra", 0, "ascii");
  buffer.writeUInt32LE(faces.length, 80);
  faces.forEach((face, index) => {
    const offset = 84 + index * 50;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = vertices[face[corner]];
      for (let axis = 0; axis < 3; axis++)
        buffer.writeFloatLE(vertex[axis], offset + 12 + corner * 12 + axis * 4);
    }
  });
  return buffer.toString("base64");
}

async function closeOwnedApp() {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.removeAllListeners("will-prevent-unload");
      window.webContents.on("will-prevent-unload", (event) => event.preventDefault());
    }
  }).catch(() => {});
  await Promise.race([
    app.close(),
    pause(12000).then(() => {
      if (child?.exitCode === null) child.kill();
    }),
  ]).catch(() => {});
}

try {
  assert.ok(existsSync(executable), `Packaged executable not found: ${executable}`);
  assert.ok(existsSync(sourceStl), `Cached dense STL not found: ${sourceStl}`);
  const sourceHashBefore = await hashFile(sourceStl);

  app = await electron.launch({
    executablePath: executable,
    cwd: output,
    timeout: 90000,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      PATH: `${process.env.SystemRoot}\\System32`,
      LAYERLING_DESKTOP_PROFILE: profile,
      LAYERLING_DESKTOP_TEST: "1",
    },
  });
  child = app.process();
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.session.on("will-download", (_event, item) => {
      if (!globalThis.__certificationDownloadTarget) return;
      item.setSavePath(globalThis.__certificationDownloadTarget);
      item.once("done", (_event, state) => { globalThis.__certificationDownloadDone = state; });
    });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  page.on("requestfailed", (request) => requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText,
  }));

  await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor({ timeout: 90000 });
  connection = JSON.parse(readFileSync(path.join(profile, "connection.json"), "utf8"));
  assert.equal(connection.version, expectedVersion);
  pass("Packaged app launched with isolated profile and expected version", { version: connection.version });

  await page.getByRole("button", { name: "Create new 3D design", exact: true }).click();
  await ready();
  await page.locator('input[type="file"][accept*=".stl"]').first().setInputFiles(sourceStl);
  // The dashboard importer creates a new project/editor; don't keep the old tab ID.
  await ready(path.basename(sourceStl, path.extname(sourceStl)));
  let cone;
  for (let attempt = 0; attempt < 150; attempt++) {
    const list = await command("list_objects");
    cone = list.objects?.find((item) => item.kind === "mesh");
    if (cone) break;
    await pause(200);
  }
  assert.ok(cone?.id, "Cached cone STL did not import through the file input");
  const coneBefore = await selectedSnapshot(cone.id);
  const selectedScene = await command("list_objects");
  writeFileSync(path.join(output, "cone-source-snapshot.json"), JSON.stringify({ selected: coneBefore, scene: selectedScene }, null, 2));
  pass("Cached dense STL imported through the UI and selected through MCP", {
    id: cone.id,
    triangles: cone.importedTriangles ?? null,
  });
  assert.equal(coneBefore.importedTriangles, 1_082_636);

  await openStudio();
  const studio = page.getByRole("region", { name: "Precision Mesh Studio" });
  await page.getByRole("radio", { name: /^STL:/ }).click();
  const progress = [];
  const status = page.locator('[role="status"][data-verdict]');

  const workerFailure = page.waitForEvent("worker", { timeout: 30000 });
  await page.getByRole("button", { name: "Generate export preview", exact: true }).click();
  const failureWorker = await workerFailure;
  intentionalWorkerFailure = true;
  await failureWorker.evaluate(() => {
    setTimeout(() => { throw new Error("Injected certification test failure"); }, 0);
  });
  await waitVerdict("failed", 30000);
  const failureAlert = await studio.getByRole("alert").innerText();
  assert.match(failureAlert, /Injected certification test failure/);
  assert.equal(await page.locator(".precision-results").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Generate export preview", exact: true }).isDisabled(), false);
  progress.push({ stage: "injected-worker-error", status: await status.innerText(), alert: failureAlert });
  await page.screenshot({ path: path.join(output, "worker-failure-retryable.png"), fullPage: true });
  pass("Worker error is reported as failed, has no export result, and remains retryable");

  const cancelWorker = page.waitForEvent("worker", { timeout: 30000 });
  await page.getByRole("button", { name: "Generate export preview", exact: true }).click();
  await cancelWorker;
  await page.getByRole("button", { name: "Cancel export", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Cancel export", exact: true }).click();
  await waitVerdict("cancelled", 30000);
  assert.equal(await page.locator(".precision-results").count(), 0);
  assert.equal(await studio.getByRole("alert").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Generate export preview", exact: true }).isDisabled(), false);
  await pause(750);
  assert.equal(await page.locator(".precision-results").count(), 0, "Cancelled worker produced a late result");
  progress.push({ stage: "cancelled", status: await status.innerText() });
  await page.screenshot({ path: path.join(output, "worker-cancelled-retryable.png"), fullPage: true });
  pass("Worker cancellation reports cancelled, preserves source, and produces no late result");

  const denseStarted = performance.now();
  await runPreview(180000);
  const denseEndToEndMs = performance.now() - denseStarted;
  const stlReportPath = await download(
    page.getByRole("button", { name: "Save manufacturing report", exact: true }),
    "dense-cone-stl.mesh-report.json",
  );
  const stlReport = JSON.parse(readFileSync(stlReportPath, "utf8"));
  const stlBody = stlReport.bodies[0];
  const stlEncoding = stlBody.encoding;
  const stlSurface = stlBody.surface;
  const stlUiVerdict = await page.locator(".precision-results").getAttribute("data-verdict");
  const stlUiReady = await page.locator(".precision-results").getAttribute("data-ready");
  progress.push({
    stage: "dense-stl-float32",
    uiVerdict: stlUiVerdict,
    uiReady: stlUiReady,
    reportVerdict: stlReport.verification.status,
    reportReady: stlReport.ready,
    reportDurationMs: stlReport.durationMs,
    frontendDurationMs: denseEndToEndMs,
    triangles: stlReport.triangles,
    encoding: stlEncoding,
    intersectionSearch: stlSurface.selfIntersections,
  });
  summaryDetails = { ...summaryDetails, stlReportPath };
  await page.screenshot({ path: path.join(output, "dense-cone-stl-float32-blocked.png"), fullPage: true });
  assert.equal(await page.locator(".precision-results").getAttribute("data-verdict"), "verified-invalid");
  assert.equal(await page.locator(".precision-results").getAttribute("data-ready"), "false");
  assert.equal(stlReport.triangles, 1_082_636);
  assert.equal(stlReport.verification.status, "verified-invalid", JSON.stringify(stlReport.verification));
  assert.equal(stlEncoding.coordinates, "float32");
  assert.equal(stlEncoding.topologyBeforeEncoding.valid, true);
  assert.equal(stlEncoding.topologyBeforeEncoding.vertices, 541_322);
  assert.equal(stlEncoding.introducedTopologyDefects, true);
  assert.equal(stlBody.audit.vertices, 541_315);
  assert.equal(stlBody.audit.degenerateFaces, 14);
  assert.equal(stlBody.audit.nonManifoldEdges, 14);
  assert.equal(stlBody.audit.windingMismatches, 7);
  assert.ok(stlEncoding.maxVertexDisplacementMm > 0);
  assert.ok(stlEncoding.maxVertexDisplacementMm < 0.025);
  assert.equal(stlSurface.selfIntersections.verification.status, "verified-invalid");
  assert.equal(stlSurface.selfIntersections.complete, true);
  assert.ok(stlSurface.selfIntersections.found > 0);
  assert.equal(stlReport.ready, false);
  assert.equal(await page.getByRole("button", { name: "Export reviewed Binary STL", exact: true }).isDisabled(), true);
  progress.push({ stage: "dense-stl-done", status: await status.innerText(), progressText: await studio.locator('[role="status"]').innerText() });
  pass("Dense cone STL Float32 encoding defects are detected and the export is blocked", {
    frontendJobMs: denseEndToEndMs,
    workerReportedMs: stlReport.durationMs,
    transportAndUiDeltaMs: denseEndToEndMs - stlReport.durationMs,
    triangles: stlReport.triangles,
    found: stlSurface.selfIntersections.found,
    encoding: stlEncoding,
    reportPath: stlReportPath,
  });

  const coneAfter = await selectedSnapshot(cone.id);
  assert.deepEqual(coneAfter, coneBefore, "Preview altered the imported source object");
  const sourceHashAfterCone = await hashFile(sourceStl);
  assert.equal(sourceHashAfterCone, sourceHashBefore, "Original cached STL changed on disk");

  await page.getByRole("radio", { name: /^3MF:/ }).click();
  const threeMfStarted = performance.now();
  await runPreview(180000);
  const threeMfEndToEndMs = performance.now() - threeMfStarted;
  const threeMfReportPath = await download(
    page.getByRole("button", { name: "Save manufacturing report", exact: true }),
    "dense-cone-3mf.mesh-report.json",
  );
  const threeMfReport = JSON.parse(readFileSync(threeMfReportPath, "utf8"));
  const threeMfBody = threeMfReport.bodies[0];
  const threeMfSurface = threeMfBody.surface;
  const threeMfEncoding = threeMfBody.encoding;
  const threeMfUiVerdict = await page.locator(".precision-results").getAttribute("data-verdict");
  const threeMfUiReady = await page.locator(".precision-results").getAttribute("data-ready");
  progress.push({
    stage: "dense-3mf-float64",
    uiVerdict: threeMfUiVerdict,
    uiReady: threeMfUiReady,
    reportVerdict: threeMfReport.verification.status,
    reportReady: threeMfReport.ready,
    reportDurationMs: threeMfReport.durationMs,
    frontendDurationMs: threeMfEndToEndMs,
    triangles: threeMfReport.triangles,
    encoding: threeMfEncoding,
    surface: threeMfSurface.selfIntersections,
    wallConcern: threeMfSurface.wallConcern,
  });
  summaryDetails = { ...summaryDetails, threeMfReportPath };
  await page.screenshot({ path: path.join(output, "dense-cone-3mf-surface-valid-wall-concern.png"), fullPage: true });
  assert.equal(await page.locator(".precision-results").getAttribute("data-verdict"), "verified-valid");
  assert.equal(await page.locator(".precision-results").getAttribute("data-ready"), "false");
  assert.equal(threeMfReport.verification.status, "verified-valid");
  assert.equal(threeMfReport.triangles, 1_082_636);
  assert.equal(threeMfBody.audit.triangles, 1_082_636);
  assert.equal(threeMfBody.audit.valid, true);
  assert.equal(threeMfEncoding.coordinates, "float64");
  assert.equal(threeMfEncoding.maxVertexDisplacementMm, 0);
  assert.equal(threeMfEncoding.introducedTopologyDefects, false);
  assert.equal(threeMfSurface.selfIntersections.verification.status, "verified-valid");
  assert.equal(threeMfSurface.selfIntersections.complete, true);
  assert.equal(threeMfSurface.selfIntersections.found, 0);
  assert.equal(threeMfSurface.wallConcern, true);
  assert.equal(threeMfReport.ready, false);
  pass("Dense cone 3MF retains valid topology while keeping its separate wall concern", {
    frontendJobMs: threeMfEndToEndMs,
    workerReportedMs: threeMfReport.durationMs,
    transportAndUiDeltaMs: threeMfEndToEndMs - threeMfReport.durationMs,
    triangles: threeMfReport.triangles,
    complete: threeMfSurface.selfIntersections.complete,
    found: threeMfSurface.selfIntersections.found,
    wallMm: threeMfSurface.minSampledThicknessMm,
    ready: threeMfReport.ready,
    reportPath: threeMfReportPath,
  });
  await studio.getByLabel(/I reviewed the manufacturing concerns/).check();
  const threeMfExportPath = await download(
    studio.getByRole("button", { name: "Export reviewed 3MF", exact: true }),
    "dense-cone-reviewed.3mf",
  );
  summaryDetails = { ...summaryDetails, threeMfExportPath };
  const independentThreeMfAudit = verify3mf(threeMfExportPath);
  assert.equal(independentThreeMfAudit.triangles, 1_082_636);
  assert.equal(independentThreeMfAudit.boundaryEdges, 0);
  assert.equal(independentThreeMfAudit.nonManifoldEdges, 0);
  assert.equal(independentThreeMfAudit.nonManifoldVertices, 0);
  assert.equal(await page.locator(".precision-results").getAttribute("data-ready"), "false");
  writeFileSync(path.join(output, "dense-cone-reviewed-3mf-audit.json"), JSON.stringify(independentThreeMfAudit, null, 2));
  pass("Reviewed 3MF downloads and independently reimports with closed strict topology", independentThreeMfAudit);
  const coneAfter3mf = await selectedSnapshot(cone.id);
  assert.deepEqual(coneAfter3mf, coneBefore, "3MF preview/export altered the imported source object");
  assert.equal(await hashFile(sourceStl), sourceHashBefore, "3MF preview/export altered the original cached STL");

  const fixture = await command("import_file", {
    fileName: "intersecting-closed-tetrahedra.stl",
    base64: binaryTetrahedraStl(),
  });
  const defective = fixture.imported?.[0];
  assert.ok(defective?.id, "Intersecting tetrahedra fixture did not import");
  await selectedSnapshot(defective.id);
  await openStudio();
  await page.getByRole("radio", { name: /^STL:/ }).click();
  await runPreview(60000);
  const defectReportPath = await download(
    page.getByRole("button", { name: "Save manufacturing report", exact: true }),
    "intersecting-tetrahedra.mesh-report.json",
  );
  const defectReport = JSON.parse(readFileSync(defectReportPath, "utf8"));
  const defectUiVerdict = await page.locator(".precision-results").getAttribute("data-verdict");
  const defectUiReady = await page.locator(".precision-results").getAttribute("data-ready");
  progress.push({
    stage: "intersecting-tetrahedra",
    uiVerdict: defectUiVerdict,
    uiReady: defectUiReady,
    reportVerdict: defectReport.verification.status,
    reportReady: defectReport.ready,
    found: defectReport.bodies[0].surface.selfIntersections.found,
  });
  summaryDetails = { ...summaryDetails, defectReportPath };
  await page.screenshot({ path: path.join(output, "intersecting-defect-blocked.png"), fullPage: true });
  assert.equal(defectReport.verification.status, "verified-invalid");
  assert.ok(defectReport.bodies[0].surface.selfIntersections.found > 0);
  assert.equal(defectReport.ready, false);
  assert.equal(await page.locator(".precision-results").getAttribute("data-ready"), "false");
  assert.equal(await page.getByRole("button", { name: "Export reviewed Binary STL", exact: true }).isDisabled(), true);
  pass("Genuine intersecting closed tetrahedra are verified invalid and blocked from export", {
    found: defectReport.bodies[0].surface.selfIntersections.found,
  });

  assert.equal(await hashFile(sourceStl), sourceHashBefore, "Original cached STL was modified");
  const unexpectedPageErrors = pageErrors.filter((message) =>
    !(intentionalWorkerFailure && message.includes("Injected certification test failure")),
  );
  assert.deepEqual(unexpectedPageErrors, []);
  const nativeLogPath = path.join(profile, "desktop.log");
  const nativeLog = existsSync(nativeLogPath) ? readFileSync(nativeLogPath, "utf8") : "";
  summaryDetails = {
    executable,
    version: connection.version,
    artifactDirectory: output,
    sourceStl,
    sourceSha256: sourceHashBefore,
    sourceObjectBefore: coneBefore,
    sourceObjectAfter: coneAfter,
    stlReportPath,
    threeMfReportPath,
    threeMfExportPath,
    defectReportPath,
    independentThreeMfAudit,
    progress,
    checks,
    pageErrors: unexpectedPageErrors,
    requestCount: requests.length,
    externalHttpRequests: requests.filter((url) => /^https?:/.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)),
    failedRequests: requestFailures,
    nativeLogLines: nativeLog.split(/\r?\n/).filter(Boolean).length,
  };
  console.log("Artifacts", output);
} catch (error) {
  errors.push(error?.stack || String(error));
  console.error(error);
  if (page)
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(output, "summary.json"), JSON.stringify({
    ...summaryDetails,
    executable,
    version: connection?.version ?? null,
    artifactDirectory: output,
    sourceStl,
    checks,
    errors,
    pageErrors,
    requestCount: requests.length,
    failedRequests: requestFailures,
  }, null, 2));
  await closeOwnedApp();
}
