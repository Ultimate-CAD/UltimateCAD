import { _electron as electron } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";

const executable = path.resolve(
  process.argv.slice(2).find((s) => s.endsWith(".exe")) ||
    "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe",
);
const output = path.resolve(
  process.env.LAYERLING_PRECISION_VALIDATION_DIR ||
    "dist/ultimate/windows/precision-validation",
);
const fixture = path.resolve(
  process.env.LAYERLING_SAVED_ORGANIC ||
    ".codex-run/preserved-organic-ultimate3/organic-validation/hollowed-organic.lyl",
);
const profile = path.join(output, `isolated-profile-${Date.now()}`);
mkdirSync(output, { recursive: true });
const checks = [],
  errors = [],
  requests = [],
  workers = [],
  workerHandles = [];
let app, page, connection, editorId, pid, child;
const sha = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const sourceHash = existsSync(fixture) ? sha(fixture) : null;
const sourceProjectName = sourceHash
  ? JSON.parse(strFromU8(unzipSync(readFileSync(fixture))["project.json"]))
      .metadata.projectName
  : null;
const pass = (name, detail) => {
  checks.push({ name, detail });
  console.log("PASS", name, detail ?? "");
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function command(action, params = {}) {
  const response = await fetch(connection.url + "/api/layerling-mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "command",
      editorId,
      action,
      params,
      timeoutMs: 60000,
    }),
    signal: AbortSignal.timeout(70000),
  });
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
async function ready(projectName) {
  for (let i = 0; i < 150; i++) {
    const r = await fetch(connection.url + "/api/layerling-mcp", {
        headers: { Authorization: `Bearer ${connection.token}` },
      }),
      json = await r.json();
    const editor = json.editors
      ?.filter(
        (e) =>
          Date.now() - e.lastSeen < 10000 &&
          (!projectName || e.projectName === projectName),
      )
      .sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (editor) {
      editorId = editor.editorId;
      return;
    }
    await pause(200);
  }
  throw Error("Editor did not register");
}
async function openStudio() {
  await page.keyboard.press("Control+e");
  const advanced = page.getByText("Advanced / Analyze (optional)", {exact:true});
  if (await advanced.evaluate(el => !el.parentElement.open)) await advanced.click();
  await page.getByRole("region", { name: "Precision Mesh Studio" }).waitFor();
}
async function waitObject(id, predicate) {
  for (let i = 0; i < 120; i++) {
    const object = (await command("list_objects")).objects.find(
      (o) => o.id === id,
    );
    if (object && predicate(object)) return object;
    await pause(100);
  }
  throw Error(`Object ${id} did not reach the expected worker/history state`);
}
async function preview() {
  await page
    .getByRole("button", { name: "Generate export preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate export preview", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !document.querySelector(
        'section[aria-label="Precision Mesh Studio"] button',
      )?.disabled,
    null,
    { timeout: 180000 },
  );
  const alert = page
    .getByRole("region", { name: "Precision Mesh Studio" })
    .getByRole("alert");
  if (await alert.count()) throw Error(await alert.innerText());
  await page.locator(".precision-results").waitFor({ timeout: 180000 });
}
async function download(button, file) {
  const target = path.join(output, file);
  await app.evaluate((_electron, target) => {
    globalThis.__precisionDownloadTarget = target;
    globalThis.__precisionDownloadDone = null;
  }, target);
  await button.click();
  let done = null;
  for (let i = 0; i < 600; i++) {
    done = await app.evaluate(() => globalThis.__precisionDownloadDone);
    if (done) break;
    await pause(100);
  }
  assert.equal(done, "completed", "Native Electron download did not complete");
  assert.ok(readFileSync(target).length > 0);
  return target;
}
function strictTopology(vertices, faces) {
  const edges = new Map(),
    fans = new Map(),
    seen = new Set(),
    adj = new Map();
  let volume = 0;
  const key = (p) => p.map((v) => (Object.is(v, -0) ? 0 : v)).join(",");
  for (let i = 0; i < faces.length; i++) {
    const p = faces[i].map((j) => vertices[j]),
      keys = p.map(key),
      a = p[0],
      b = p[1],
      c = p[2];
    assert.ok(p.flat().every(Number.isFinite));
    const u = b.map((x, j) => x - a[j]),
      v = c.map((x, j) => x - a[j]);
    assert.ok(
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) > 0,
      "Zero-area facet",
    );
    const face = keys.slice().sort().join("|");
    assert.ok(!seen.has(face), "Duplicate facet");
    seen.add(face);
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    keys.forEach((k) => {
      if (!fans.has(k)) fans.set(k, []);
      fans.get(k).push(i);
    });
    for (const [j, k] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const ids = [keys[j], keys[k]],
        edge = ids.slice().sort().join("|"),
        e = edges.get(edge) || [];
      e.push({ face: i, direction: ids[0] < ids[1] ? 1 : -1, ids });
      edges.set(edge, e);
    }
  }
  for (const e of edges.values()) {
    assert.equal(e.length, 2, "Edge is not closed/manifold");
    assert.equal(e[0].direction + e[1].direction, 0, "Winding mismatch");
    for (const k of e[0].ids) {
      if (!adj.has(k)) adj.set(k, new Map());
      const a = adj.get(k);
      for (const [x, y] of [
        [e[0].face, e[1].face],
        [e[1].face, e[0].face],
      ]) {
        if (!a.has(x)) a.set(x, []);
        a.get(x).push(y);
      }
    }
  }
  for (const [k, faces] of fans) {
    const seen = new Set(),
      pending = [faces[0]],
      graph = adj.get(k);
    while (pending.length) {
      const i = pending.pop();
      if (seen.has(i)) continue;
      seen.add(i);
      pending.push(...graph.get(i));
    }
    assert.equal(seen.size, faces.length, "Non-manifold vertex");
  }
  assert.ok(volume > 0);
  return {
    triangles: faces.length,
    vertices: new Set(vertices.map(key)).size,
    volumeMm3: volume,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    nonManifoldVertices: 0,
  };
}
function verifyStl(file) {
  const bytes = readFileSync(file),
    g = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    p = g.attributes.position.array;
  const vertices = Array.from({ length: p.length / 3 }, (_, i) =>
      Array.from(p.slice(i * 3, i * 3 + 3)),
    ),
    faces = Array.from({ length: p.length / 9 }, (_, i) => [
      i * 3,
      i * 3 + 1,
      i * 3 + 2,
    ]);
  const result = strictTopology(vertices, faces);
  g.dispose();
  return result;
}
function verify3mf(file) {
  const xml = strFromU8(unzipSync(readFileSync(file))["3D/3dmodel.model"]);
  assert.match(xml, /unit="millimeter"/);
  const vertices = [
      ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g),
    ].map((m) => [+m[1], +m[2], +m[3]]),
    faces = [
      ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
    ].map((m) => [+m[1], +m[2], +m[3]]);
  return strictTopology(vertices, faces);
}
try {
  app = await electron.launch({
    executablePath: executable,
    cwd: output,
    timeout: 90000,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      PATH: process.env.SystemRoot + "\\System32",
      LAYERLING_DESKTOP_PROFILE: profile,
      LAYERLING_DESKTOP_TEST: "1",
    },
  });
  child = app.process();
  pid = child.pid;
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.session.on(
      "will-download",
      (_e, item) => {
        if (!globalThis.__precisionDownloadTarget) return;
        item.setSavePath(globalThis.__precisionDownloadTarget);
        item.once(
          "done",
          (_e, state) => (globalThis.__precisionDownloadDone = state),
        );
      },
    );
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("worker", (w) => {
    workers.push(w.url());
    workerHandles.push(w);
  });
  page.on("request", (r) => requests.push(r.url()));
  await page
    .getByRole("button", { name: "Create new 3D design", exact: true })
    .waitFor({ timeout: 90000 });
  connection = JSON.parse(readFileSync(path.join(profile, "connection.json")));
  assert.match(connection.version, /^1\.114\.0-ultimate\.\d+$/);
  if (process.env.LAYERLING_EXPECTED_APP_VERSION)
    assert.equal(
      connection.version,
      process.env.LAYERLING_EXPECTED_APP_VERSION,
    );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("https://example.com");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  pass(
    "Packaged version verified and native application policy blocks external network requests",
    connection.version,
  );
  await page
    .getByRole("button", { name: "Create new 3D design", exact: true })
    .click();
  await ready();
  const native = (
    await command("create_shape", {
      kind: "sphere",
      name: "Precision native sphere",
      width: 20,
      depth: 20,
      height: 20,
    })
  ).object;
  await command("select_objects", { ids: [native.id] });
  await openStudio();
  await page.getByLabel("Mesh quality preset").selectOption("standard");
  const workersBeforePreview = new Set(workerHandles);
  await preview();
  const precisionWorker = workerHandles.find(
    (w) =>
      !workersBeforePreview.has(w) && w.url().includes("/_next/static/chunks/"),
  );
  assert.ok(
    precisionWorker,
    "Precision preview did not create its dedicated geometry worker",
  );
  assert.equal(
    await page.locator(".precision-results").getAttribute("data-ready"),
    "true",
  );
  const coarseFile = await download(
    page.getByRole("button", {
      name: "Export validated Binary STL",
      exact: true,
    }),
    "native-standard.stl",
  );
  const coarse = verifyStl(coarseFile);
  pass(
    "Packaged native analytic STL independently reimports as manifold",
    coarse,
  );
  await page.getByLabel("Mesh quality preset").selectOption("ultra");
  await preview();
  const fineFile = await download(
    page.getByRole("button", {
      name: "Export validated Binary STL",
      exact: true,
    }),
    "native-ultra.stl",
  );
  const fine = verifyStl(fineFile);
  assert.ok(fine.triangles > coarse.triangles);
  pass("Ultra creates finer analytic surface tessellation", fine);
  await download(
    page.getByRole("button", {
      name: "Save manufacturing report",
      exact: true,
    }),
    "native-ultra.mesh-report.json",
  );
  const nativeReport = JSON.parse(
    readFileSync(path.join(output, "native-ultra.mesh-report.json")),
  );
  assert.ok(nativeReport.bodies[0].analyticDeviationMm <= 0.005);
  pass(
    "Packaged analytic deviation is measured",
    nativeReport.bodies[0].analyticDeviationMm,
  );
  // Cancel live WASM work and verify the source, rather than merely canceling a timer.
  await page.getByLabel("Mesh quality preset").selectOption("custom");
  await page
    .getByLabel("Maximum edge length (mm; 0 = unrestricted)")
    .fill(".05");
  const closed = new Promise((r) => precisionWorker.on("close", () => r()));
  await page
    .getByRole("button", { name: "Generate export preview", exact: true })
    .click();
  await pause(200);
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await Promise.race([
    closed,
    pause(15000).then(() => {
      throw Error("Canceled worker did not close");
    }),
  ]);
  assert.ok(
    (await command("list_objects")).objects.some((o) => o.id === native.id),
  );
  pass(
    "Packaged export cancellation terminates the worker and preserves source identity",
  );
  await page.keyboard.press("Escape");
  // A small real mesh job verifies the optimized packaged worker without rerendering the expensive fixture.
  await command("delete_objects", { ids: [native.id] });
  await page
    .locator('input[type=file][accept*=".stl"]')
    .first()
    .setInputFiles(coarseFile);
  await ready(path.basename(coarseFile,path.extname(coarseFile)));
  let imported;
  for (let i = 0; i < 120; i++) {
    imported = (await command("list_objects")).objects.find(
      (o) => o.importedTriangles === coarse.triangles,
    );
    if (imported) break;
    await pause(100);
  }
  assert.ok(imported, "Packaged mesh worker fixture did not import");
  await command("hollow_object", {
    id: imported.id,
    thickness: 2,
    openings: "none",
    direction: "inward",
    meshAccuracyMm: 0.1,
  });
  const latestShell = (o) =>
    o.edgeTreatments?.filter((f) => f.kind === "shell").at(-1);
  const hollowed = await waitObject(
      imported.id,
      (o) => latestShell(o)?.meshHollow?.method === "mesh-sdf",
    ),
    hollowStats = latestShell(hollowed).meshHollow;
  assert.ok(hollowStats.measuredErrorMm <= 0.1);
  assert.equal(hollowStats.maxErrorMm, 0.1);
  for (const axis of ["width", "depth", "height"])
    assert.ok(
      Math.abs(hollowed.dimensions[axis] - imported.dimensions[axis]) < 0.01,
    );
  if (hollowStats.distanceQueryStats)
    assert.ok(
      hollowStats.distanceQueryStats.rayQueries <
        hollowStats.distanceQueryStats.nearestQueries,
    );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await waitObject(
    imported.id,
    (o) => !latestShell(o) && o.importedTriangles === coarse.triangles,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await waitObject(
    imported.id,
    (o) => latestShell(o)?.meshHollow?.method === "mesh-sdf",
  );
  const saved = await command("save_project", { history: "all" }),
    archive = unzipSync(Buffer.from(saved.base64, "base64")),
    project = JSON.parse(strFromU8(archive["project.json"])),
    state = project.states.find((s) => s.id === project.sceneStateId),
    node = state.nodes.find((n) => n.objectId === imported.id),
    entry = node.edgeTreatmentHistory.at(-1),
    before = state.nodes.find((n) => n.nodeId === entry.beforeNodeId);
  assert.equal(before.importedMesh.triangleCount, coarse.triangles);
  assert.equal(entry.feature.meshHollow.method, "mesh-sdf");
  assert.ok(!project.exactCad.some((n) => n.objectId === imported.id));
  // Import a synthetic checkpoint copy under a distinct project ID so an already-open
  // IndexedDB project cannot satisfy the readback. Object and source-history IDs stay intact.
  project.metadata.projectName = "Hollow worker checkpoint";
  project.metadata.projectId += "-readback";
  archive["project.json"] = strToU8(JSON.stringify(project));
  const hollowProject = path.join(output, "hollow-worker-checkpoint.lyl");
  writeFileSync(hollowProject, zipSync(archive));
  await page
    .locator('input[type=file][accept*=".lyl"]')
    .first()
    .setInputFiles(hollowProject);
  await ready(project.metadata.projectName);
  await waitObject(
    imported.id,
    (o) => latestShell(o)?.meshHollow?.method === "mesh-sdf",
  );
  pass(
    "Optimized packaged hollow worker preserves outside dimensions, identity, Undo/Redo and LYL source history",
    {
      triangles: hollowStats.resultTriangles,
      sampledErrorMm: hollowStats.measuredErrorMm,
      durationMs: hollowStats.durationMs,
    },
  );
  if (sourceHash) {
    await page
      .locator('input[type=file][accept*=".lyl"]')
      .first()
      .setInputFiles(fixture);
    await ready(sourceProjectName);
    let organic;
    for (let i = 0; i < 100; i++) {
      organic = (await command("list_objects")).objects.find(
        (o) => o.edgeTreatments?.some(feature=>feature.meshHollow?.method==='mesh-sdf'),
      );
      if (organic) break;
      await pause(100);
    }
    assert.ok(organic, "Cached organic result did not load");
    await command("select_objects", { ids: [organic.id] });
    await openStudio();
    await preview();
    assert.equal(
      await page.locator(".precision-results").getAttribute("data-ready"),
      "false",
    );
    assert.ok(
      await page
        .getByRole("button", {
          name: "Export reviewed Binary STL",
          exact: true,
        })
        .isDisabled(),
    );
    pass("Organic export requires manufacturing review or defect repair");
    const conditioned=organic.edgeTreatments?.some(feature=>feature.meshHollow?.cavityConditioningMm>0);
    if(!conditioned)await page
      .getByLabel("Preview bounded mesh repair (export copy only)")
      .check();
    await preview();
    assert.equal(
      await page.locator(".precision-results").getAttribute("data-ready"),
      "false",
    );
    await page
      .getByLabel(
        "I reviewed the manufacturing concerns. Export this copy without marking it print-ready.",
      )
      .check();
    const repairedFile = await download(
      page.getByRole("button", {
        name: "Export reviewed Binary STL",
        exact: true,
      }),
      "organic-repaired.stl",
    );
    pass(
      conditioned?"Native conditioned cavity exports strict manifold STL with wall concern retained":"Explicit organic repair yields strict manifold STL with wall concern retained",
      verifyStl(repairedFile),
    );
    await download(
      page.getByRole("button", {
        name: "Save manufacturing report",
        exact: true,
      }),
      "organic-stl.mesh-report.json",
    );
    await page.getByRole("radio", { name: /^3MF:/ }).click();
    await preview();
    await page
      .getByLabel(
        "I reviewed the manufacturing concerns. Export this copy without marking it print-ready.",
      )
      .check();
    const three = await download(
      page.getByRole("button", { name: "Export reviewed 3MF", exact: true }),
      "organic-repaired.3mf",
    );
    pass(
      "Precision 3MF independently reimports with exact manifold topology",
      verify3mf(three),
    );
    await page.screenshot({
      path: path.join(output, "precision-organic.png"),
      fullPage: true,
    });
    assert.equal(sha(fixture), sourceHash);
    pass(
      "Cached hollow source project was unchanged; no expensive hollowing regeneration was needed",
    );
  }
  assert.ok(workers.length);
  assert.deepEqual(errors, []);
  pass(
    "Packaged app runs with no development tools on PATH and external network requests blocked",
    {
      workers: workers.length,
      externalRequests: requests.filter(
        (u) =>
          !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u) &&
          !u.startsWith("blob:"),
      ).length,
    },
  );
} catch (e) {
  errors.push(e.stack || String(e));
  console.error(e);
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      { executable, profile, sourceHash, checks, errors, workers },
      null,
      2,
    ),
  );
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.removeAllListeners("will-prevent-unload");
          w.webContents.on("will-prevent-unload", (e) => e.preventDefault());
        }
      })
      .catch(() => {});
    await Promise.race([app.close(), pause(12000)]);
    if (child.exitCode === null) {
      console.error(`Validator-owned app PID ${pid} did not exit`);
      process.exitCode = 1;
    }
  }
}
