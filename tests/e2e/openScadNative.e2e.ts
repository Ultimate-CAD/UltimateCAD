import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderOpenScad } from "@/lib/openScadServer";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/openscad");
let workspace = "";

beforeAll(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "layerling-openscad-e2e-"));
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function render(source: string, more: Partial<Parameters<typeof renderOpenScad>[0]> = {}) {
  return renderOpenScad({ source, ...more });
}

function assertBinaryStl(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  expect(bytes.length).toBeGreaterThan(84);
  expect(bytes.length).toBe(84 + 50 * bytes.readUInt32LE(80));
  expect(bytes.readUInt32LE(80)).toBeGreaterThan(0);
}

function stlBounds(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const facets = bytes.readUInt32LE(80);
  for (let facet = 0; facet < facets; facet += 1) {
    const vertexStart = 84 + facet * 50 + 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = bytes.readFloatLE(vertexStart + (vertex * 3 + axis) * 4);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  return max.map((value, axis) => value - min[axis]);
}

describe("native OpenSCAD service", () => {
  it("renders functions, modules, parameter literals, expressions, and full geometry as binary STL", async () => {
    const result = await render("use <modules.scad>\nfixture_bar(length, fixture_height(scale));", {
      fileName: "model.scad",
      parameters: { length: 12, scale: 2 },
      expressions: { scale: "1+1" },
      libraryPaths: [fixtureRoot],
    });
    assertBinaryStl(result.stlBase64);
    expect(result.engineVersion).toMatch(/^\d/);
    expect(result.cached).toBe(false);
    expect(result.key).toHaveLength(64);
  });

  it("evaluates parameter expressions in the source scope and preserves dependencies between parameters", async () => {
    const result = await render("depth = 20;\nwidth = depth * 2;\ncube([width, depth, 1]);", {
      parameters: { depth: 45, width: 1 },
      expressions: { width: "depth * 2", unused: "  " },
    });
    assertBinaryStl(result.stlBase64);
    const [width, depth, height] = stlBounds(result.stlBase64);
    expect(width).toBeCloseTo(90, 4);
    expect(depth).toBeCloseTo(45, 4);
    expect(height).toBeCloseTo(1, 4);
  });

  it("resolves include/use assets and returns snapshots with dependency hashes", async () => {
    const result = await render("use <modules.scad>\ninclude <plate.scad>\nfixture_bar(plate_length, 5);", {
      libraryPaths: [fixtureRoot],
      files: { "embedded-note.txt": { encoding: "utf8", data: "kept with project" } },
    });
    assertBinaryStl(result.stlBase64);
    expect(result.dependencies.some((dependency) => dependency.path.endsWith("plate.scad"))).toBe(true);
    expect(Object.values(result.files)).toContainEqual({ encoding: "utf8", data: "plate_length = 20;\n" });
    expect(result.files["embedded-note.txt"]).toEqual({ encoding: "utf8", data: "kept with project" });
  });

  it("imports embedded STL files", async () => {
    const cube = await render("cube(4);");
    const imported = await render('import("piece.stl");', {
      files: { "piece.stl": { encoding: "base64", data: cube.stlBase64 } },
    });
    assertBinaryStl(imported.stlBase64);
  });

  it("returns a cache hit, then invalidates it when a resolved dependency changes", async () => {
    const sourceDirectory = path.join(workspace, "cache-project");
    await mkdir(sourceDirectory, { recursive: true });
    const dependencyPath = path.join(sourceDirectory, "size.scad");
    await writeFile(dependencyPath, "edge = 5;\n");
    const input = { source: "include <size.scad>\ncube(edge);", sourceDirectory };
    const first = await renderOpenScad(input);
    const cached = await renderOpenScad(input);
    expect(cached.cached).toBe(true);
    expect(cached.key).toBe(first.key);
    await writeFile(dependencyPath, "edge = 9;\n");
    const changed = await renderOpenScad(input);
    expect(changed.cached).toBe(false);
    expect(changed.key).not.toBe(first.key);
    expect(changed.dependencies[0]?.sha256).not.toBe(first.dependencies[0]?.sha256);
  });

  it("re-renders from portable snapshots after the original project files are gone", async () => {
    const sourceDirectory = path.join(workspace, "portable-project");
    await mkdir(path.join(sourceDirectory, "nested"), { recursive: true });
    await writeFile(path.join(sourceDirectory, "nested", "shape.scad"), "edge = 6;\n");
    await writeFile(path.join(sourceDirectory, "size.scad"), "include <nested/shape.scad>\n");
    const piece = await render("cube(3);");
    await writeFile(path.join(sourceDirectory, "asset.stl"), Buffer.from(piece.stlBase64, "base64"));
    const source = 'include <size.scad>\nimport("asset.stl");';
    const original = await renderOpenScad({ source, sourceDirectory });
    assertBinaryStl(original.stlBase64);
    expect(original.files["project/size.scad"]?.encoding).toBe("utf8");
    expect(original.files["project/nested/shape.scad"]?.encoding).toBe("utf8");
    expect(original.files["project/asset.stl"]?.encoding).toBe("base64");
    await rm(sourceDirectory, { recursive: true, force: true });
    const restored = await renderOpenScad({ source, files: original.files });
    assertBinaryStl(restored.stlBase64);
  });

  it("reports syntax and missing-library errors", async () => {
    await expect(render("cube([1, 2);")).rejects.toThrow(/OpenSCAD failed/i);
    await expect(render("include <missing-library.scad>\ncube(1);", { libraryPaths: [workspace] })).rejects.toThrow(/OpenSCAD failed/i);
  });

  it("kills and rejects a timed-out render and an explicitly cancelled render", async () => {
    const expensive = "sphere(r=10, $fn=900);";
    await expect(render(expensive, { timeoutMs: 1_000 })).rejects.toThrow(/timed out/i);
    const controller = new AbortController();
    const pending = renderOpenScad({ source: expensive, timeoutMs: 10_000 }, controller.signal);
    setTimeout(() => controller.abort(), 300).unref?.();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  }, 30_000);

  it("runs more than two requests and cancels a queued request without leaking a slot", async () => {
    const heavy = { source: "sphere(r=10, $fn=500);", timeoutMs: 30_000 };
    const first = renderOpenScad(heavy);
    const second = renderOpenScad(heavy);
    const controller = new AbortController();
    const queued = renderOpenScad({ source: "cube(1);" }, controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    const completed = await Promise.all([first, second]);
    completed.forEach((result) => assertBinaryStl(result.stlBase64));
    const burst = await Promise.all(Array.from({ length: 5 }, () => render("cube(2);")));
    burst.forEach((result) => assertBinaryStl(result.stlBase64));
  }, 60_000);
});
