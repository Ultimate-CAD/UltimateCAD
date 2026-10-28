import { it, expect } from "vitest";
import { subdivideManufacturingMesh } from "@/lib/precisionMesh";
import { exportMeshesToStl } from "@/lib/stlExport";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { writeFileSync } from "node:fs";

it.skipIf(!process.env.LAYERLING_DENSE_EXPORT_BENCH)(
  "generates and independently reimports a million-triangle manufacturing mesh",
  () => {
    const source = {
      vertices: [
        [0, 0, 0],
        [20, 0, 0],
        [0, 20, 0],
        [0, 0, 20],
      ] as [number, number, number][],
      faces: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ] as [number, number, number][],
    };
    const started = performance.now(),
      mesh = subdivideManufacturingMesh(source, 0.055, 4_000_000),
      refined = performance.now();
    expect(mesh.faces.length).toBeGreaterThanOrEqual(1_000_000);
    const bytes = exportMeshesToStl([mesh]),
      encoded = performance.now(),
      geometry = new STLLoader().parse(bytes),
      p = geometry.attributes.position.array;
    expect(new DataView(bytes).getUint32(80, true)).toBe(mesh.faces.length);
    expect(p.length / 9).toBe(mesh.faces.length);
    expect(bytes.byteLength).toBe(84 + mesh.faces.length * 50);
    let volume = 0;
    for (let i = 0; i < p.length; i += 9) {
      const [a, b, c, d, e, f, g, h, j] = p.slice(i, i + 9);
      volume +=
        (a * (e * j - f * h) + b * (f * g - d * j) + c * (d * h - e * g)) / 6;
    }
    expect(volume).toBeCloseTo(8000 / 6, 3);
    geometry.dispose();
    const report = {
      triangles: mesh.faces.length,
      bytes: bytes.byteLength,
      refineMs: refined - started,
      encodeMs: encoded - refined,
      reimportMs: performance.now() - encoded,
      volumeMm3: volume,
    };
    writeFileSync(
      ".codex-run/precision-density-benchmark.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  },
  120000,
);
