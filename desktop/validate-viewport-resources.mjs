import { _electron as electron } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const executable = path.resolve(
  process.argv[2] ||
    "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe",
);
const fixture = path.resolve(
  process.env.LAYERLING_VIEWPORT_RESOURCE_FIXTURE ||
    ".codex-run/viewport7/baseline-corrected/100000-1793245334613/collar-100000.stl",
);
const output = path.resolve(
  process.env.LAYERLING_VIEWPORT_RESOURCE_DIR ||
    ".codex-run/viewport7/resource-validation",
);
const expectedVersion =
  process.env.LAYERLING_VIEWPORT_RESOURCE_EXPECTED_VERSION || null;
const expectClosedContextLoss = expectedVersion?.endsWith(".7") ?? false;
const profile = path.join(output, `isolated-profile-${Date.now()}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(output, { recursive: true });
const report = {
  fixture,
  executable,
  expectedVersion,
  expectClosedContextLoss,
  startedAt: new Date().toISOString(),
  rendererErrors: [],
  diagnostics: { pageErrors: [], consoleErrors: [], limitations: [] },
  cycles: [],
  contextRetentionTest:
    "Each closed Smooth Mesh canvas and WebGL context is intentionally retained in page JavaScript until all three cycles complete. Context loss while references remain is evidence of explicit release, but this is not a proof that all GPU resources were reclaimed.",
};
let app;
let page;
let connection;
let editorId;

const rendererError = (message) => {
  if (!report.rendererErrors.includes(message)) report.rendererErrors.push(message);
};

async function appMetrics() {
  return app.evaluate(({ app }) =>
    app.getAppMetrics().map((entry) => ({
      pid: entry.pid,
      type: entry.type,
      cpu: entry.cpu,
      memory: entry.memory,
      creationTime: entry.creationTime,
    })),
  );
}

async function heapUsage(cdp) {
  return cdp.send("Runtime.getHeapUsage");
}

async function command(action, params = {}) {
  const response = await fetch(`${connection.url}/api/layerling-mcp`, {
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
  if (!result.ok) throw Error(`${action}: ${JSON.stringify(result)}`);
  return result.data;
}

async function readyEditor(projectName) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await fetch(`${connection.url}/api/layerling-mcp`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
    const json = await response.json();
    const editor = json.editors
      ?.filter(
        (entry) =>
          Date.now() - entry.lastSeen < 10000 &&
          (!projectName || entry.projectName === projectName),
      )
      .sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (editor) {
      editorId = editor.editorId;
      return editor;
    }
    await pause(200);
  }
  throw Error("Layerling editor did not register with MCP");
}

async function webglInfo(canvas) {
  return page.evaluate((element) => {
    const gl =
      element.getContext("webgl2") ||
      element.getContext("webgl") ||
      element.getContext("experimental-webgl");
    if (!gl) return { available: false, contextAttributes: null };
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      available: true,
      contextType:
        gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl",
      vendor: extension
        ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
        : null,
      renderer: extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : null,
      maskedVendor: gl.getParameter(gl.VENDOR),
      maskedRenderer: gl.getParameter(gl.RENDERER),
      contextAttributes: gl.getContextAttributes(),
      contextLost: gl.isContextLost(),
    };
  }, canvas);
}

async function mainContextStatus() {
  return page.evaluate(() => {
    const gl = window.__viewportResourceMainGL;
    return {
      contextLost: gl ? gl.isContextLost() : null,
      canvasCount: document.querySelectorAll("canvas").length,
      contextLossEvents: window.__viewportResourceMainLosses || [],
    };
  });
}

try {
  app = await electron.launch({
    executablePath: executable,
    cwd: output,
    timeout: 90000,
    args: ["--window-size=1424,900", "--force-device-scale-factor=1"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      PATH: process.env.SystemRoot + "\\System32",
      LAYERLING_DESKTOP_PROFILE: profile,
      LAYERLING_DESKTOP_TEST: "1",
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1424, height: 900 });
  page.on("pageerror", (error) =>
    report.diagnostics.pageErrors.push(error.message),
  );
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    report.diagnostics.consoleErrors.push(text);
    if (/webgl|context.?lost|gpu process|gl error|renderer error/i.test(text)) {
      rendererError(text);
    }
  });
  await page
    .getByRole("button", { name: "Create new 3D design", exact: true })
    .waitFor({ timeout: 90000 });

  connection = JSON.parse(readFileSync(path.join(profile, "connection.json"), "utf8"));
  const fixtureProjectName = path.basename(fixture, path.extname(fixture));
  await page
    .getByRole("button", { name: "Create new 3D design", exact: true })
    .click();
  await readyEditor();
  await page
    .locator('input[type="file"][accept*=".stl"]')
    .first()
    .setInputFiles(fixture);
  await readyEditor(fixtureProjectName);

  let source;
  const importDeadline = Date.now() + 120000;
  while (Date.now() < importDeadline) {
    source = (await command("list_objects")).objects.find(
      (object) => object.importedTriangles === 100000,
    );
    if (source) break;
    await pause(300);
  }
  if (!source) throw Error("The supplied 100k fixture did not import");
  await command("select_objects", { ids: [source.id] });

  const mainCanvas = page.locator("canvas").first();
  await mainCanvas.waitFor({ timeout: 30000 });
  const mainGL = await webglInfo(await mainCanvas.elementHandle());
  report.mainCanvas = mainGL;
  report.importedObject = {
    id: source.id,
    triangles: source.importedTriangles,
  };
  report.runtime = await app.evaluate(async ({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    gpuInfo: await app.getGPUInfo("complete").catch((error) => ({
      error: error.message,
    })),
  }));
  report.initialProcessMetrics = await appMetrics();
  report.initialMainContext = await mainContextStatus();
  if (!mainGL.available) {
    report.diagnostics.limitations.push("Main viewport WebGL context unavailable");
  } else if (mainGL.contextLost) {
    rendererError("Main viewport WebGL context was already lost after import");
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await page.evaluate(() => {
    window.__viewportResourceHeld = [];
    window.__viewportResourceMainLosses = [];
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    window.__viewportResourceMainGL = gl || null;
    canvas?.addEventListener("webglcontextlost", () => {
      window.__viewportResourceMainLosses.push(performance.now());
    });
  });

  for (let index = 0; index < 3; index += 1) {
    const cycle = { index: index + 1, rendererErrors: [] };
    cycle.before = {
      at: new Date().toISOString(),
      heap: await heapUsage(cdp),
      processes: await appMetrics(),
      mainContext: await mainContextStatus(),
    };
    const openedAt = Date.now();
    await page.getByRole("button", { name: "Smooth Mesh", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Smooth Mesh" });
    await dialog.waitFor({ timeout: 30000 });
    const canvas = dialog.locator("canvas");
    await canvas.waitFor({ timeout: 30000 });
    cycle.smoothMeshCanvas = await webglInfo(await canvas.elementHandle());
    await page.evaluate((element) => {
      const gl =
        element.getContext("webgl2") ||
        element.getContext("webgl") ||
        element.getContext("experimental-webgl");
      window.__viewportResourceHeld.push({ canvas: element, gl });
    }, await canvas.elementHandle());
    cycle.canvasCountWhileOpen = await page.locator("canvas").count();

    let readyState = "deadline";
    try {
      readyState = await page
        .waitForFunction(() => {
          const panel = document.querySelector(
            '[role="dialog"][aria-label="Smooth Mesh"]',
          );
          const error = panel?.querySelector('[role="alert"]')?.textContent?.trim();
          const preview = [...(panel?.querySelectorAll("button") || [])].find(
            (button) => button.textContent?.trim() === "Preview",
          );
          return error
            ? `error:${error}`
            : preview && !preview.disabled
              ? "ready"
              : false;
        }, null, { timeout: 60000 })
        .then((handle) => handle.jsonValue());
    } catch {}
    cycle.readyState = readyState;
    cycle.openReadyOrErrorMs = Date.now() - openedAt;
    if (readyState === "deadline") {
      report.diagnostics.limitations.push(
        `Smooth Mesh cycle ${index + 1} did not reach ready/error within 60s`,
      );
    }

    const closeStartedAt = Date.now();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await pause(250);
    cycle.closeMs = Date.now() - closeStartedAt;
    cycle.settleWaitAfterCloseMs = 250;
    cycle.afterCancel = await page.evaluate((heldIndex) => {
      const held = window.__viewportResourceHeld[heldIndex];
      return {
        at: performance.now(),
        heldReferenceCount: window.__viewportResourceHeld.length,
        contextLost: held?.gl ? held.gl.isContextLost() : null,
        canvasConnected: held?.canvas?.isConnected ?? null,
        canvasCount: document.querySelectorAll("canvas").length,
      };
    }, index);
    cycle.after = {
      at: new Date().toISOString(),
      heapBeforeGC: await heapUsage(cdp),
      processesBeforeGC: await appMetrics(),
      mainContext: await mainContextStatus(),
    };
    await cdp.send("HeapProfiler.collectGarbage");
    cycle.after.heapAfterGC = await heapUsage(cdp);
    cycle.after.processesAfterGC = await appMetrics();
    cycle.contextLossExpectation = expectClosedContextLoss
      ? "required"
      : expectedVersion?.endsWith(".6")
        ? "may-not-be-lost"
        : "not-specified";
    if (cycle.afterCancel.contextLost === false && expectClosedContextLoss) {
      cycle.rendererErrors.push(
        "Smooth Mesh WebGL context was not lost after close; expected-version suffix .7 requires loss",
      );
      rendererError(cycle.rendererErrors.at(-1));
    }
    if (cycle.after.mainContext.contextLost) {
      cycle.rendererErrors.push("Main viewport WebGL context was lost after Smooth Mesh close");
      rendererError(cycle.rendererErrors.at(-1));
    }
    report.cycles.push(cycle);
  }

  await page.evaluate(() => {
    window.__viewportResourceHeld = [];
  });
  report.retainedReferencesReleased = await page.evaluate(
    () => window.__viewportResourceHeld.length === 0,
  );
  report.finalMainContext = await mainContextStatus();
  if (report.finalMainContext.contextLost) {
    rendererError("Main viewport WebGL context was lost by final resource validation");
  }
  report.finalProcessMetrics = await appMetrics();
  report.finalHeap = await heapUsage(cdp);
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.diagnostics.harnessError = error.stack || String(error);
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    try {
      report.finalMainContext = await mainContextStatus();
    } catch {}
  }
} finally {
  if (page) {
    await page.evaluate(() => {
      window.__viewportResourceHeld = [];
    }).catch(() => {});
    report.retainedReferencesReleased ??= true;
  }
  if (app) {
    try {
      report.finalProcessMetrics ??= await appMetrics();
    } catch {}
    await app.close().catch(() => {});
  }
  report.finishedAt ??= new Date().toISOString();
  const reportFile = path.join(output, "report.json");
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      report: reportFile,
      rendererErrors: report.rendererErrors.length,
      cycles: report.cycles.length,
      expectedVersion,
    }),
  );
  if (report.rendererErrors.length) process.exitCode = 1;
}
