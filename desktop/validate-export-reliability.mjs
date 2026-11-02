import { _electron as electron } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { verify3mf, verifyStl } from "./manufacturing-file-audit.mjs";

const executable = path.resolve(
  process.argv.slice(2).find((value) => value.endsWith(".exe")) ||
    "dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe",
);
const output = path.resolve(
  `.codex-run/export11/packaged-${Date.now()}`,
);
const profile = path.join(output, "isolated-profile");
const expectedVersion =
  process.env.LAYERLING_EXPECTED_APP_VERSION || "1.114.0-ultimate.11";
const expectLegacyIntersectionFailure =
  process.env.LAYERLING_EXPORT_EXPECT_FAILURE === "1";
mkdirSync(output, { recursive: true });

const checks = [];
const errors = [];
const requests = [];
let app, page, connection, editorId, child;

const pass = (name, detail) => {
  checks.push({ name, detail });
  console.log("PASS", name);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const externalHttpRequests = () =>
  requests.filter(
    (url) =>
      /^https?:/.test(url) &&
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url) &&
      !/^https?:\/\/example\.com(?:\/|$)/.test(url),
  );

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
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function ready(projectName) {
  for (let i = 0; i < 150; i++) {
    const response = await fetch(`${connection.url}/api/layerling-mcp`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    }),
      json = await response.json();
    const editor = json.editors
      ?.filter(
        (candidate) =>
          Date.now() - candidate.lastSeen < 10000 &&
          (!projectName || candidate.projectName === projectName),
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
  await page.locator(".precision-results").waitFor({ timeout: 180000 });
}

async function download(button, name) {
  const target = path.join(output, name);
  await app.evaluate((_electron, file) => {
    globalThis.__exportReliabilityDownloadTarget = file;
    globalThis.__exportReliabilityDownloadDone = null;
  }, target);
  await button.click();
  let done = null;
  for (let i = 0; i < 600; i++) {
    done = await app.evaluate(
      () => globalThis.__exportReliabilityDownloadDone,
    );
    if (done) break;
    await pause(100);
  }
  assert.equal(done, "completed", "Native Electron download did not complete");
  assert.ok(readFileSync(target).length > 0);
  return target;
}

function binaryTetrahedraStl() {
  const tetra = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];
  const points = [
    [0, 0, 0],
    [0, 2, 0],
    [2, 0, 0],
    [0, 0, 2],
  ];
  const vertices = [...points, ...points.map((p) => p.map((v) => v + 0.25))];
  const faces = [...tetra, ...tetra.map((face) => face.map((i) => i + 4))];
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.write("Layerling intersecting tetrahedra", 0, "ascii");
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

async function selectFormat(format) {
  await page
    .getByRole("radio", { name: new RegExp(`^${format.toUpperCase()}:`) })
    .click();
}

function sourceSummary(object) {
  return Object.fromEntries(
    [
      "id",
      "name",
      "kind",
      "x",
      "z",
      "elevation",
      "size",
      "width",
      "depth",
      "height",
      "rotation",
      "groupOperation",
    ].map((key) => [key, object?.[key] ?? null]),
  );
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
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.session.on(
      "will-download",
      (_event, item) => {
        if (!globalThis.__exportReliabilityDownloadTarget) return;
        item.setSavePath(globalThis.__exportReliabilityDownloadTarget);
        item.once(
          "done",
          (_event, state) =>
            (globalThis.__exportReliabilityDownloadDone = state),
        );
      },
    );
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page
    .getByRole("button", { name: "Create new 3D design", exact: true })
    .waitFor({ timeout: 90000 });
  connection = JSON.parse(readFileSync(path.join(profile, "connection.json")));
  assert.equal(connection.version, expectedVersion);
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
    "Packaged app should block native external network access",
  );
  pass("Packaged version verified and external native network access blocked", {
    version: connection.version,
  });

  await page
    .getByRole("button", { name: "Create new 3D design", exact: true })
    .click();
  await ready();
  const plate = (
    await command("create_shape", {
      kind: "cylinder",
      name: "Reliability test seven-hole plate",
      width: 80,
      depth: 80,
      height: 6,
      x: 0,
      z: 0,
      elevation: 0,
      size: 80,
      sides: 96,
    })
  ).object;
  const holeObjects = [
    (
      await command("create_shape", {
        kind: "cylinder",
        name: "Center bore",
        width: 12,
        depth: 12,
        height: 10,
        size: 12,
        x: 0,
        z: 0,
        elevation: -2,
        sides: 96,
        hole: true,
      })
    ).object,
  ];
  for (let index = 0; index < 6; index++) {
    const angle = (index * Math.PI) / 3;
    holeObjects.push(
      (
        await command("create_shape", {
          kind: "cylinder",
          name: `Bolt bore ${index + 1}`,
          width: 6,
          depth: 6,
          height: 10,
          size: 6,
          x: 25 * Math.cos(angle),
          z: 25 * Math.sin(angle),
          elevation: -2,
          sides: 96,
          hole: true,
        })
      ).object,
    );
  }
  const holes = holeObjects;
  const grouped = await command("group_objects", {
    ids: [plate.id, ...holes.map((hole) => hole.id)],
  });
  const plateGroup = grouped.object;
  assert.ok(plateGroup?.id, "Native plate grouping did not return a group");
  await command("select_objects", { ids: [plateGroup.id] });
  const initialScene = await command("list_objects");
  const initialPlateSummary = sourceSummary(plateGroup);
  writeFileSync(
    path.join(output, "plate-source-snapshot.json"),
  JSON.stringify(
    { source: initialPlateSummary, scene: initialScene },
    null,
    2,
  ),
  );
  const savedBefore = await command("save_project", { history: "all" });
  const originalProject = Buffer.from(savedBefore.base64, "base64");
  writeFileSync(path.join(output, "seven-hole-plate.lyl"), originalProject);
  const projectBefore = JSON.parse(
    strFromU8(unzipSync(originalProject)["project.json"]),
  );

  await openStudio();
  const cases = [
    { name: "high-first", preset: "high", expected: 3076 },
    { name: "ultra", preset: "ultra", expected: 3912 },
    { name: "custom-edge", preset: "custom", edge: "1", expected: 353884 },
    { name: "high-repeat", preset: "high", expected: 3076 },
  ];
  for (const testCase of cases) {
    await page
      .getByLabel("Mesh quality preset")
      .selectOption(testCase.edge ? "high" : testCase.preset);
    if (testCase.edge)
      await page
        .getByLabel("Maximum edge length (mm; 0 = unrestricted)")
        .fill(testCase.edge);
    for (const format of ["stl", "3mf"]) {
      await selectFormat(format);
      await preview();
      const readyState = await page
        .locator(".precision-results")
        .getAttribute("data-ready");
      const reportName = `${testCase.name}.${format}.mesh-report.json`;
      const reportPath = await download(
        page.getByRole("button", {
          name: "Save manufacturing report",
          exact: true,
        }),
        reportName,
      );
      const report = JSON.parse(readFileSync(reportPath));
      assert.equal(
        report.triangles,
        testCase.expected,
        "Unexpected triangle count",
      );
      if (testCase.name === "custom-edge" && expectLegacyIntersectionFailure) {
        assert.equal(readyState, "false");
        assert.ok(report.bodies[0].surface.selfIntersections.found > 0);
        assert.equal(report.ready, false);
        pass(
          "Legacy custom max-edge result remains blocked by reported intersections",
          {
            format,
            found: report.bodies[0].surface.selfIntersections.found,
          },
        );
        const reviewedExport = page.getByRole("button", {
          name:
            format === "stl"
              ? "Export reviewed Binary STL"
              : "Export reviewed 3MF",
          exact: true,
        });
        assert.equal(await reviewedExport.isDisabled(), true);
        continue;
      }
      assert.equal(readyState, "true", JSON.stringify(report));
      assert.equal(report.bodies[0].surface.selfIntersections.complete, true);
      assert.equal(report.bodies[0].surface.selfIntersections.found, 0);
      const meshName = testCase.name;
      const meshPath = await download(
        page.getByRole("button", {
          name:
            format === "stl"
              ? "Export validated Binary STL"
              : "Export validated 3MF",
          exact: true,
        }),
        `${meshName}.${format}`,
      );
      const topology = format === "stl" ? verifyStl(meshPath) : verify3mf(meshPath);
      assert.equal(topology.triangles, testCase.expected);
      pass(
        "Packaged export independently reimports as strict closed topology",
        {
          case: testCase.name,
          format,
          topology,
          durationMs: report.durationMs,
          analyticDeviationMm: report.bodies[0].analyticDeviationMm,
          totalDeviationBudgetMm: report.bodies[0].totalDeviationBudgetMm,
          contact: report.bodies[0].surface.selfIntersections,
        },
      );
    }
  }

  const currentPlate = (await command("list_objects")).objects.find(
    (object) => object.id === plateGroup.id,
  );
  assert.deepEqual(sourceSummary(currentPlate), initialPlateSummary);
  const savedAfter = await command("save_project", { history: "all" });
  const projectAfter = JSON.parse(
    strFromU8(
      unzipSync(Buffer.from(savedAfter.base64, "base64"))["project.json"],
    ),
  );
  assert.deepEqual(
    projectAfter,
    projectBefore,
    "Export quality changes altered the saved project",
  );
  pass("Plate source summary remains unchanged through export settings and cache transitions");
  await page.screenshot({
    path: path.join(output, "plate-export-success.png"),
    fullPage: true,
  });

  const importResult = await command("import_file", {
    fileName: "intersecting-closed-tetrahedra.stl",
    base64: binaryTetrahedraStl(),
  });
  const imported = importResult.imported?.[0];
  assert.ok(imported?.id, "Intersecting STL fixture did not import");
  await command("select_objects", { ids: [imported.id] });
  await openStudio();
  for (const format of ["stl", "3mf"]) {
    await selectFormat(format);
    await preview();
    const blockedReportPath = await download(
      page.getByRole("button", {
        name: "Save manufacturing report",
        exact: true,
      }),
      `intersecting-tetrahedra.${format}.mesh-report.json`,
    );
    const blockedReport = JSON.parse(readFileSync(blockedReportPath));
    assert.equal(blockedReport.bodies[0].audit.valid, true);
    assert.ok(blockedReport.bodies[0].surface.selfIntersections.found > 0);
    const reviewedExport = page.getByRole("button", {
      name:
        format === "stl" ? "Export reviewed Binary STL" : "Export reviewed 3MF",
      exact: true,
    });
    assert.equal(await reviewedExport.isDisabled(), true);
    assert.equal(
      await page.locator(".precision-results").getAttribute("data-ready"),
      "false",
    );
    await page.screenshot({
      path: path.join(output, "export-reliability.png"),
      fullPage: true,
    });
    pass(
      "Genuinely intersecting closed STL is blocked from manufacturing export",
      {
        format,
        intersections: blockedReport.bodies[0].surface.selfIntersections.found,
      },
    );
  }

  const externalRequests = externalHttpRequests();
  assert.equal(externalRequests.length, 0, "Unexpected external HTTP requests");
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(output, "summary.json"),
    JSON.stringify(
      {
        executable,
        version: connection.version,
        artifactDirectory: output,
        checks,
        externalRequestCount: externalRequests.length,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Artifacts", output);
} catch (error) {
  errors.push(error.stack || String(error));
  console.error(error);
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(
    path.join(output, "summary.json"),
    JSON.stringify(
      {
        executable,
        version: connection?.version ?? null,
        artifactDirectory: output,
        checks,
        errors,
        externalRequestCount: externalHttpRequests().length,
        externalRequests: externalHttpRequests(),
      },
      null,
      2,
    ),
  );
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.removeAllListeners("will-prevent-unload");
          window.webContents.on("will-prevent-unload", (event) =>
            event.preventDefault(),
          );
        }
      })
      .catch(() => {});
    await Promise.race([app.close(), pause(12000)]);
    if (child?.exitCode === null) child.kill();
  }
}
