import { _electron as electron } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";
import { strictTopology } from "./manufacturing-file-audit.mjs";

const require = createRequire(import.meta.url);
const { encodeRequest, decodeResult } = require("./native-geometry-protocol.cjs");

const root = path.resolve(".");
const executable = path.resolve(
  process.argv.slice(2).find((value) => value.endsWith(".exe")) ||
    "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe",
);
const resources = path.join(path.dirname(executable), "resources");
const output = path.resolve(
  process.env.LAYERLING_BRANDING_VALIDATION_DIR ||
    `.codex-run/branding12/packaged-${Date.now()}`,
);
const profile = path.join(output, "profile");
const branding = JSON.parse(
  readFileSync(path.join(root, "apps/web/src/config/productBranding.json"), "utf8"),
);
const expectedVersion = process.env.LAYERLING_BRANDING_EXPECT_VERSION || branding.version;
const sourceZip = path.join(resources, "sources/Layerling-Ultimate-Source.zip");
const checks = [];
const errors = [];
const requests = [];
const failedRequests = [];
let app;
let page;
let connection;
let editorId;
let child;

mkdirSync(output, { recursive: true });
const pass = (name, detail = "") => {
  checks.push({ name, result: "PASS", detail });
  console.log("PASS", name, detail);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch() {
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
  page = await app.firstWindow({ timeout: 90000 });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  page.on("requestfailed", (request) =>
    failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.getByRole("button", { name: "Create new 3D design", exact: true }).waitFor();
  const connectionPath = path.join(profile, "connection.json");
  connection = JSON.parse(readFileSync(connectionPath, "utf8"));
}

async function closeApp() {
  if (!app) return;
  const ownedApp = app;
  const ownedChild = child;
  await ownedApp
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.removeAllListeners("will-prevent-unload");
        window.webContents.on("will-prevent-unload", (event) => event.preventDefault());
      }
    })
    .catch(() => {});
  await Promise.race([ownedApp.close(), delay(12000)]).catch(() => {});
  if (ownedChild?.exitCode === null) ownedChild.kill();
  app = undefined;
  page = undefined;
  child = undefined;
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
  assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`);
  return result.data;
}

async function editorReady(projectName) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const response = await fetch(`${connection.url}/api/layerling-mcp`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
    const result = await response.json();
    const editor = result.editors?.find(
      (candidate) =>
        Date.now() - candidate.lastSeen < 10000 &&
        (!projectName || candidate.projectName === projectName),
    );
    if (editor) {
      editorId = editor.editorId;
      return editor;
    }
    await delay(200);
  }
  throw new Error("Packaged editor did not register with MCP");
}

async function openFromDashboard(file) {
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(file);
  await page.waitForTimeout(1200);
}

function projectJson(file) {
  const entries = unzipSync(readFileSync(file));
  assert.ok(entries["project.json"], `${path.basename(file)} has no project.json`);
  return JSON.parse(strFromU8(entries["project.json"]));
}

function shapeSignature(project) {
  const state = project.states?.at(-1);
  assert.ok(state && Array.isArray(state.nodes), "Saved project has no scene node records");
  return {
    stateId: state.id,
    rootNodeIds: state.rootNodeIds,
    nodes: state.nodes,
    groups: project.groups,
    assets: project.assets,
  };
}

try {
  assert.ok(existsSync(executable), `Packaged executable missing: ${executable}`);
  assert.ok(existsSync(sourceZip), `Bundled source archive missing: ${sourceZip}`);
  const packagedIcon = path.join(resources, "icon.png");
  assert.ok(existsSync(packagedIcon) && readFileSync(packagedIcon).length > 100);
  const mainSource = readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
  assert.match(mainSource, /app\.setAppUserModelId\(ultimate\s*\?\s*'org\.layerling\.ultimate'/);
  assert.match(mainSource, /path\.join\(resources, 'icon\.png'\)/);
  pass("Packaged executable and nonempty configured window icon are present");

  await launch();
  const nativeIdentity = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    name: electronApp.getName(),
    version: electronApp.getVersion(),
    userData: electronApp.getPath("userData"),
    title: BrowserWindow.getAllWindows()[0]?.getTitle(),
  }));
  assert.equal(nativeIdentity.name, branding.name);
  assert.equal(nativeIdentity.version, expectedVersion);
  assert.equal(path.resolve(nativeIdentity.userData), profile);
  assert.equal(nativeIdentity.title, branding.name);
  assert.equal(connection.version, expectedVersion);
  pass("Native app name, window title, packaged version, and isolated profile match branding", nativeIdentity);

  const shortcut = path.join(output, `${branding.name}.lnk`);
  const shortcutResult = await app.evaluate(
    ({ shell }, { shortcutPath, target, label }) => {
      const ok = shell.writeShortcutLink(shortcutPath, "create", {
        target,
        description: label,
        appUserModelId: "org.layerling.ultimate",
        icon: target,
        iconIndex: 0,
      });
      return { ok, details: shell.readShortcutLink(shortcutPath) };
    },
    { shortcutPath: shortcut, target: executable, label: branding.name },
  );
  assert.ok(shortcutResult.ok);
  assert.equal(path.resolve(shortcutResult.details.target), executable);
  assert.equal(shortcutResult.details.description, branding.name);
  assert.equal(shortcutResult.details.appUserModelId, "org.layerling.ultimate");
  assert.equal(path.resolve(shortcutResult.details.icon), executable);
  pass("Windows shortcut API writes and reads branded shortcut in run output only", {
    ...shortcutResult.details,
    installerShortcutIconSource: executable,
    nsisUsesExecutableIconDefault: true,
  });

  const visibleExternal = await page.locator('a[href^="http"]').evaluateAll((anchors) =>
    anchors.filter((anchor) => anchor.getClientRects().length).map((anchor) => anchor.href),
  );
  assert.deepEqual(visibleExternal, [], "Dashboard unexpectedly exposes external links");
  const dashboardFooter = await page.locator("footer a").evaluateAll((anchors) =>
    anchors.map((anchor) => ({ text: anchor.textContent?.trim(), href: anchor.getAttribute("href") })),
  );
  assert.ok(dashboardFooter.some((link) => link.href === "/desktop/about.html"));
  assert.ok(dashboardFooter.some((link) => link.text?.toLowerCase().includes("help")));
  assert.ok(dashboardFooter.every((link) => link.href?.startsWith("/")));
  pass("Dashboard footer exposes only local Help and About links", dashboardFooter);
  await page.screenshot({ path: path.join(output, "dashboard.png"), fullPage: true });

  const aboutResponse = await page.request.get(`${connection.url}/desktop/about.html`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  assert.equal(aboutResponse.status(), 200);
  const aboutHtml = await aboutResponse.text();
  assert.ok(aboutHtml.includes(branding.name));
  assert.ok(aboutHtml.includes(branding.version));
  assert.match(aboutHtml, /Layerling contributors/i);
  assert.match(aboutHtml, /href=["']\/desktop\/licenses\/index\.html/);
  assert.match(aboutHtml, /href=["']\/desktop\/licenses\/source\.html/);
  const licenseResponse = await page.request.get(`${connection.url}/desktop/licenses/index.html`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  const sourceResponse = await page.request.get(`${connection.url}/desktop/licenses/source.html`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  assert.equal(licenseResponse.status(), 200);
  assert.equal(sourceResponse.status(), 200);
  const licenseHtml = await licenseResponse.text();
  const sourceHtml = await sourceResponse.text();
  assert.match(licenseHtml, /AGPL-3\.0/i);
  assert.match(sourceHtml, /AGPL-3\.0/i);
  assert.match(sourceHtml, /Layerling-Ultimate-Source\.zip/);
  const licenseDocumentLink = licenseHtml.match(
    /<a href=["']([^"']+)["']>Layerling-LICENSE<\/a>/i,
  );
  assert.ok(licenseDocumentLink, "License index does not link the Layerling license text");
  const licenseDocumentResponse = await page.request.get(
    new URL(licenseDocumentLink[1], connection.url).toString(),
    { headers: { Authorization: `Bearer ${connection.token}` } },
  );
  assert.equal(licenseDocumentResponse.status(), 200);
  const licenseDocument = await licenseDocumentResponse.text();
  assert.match(licenseDocument, /GNU AFFERO GENERAL PUBLIC LICENSE/i);
  const rootLicense = readFileSync(path.join(root, "LICENSE"));
  const packagedLicense = readFileSync(path.join(resources, "legal/Layerling-LICENSE"));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(packagedLicense), hash(rootLicense));
  const sourceEntries = unzipSync(readFileSync(sourceZip));
  const brandSourcePath = Object.keys(sourceEntries).find((entry) =>
    /(?:^|\/)productBranding\.json$/i.test(entry),
  );
  assert.ok(brandSourcePath, "Source archive omits productBranding.json");
  const archivedBranding = JSON.parse(strFromU8(sourceEntries[brandSourcePath]));
  assert.equal(archivedBranding.name, branding.name);
  assert.equal(archivedBranding.version, branding.version);
  pass("Local About, licenses, AGPL source access, and branded source archive work", {
    sourceEntry: brandSourcePath,
    archiveBytes: readFileSync(sourceZip).length,
  });

  const helpPopup = await Promise.all([
    page.waitForEvent("popup"),
    page.locator(`footer a[href="${branding.helpPath}"]`).click(),
  ]).then(([popup]) => popup);
  assert.ok(helpPopup.url().startsWith(connection.url));
  assert.equal(new URL(helpPopup.url()).pathname, branding.helpPath);
  await helpPopup.close();
  const aboutPopup = await Promise.all([
    page.waitForEvent("popup"),
    page.locator('footer a[href="/desktop/about.html"]').click(),
  ]).then(([popup]) => popup);
  assert.ok(new URL(aboutPopup.url()).pathname.endsWith("/desktop/about.html"));
  await aboutPopup.close();
  pass("Footer Help and About navigation opens packaged local pages");

  const menuAbout = await Promise.all([
    page.waitForEvent("popup"),
    app.evaluate(({ Menu }, label) => {
      const help = Menu.getApplicationMenu().items.find((item) => item.label === "Help");
      const about = help?.submenu?.items.find((item) => item.label === `About ${label}`);
      if (!about) throw new Error("Native About menu item missing");
      about.click();
    }, branding.name),
  ]).then(([popup]) => popup);
  assert.ok(new URL(menuAbout.url()).pathname.endsWith("/desktop/about.html"));
  await menuAbout.close();
  pass("Native About menu opens the local About page");

  const externalWindowDenied = await page.evaluate(() =>
    window.open("https://example.com/codex-offline-probe", "external-offline-probe"),
  );
  assert.equal(externalWindowDenied, null, "Native window policy allowed an external popup");
  const externalNavigationDenied = await app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    return mainWindow.webContents.getURL();
  });
  assert.ok(externalNavigationDenied.startsWith(connection.url));
  pass("Native window policy denies external popup navigation");

  const updaterRequests = () =>
    requests.filter((url) => /api\.github\.com|\/version\/upstream/i.test(url));
  assert.deepEqual(updaterRequests(), [], "Private desktop made a public updater request");
  pass("Normal UI made no GitHub or upstream version-check request");

  const logPath = path.join(profile, "desktop.log");
  const blockedOrigins = readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("Blocked external request:"));
  const externalAttempts = requests.filter(
    (url) => /^https?:/.test(url) && !/localhost|127\.0\.0\.1/.test(new URL(url).hostname),
  );
  for (const url of externalAttempts) {
    const origin = new URL(url).origin;
    assert.ok(
      failedRequests.some((entry) => entry.url === url),
      `External request did not fail under network policy: ${origin}`,
    );
    assert.ok(
      blockedOrigins.some((line) => line.includes(origin)),
      `Native policy did not log blocked origin: ${origin}`,
    );
  }
  pass("Every observed incidental external request failed and has a native blocked-origin log", {
    count: externalAttempts.length,
    origins: [...new Set(externalAttempts.map((url) => new URL(url).origin))],
  });

  const fixtureRoot = path.join(root, ".codex-run/export11");
  const fixtureDirectories = existsSync(fixtureRoot)
    ? readdirSync(fixtureRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("packaged-"))
        .map((entry) => path.join(fixtureRoot, entry.name))
        .sort((a, b) => b.localeCompare(a))
    : [];
  const fixture = path.resolve(
    process.env.LAYERLING_BRANDING_PLATE_PROJECT ||
      fixtureDirectories.map((directory) => path.join(directory, "seven-hole-plate.lyl"))
        .find(existsSync) || "",
  );
  assert.ok(fixture && existsSync(fixture), "Set LAYERLING_BRANDING_PLATE_PROJECT to the saved .11 plate project");
  await openFromDashboard(fixture);
  const fixtureEditor = await editorReady();
  const fixtureObjects = (await command("list_objects")).objects;
  assert.ok(fixtureObjects.length > 0, "The saved plate project opened with no objects");
  const fixtureOriginal = projectJson(fixture);
  const fixtureBeforeSignature = shapeSignature(fixtureOriginal);
  const fixtureSaved = await command("save_project", { history: "all" });
  const fixtureSavedFile = path.join(output, "seven-hole-roundtrip.lyl");
  writeFileSync(fixtureSavedFile, Buffer.from(fixtureSaved.base64, "base64"));
  const fixtureAfterSignature = shapeSignature(projectJson(fixtureSavedFile));
  assert.deepEqual(fixtureAfterSignature, fixtureBeforeSignature);
  pass("Preexisting .11 seven-hole project imports and preserves shape/source records on MCP save", {
    fixture: path.basename(fixture),
    projectName: fixtureEditor.projectName,
    objects: fixtureObjects.length,
    shapeRecords: fixtureBeforeSignature.nodes.length,
  });

  const manifoldModule = await import("manifold-3d");
  const manifold = await manifoldModule.default();
  manifold.setup();
  const nativeSolid = manifold.Manifold.cube([12, 12, 12], true);
  let nativeMesh;
  try {
    nativeMesh = nativeSolid.getMesh();
    const nativeRequest = encodeRequest(
      {
        positions: nativeMesh.vertProperties,
        indices: nativeMesh.triVerts,
        thickness: 1,
        options: { maxErrorMm: 0.2 },
      },
      0,
    );
    assert.equal(nativeMesh.triVerts.length / 3, 12, "Native smoke source is not a 12-triangle cube");
    const nativeReply = await page.evaluate(
      async ({ requestBytes, jobId }) => {
        const bridge = window.layerlingGeometry;
        if (!bridge) throw new Error("Native geometry preload bridge is unavailable");
        const reply = await bridge.run(jobId, Uint8Array.from(requestBytes));
        return {
          ok: reply.ok,
          message: reply.message,
          stats: reply.stats,
          bytes: reply.bytes ? Array.from(reply.bytes) : [],
        };
      },
      { requestBytes: Array.from(nativeRequest), jobId: "branding-native-smoke" },
    );
    assert.ok(nativeReply.ok, nativeReply.message || "Native cube hollow failed");
    assert.equal(nativeReply.stats?.backend, "native-cpu");
    assert.equal(nativeReply.stats?.method, "mesh-sdf");
    assert.equal(nativeReply.stats?.sourceTriangles, 12);
    assert.equal(nativeReply.stats?.maxErrorMm, 0.2);
    assert.ok(Number.isFinite(nativeReply.stats?.measuredErrorMm));
    assert.ok((nativeReply.stats?.measuredErrorMm ?? Infinity) >= 0);
    assert.ok((nativeReply.stats?.measuredErrorMm ?? Infinity) <= 0.2);
    assert.ok(Number.isFinite(nativeReply.stats?.cellSizeMm));
    assert.ok((nativeReply.stats?.cellSizeMm ?? 0) > 0);
    assert.ok((nativeReply.stats?.resultVolumeMm3 ?? 0) > 0);
    assert.ok((nativeReply.stats?.resultVolumeMm3 ?? Infinity) < 1728);

    const nativeBytes = Buffer.from(nativeReply.bytes);
    const decodedNative = decodeResult(nativeBytes);
    const nativeVertices = Array.from(
      { length: decodedNative.positions.length / 3 },
      (_, index) => Array.from(decodedNative.positions.slice(index * 3, index * 3 + 3)),
    );
    const nativeFaces = Array.from(
      { length: decodedNative.indices.length / 3 },
      (_, index) => Array.from(decodedNative.indices.slice(index * 3, index * 3 + 3)),
    );
    assert.equal(nativeFaces.length, nativeReply.stats?.resultTriangles);
    const nativeBounds = [0, 1, 2].map((axis) => {
      const coordinates = nativeVertices.map((vertex) => vertex[axis]);
      const minimum = Math.min(...coordinates);
      const maximum = Math.max(...coordinates);
      return { minimum, maximum, span: maximum - minimum };
    });
    for (const bound of nativeBounds) {
      assert.ok(Number.isFinite(bound.minimum) && Number.isFinite(bound.maximum));
      assert.ok(Math.abs(bound.span - 12) <= 0.4, "Native cube outside bounds changed unexpectedly");
    }
    const nativeTopology = strictTopology(nativeVertices, nativeFaces);
    assert.ok(nativeTopology.volumeMm3 > 0);
    const nativeOutputPath = path.join(output, "native-worker-cube-result.native");
    const nativeStatsPath = path.join(output, "native-worker-cube-stats.json");
    writeFileSync(nativeOutputPath, nativeBytes);
    writeFileSync(
      nativeStatsPath,
      JSON.stringify(
        {
          source: { shape: "12 mm closed cube", triangles: nativeMesh.triVerts.length / 3 },
          settings: { thicknessMm: 1, maxErrorMm: 0.2, pitchMm: 0 },
          stats: nativeReply.stats,
          bounds: nativeBounds,
          topology: nativeTopology,
          outputBytes: nativeBytes.length,
        },
        null,
        2,
      ),
    );
    pass("Packaged native geometry binary hollowed a 12 mm cube through the preload bridge", {
      backend: nativeReply.stats?.backend,
      sourceTriangles: nativeReply.stats?.sourceTriangles,
      resultTriangles: nativeTopology.triangles,
      measuredErrorMm: nativeReply.stats?.measuredErrorMm,
      bounds: nativeBounds,
      nativeOutput: path.basename(nativeOutputPath),
      stats: path.basename(nativeStatsPath),
    });
  } finally {
    nativeMesh?.delete?.();
    nativeSolid.delete();
    manifold.Module?.delete?.();
  }

  await page.screenshot({ path: path.join(output, "editor.png"), fullPage: true });
  const editorExternal = await page.locator('a[href^="http"]').evaluateAll((anchors) =>
    anchors.filter((anchor) => anchor.getClientRects().length).map((anchor) => anchor.href),
  );
  assert.deepEqual(editorExternal, [], "Editor unexpectedly exposes external links");
  const editorFooter = await page.locator("footer a").evaluateAll((anchors) =>
    anchors.map((anchor) => ({ text: anchor.textContent?.trim(), href: anchor.getAttribute("href") })),
  );
  assert.ok(editorFooter.every((link) => link.href?.startsWith("/")));
  pass("Editor branding is visible and footer links remain local", editorFooter);

  await page.getByRole("button", { name: "Quick guide", exact: true }).click();
  const guideDialog = page.getByRole("dialog", { name: "Quick guide" });
  await guideDialog.waitFor();
  const guideExternal = await guideDialog.locator('a[href^="http"]').evaluateAll((anchors) =>
    anchors.filter((anchor) => anchor.getClientRects().length).map((anchor) => anchor.href),
  );
  assert.deepEqual(guideExternal, [], "Quick Guide unexpectedly exposes public links");
  const guideLinks = await guideDialog.locator("a").evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href")),
  );
  assert.ok(guideLinks.every((href) => href?.startsWith("/")));
  await guideDialog.locator(".workspace-modal-card").getByRole("button", { name: "Close the quick guide", exact: true }).click();
  pass("Editor Quick Guide hides public video links and retains local full guide link", guideLinks);

  const expectedShapes = shapeSignature(projectJson(fixtureSavedFile));
  await closeApp();
  await launch();
  await openFromDashboard(fixtureSavedFile);
  await editorReady();
  const reopened = await command("save_project", { history: "all" });
  const reopenedFile = path.join(output, "seven-hole-reopened.lyl");
  writeFileSync(reopenedFile, Buffer.from(reopened.base64, "base64"));
  assert.deepEqual(shapeSignature(projectJson(reopenedFile)), expectedShapes);
  const restartedIdentity = await app.evaluate(({ app: electronApp }) => ({
    name: electronApp.getName(),
    userData: electronApp.getPath("userData"),
  }));
  assert.equal(restartedIdentity.name, branding.name);
  assert.equal(path.resolve(restartedIdentity.userData), profile);
  pass("Saved project reopens after app restart in the same isolated profile");

  const nativeLog = readFileSync(logPath, "utf8");
  assert.ok(
    externalAttempts.every((url) => nativeLog.includes(new URL(url).origin)),
    "An observed external request is missing its native blocked-origin evidence",
  );
  assert.deepEqual(errors, []);
  pass("Packaged branding smoke completed with external HTTP(S) denied", {
    requests: requests.length,
    failedRequests: failedRequests.filter((entry) => /^https?:/.test(entry.url)).length,
    profile,
  });
  await page.screenshot({ path: path.join(output, "reopened-project.png"), fullPage: true });
} catch (error) {
  errors.push(error.stack || String(error));
  console.error(error);
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        executable,
        expectedVersion,
        profile,
        checks,
        errors,
        requests: requests.map((url) => ({ external: /^https?:/.test(url) && !/localhost|127\.0\.0\.1/.test(url) })),
        failedRequests: failedRequests.map((entry) => ({
          external: /^https?:/.test(entry.url) && !/localhost|127\.0\.0\.1/.test(entry.url),
          failure: entry.failure,
        })),
      },
      null,
      2,
    ),
  );
  await closeApp();
}
