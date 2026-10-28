import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { localizedSmooth, brushWeight } from "@/lib/localizedSmoothing";

it.skipIf(!process.env.LAYERLING_SMOOTH_BENCH)("measures a bounded 100k-triangle closed collar", () => {
  const vertices: [number, number, number][] = [], faces: [number, number, number][] = [];
  const n = 256, rows = 201;
  for (let k = 0; k < rows; k++) {
    const y = k / 10, r = 10 + 2 * Math.exp(-(((y - 10) / 1.2) ** 2));
    for (let j = 0; j < n; j++) { const a = j * 2 * Math.PI / n; vertices.push([r * Math.cos(a), y, r * Math.sin(a)]); }
  }
  for (let k = 0; k < rows - 1; k++) for (let j = 0; j < n; j++) {
    const a = k * n + j, b = k * n + (j + 1) % n; faces.push([a, a + n, b], [b, a + n, b + n]);
  }
  const end = vertices.length; vertices.push([0, 0, 0], [0, 20, 0]);
  for (let j = 0; j < n; j++) { const b = (j + 1) % n; faces.push([end, j, b], [end + 1, (rows - 1) * n + b, (rows - 1) * n + j]); }
  const weights = vertices.map(p => brushWeight(Math.abs(p[1] - 10), 3)), start = performance.now();
  const result = localizedSmooth({ vertices, faces }, weights, .7, 20);
  expect(result.audit.valid).toBe(true);
  expect(result.stats.maxDisplacementMm).toBeGreaterThan(0);
  vertices.forEach((p, i) => { if (weights[i] === 0) expect(result.mesh.vertices[i]).toEqual(p); });
  writeFileSync(process.env.LAYERLING_SMOOTH_BENCH!, JSON.stringify({ ...result.stats, durationMs: performance.now() - start, triangles: faces.length, rssMiB: process.memoryUsage().rss / 1024 ** 2 }, null, 2));
}, 60000);
