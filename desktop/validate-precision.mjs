import { _electron as electron } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { unzipSync, strFromU8 } from "fflate";

const executable = path.resolve(
  process.argv.find((s) => s.endsWith(".exe")) ||
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
const profile = path.join(output, "isolated-profile");
mkdirSync(output, { recursive: true });
const checks = [],
  errors = [],
  requests = [],
  workers = [],
  workerHandles = [];
let app, page, connection, editorId, pid;
const sha = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const sourceHash = existsSync(fixture) ? sha(fixture) : null;
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
async function ready() {
  for (let i = 0; i < 150; i++) {
    const r = await fetch(connection.url + "/api/layerling-mcp", {
        headers: { Authorization: `Bearer ${connection.token}` },
      }),
      json = await r.json();
    const editor = json.editors?.find((e) => Date.now() - e.lastSeen < 10000);
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
  await page.getByRole("region", { name: "Precision Mesh Studio" }).waitFor();
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
  const event = page.waitForEvent("download");
  await button.click();
  const item = await event;
  await item.saveAs(path.join(output, file));
  assert.ok(readFileSync(path.join(output, file)).length > 0);
  return path.join(output, file);
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
  pid = app.process().pid;
  await app.evaluate(({ session }, directory) => {
    const path = process.getBuiltinModule("path");
    session.defaultSession.on("will-download", (_e, item) =>
      item.setSavePath(path.join(directory, item.getFilename())),
    );
  }, output);
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("worker", (w) => {
    workers.push(w.url());
    workerHandles.push(w);
  });
  await page.context().route("**/*", (r) => {
    const url = r.request().url();
    requests.push(url);
    if (
      /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/)/.test(url) ||
      /^(blob:|data:)/.test(url)
    )
      return r.continue();
    return r.abort();
  });
  await page
    .getByRole("button", { name: "Create new 3D design", exact: true })
    .waitFor({ timeout: 90000 });
  connection = JSON.parse(readFileSync(path.join(profile, "connection.json")));
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
  await preview();
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
  const closed = new Promise((r) =>
    workerHandles.at(-1).on("close", () => r()),
  );
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
  if (sourceHash) {
    await page
      .locator('input[type=file][accept*=".lyl"]')
      .first()
      .setInputFiles(fixture);
    await ready();
    await page.waitForFunction(() => document.body.innerText.includes("Group"));
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
    pass("Raw organic export remains blocked by manufacturing defects");
    await page
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
      "Explicit organic repair yields strict manifold STL with wall concern retained",
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
    if (app.process().exitCode === null) {
      console.error(`Validator-owned app PID ${pid} did not exit`);
      process.exitCode = 1;
    }
  }
}
