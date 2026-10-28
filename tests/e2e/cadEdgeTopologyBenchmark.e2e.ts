import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OcctKernel, type ShapeHandle } from "occt-wasm";
import { buildCadEdgeFaceMap } from "@/lib/cadEdgeTopology";

const sizeCases: Record<string, { latitudeBands: number; longitudeSegments: number; legacy: boolean }> = {
  "4000": { latitudeBands: 51, longitudeSegments: 40, legacy: true },
  "14760": { latitudeBands: 91, longitudeSegments: 82, legacy: true },
  "20000": { latitudeBands: 101, longitudeSegments: 100, legacy: false },
  "50000": { latitudeBands: 201, longitudeSegments: 125, legacy: false },
  "100000": { latitudeBands: 251, longitudeSegments: 200, legacy: false },
};
const requestedSize = process.env.TOPOLOGY_BENCHMARK_TRIANGLES ?? "";
const selectedCase = sizeCases[requestedSize];

function facetSphereStl(latitudeBands: number, longitudeSegments: number) {
  const point = (latitude: number, longitude: number): [number, number, number] => {
    const phi = Math.PI * latitude / latitudeBands;
    const theta = 2 * Math.PI * longitude / longitudeSegments;
    return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
  };
  const lines = ["solid sphere"];
  const facet = (a: number[], b: number[], c: number[]) => {
    lines.push("facet normal 0 0 0", "outer loop", `vertex ${a.join(" ")}`, `vertex ${b.join(" ")}`, `vertex ${c.join(" ")}`, "endloop", "endfacet");
  };
  for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
    const next = (longitude + 1) % longitudeSegments;
    facet([0, 1, 0], point(1, longitude), point(1, next));
    facet([0, -1, 0], point(latitudeBands - 1, next), point(latitudeBands - 1, longitude));
  }
  for (let latitude = 1; latitude < latitudeBands - 1; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const next = (longitude + 1) % longitudeSegments;
      const a = point(latitude, longitude);
      const b = point(latitude, next);
      const c = point(latitude + 1, longitude);
      const d = point(latitude + 1, next);
      facet(a, c, b);
      facet(b, c, d);
    }
  }
  lines.push("endsolid sphere");
  return { stl: lines.join("\n"), triangles: 2 * longitudeSegments * (latitudeBands - 1) };
}

const benchmarkIt = selectedCase ? it : it.skip;

describe("bounded CAD topology benchmark", () => {
  let cad: OcctKernel;
  beforeAll(async () => {
    const wasm = join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm");
    cad = await OcctKernel.init({ wasm });
  });

  benchmarkIt(`measures ${requestedSize || "selected"} facets`, () => {
    const started = performance.now();
    const rssStart = process.memoryUsage().rss;
    const { stl, triangles } = facetSphereStl(selectedCase!.latitudeBands, selectedCase!.longitudeSegments);
    let shape: ShapeHandle | null = cad.importStl(stl);
    const importedAt = performance.now();
    const rssAfterImport = process.memoryUsage().rss;
    let faces: ShapeHandle[] = [];
    try {
      faces = cad.getSubShapes(shape, "face");
      const facesAt = performance.now();
      let legacyMs: number | null = null;
      let legacyEdgeCount: number | null = null;
      let rssAfterLegacy: number | null = null;
      if (selectedCase!.legacy) {
        const oldStarted = performance.now();
        const oldPairs = cad.edgeToFaceMap(shape, 2_147_483_647);
        legacyMs = performance.now() - oldStarted;
        const oldMap = new Map<number, number[]>();
        for (let index = 0; index + 1 < oldPairs.length;) {
          const edgeHash = oldPairs[index++];
          const count = oldPairs[index++];
          oldMap.set(edgeHash, oldPairs.slice(index, index + count));
          index += count;
        }
        legacyEdgeCount = oldMap.size;
        rssAfterLegacy = process.memoryUsage().rss;
      }
      const optimizedStarted = performance.now();
      const optimized = buildCadEdgeFaceMap(cad, faces, 2_147_483_647);
      const optimizedMs = performance.now() - optimizedStarted;
      const rssAfterOptimized = process.memoryUsage().rss;
      expect(triangles).toBe(Number(requestedSize));
      expect(faces.length).toBe(triangles);
      expect(optimized.size).toBeGreaterThan(triangles);
      if (legacyEdgeCount !== null) expect(optimized.size).toBe(legacyEdgeCount);

      const record = {
        requestedFacets: Number(requestedSize),
        facets: triangles,
        faces: faces.length,
        edges: optimized.size,
        legacyRun: selectedCase!.legacy,
        legacyMs,
        optimizedMs,
        importMs: importedAt - started,
        getFaceHandlesMs: facesAt - importedAt,
        rssStartBytes: rssStart,
        rssAfterImportBytes: rssAfterImport,
        rssAfterLegacyBytes: rssAfterLegacy,
        rssAfterOptimizedBytes: rssAfterOptimized,
        processId: process.pid,
      };
      const output = resolve(process.cwd(), "docs/geometry/topology-benchmark.json");
      const report = JSON.parse(readFileSync(output, "utf8")) as { benchmarks: Array<typeof record> };
      report.benchmarks = report.benchmarks.filter((entry) => entry.requestedFacets !== record.requestedFacets);
      report.benchmarks.push(record);
      report.benchmarks.sort((a, b) => a.requestedFacets - b.requestedFacets);
      writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      console.info(`[cadEdgeTopologyBenchmark] ${JSON.stringify(record)}`);
    } finally {
      for (const face of faces) cad.release(face);
      if (shape !== null) cad.release(shape);
      shape = null;
    }
  }, 180_000);
});
