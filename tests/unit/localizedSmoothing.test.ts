import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";
import {
  brushWeight,
  localizedSmooth,
  smoothingTopology,
} from "@/lib/localizedSmoothing";
import { exportMeshesToStl } from "@/lib/stlExport";
import type { StlExportMesh } from "@/lib/stlExport";

const fixture = () => {
  const vertices: [number, number, number][] = [];
  const faces: [number, number, number][] = [];
  const segments = 48;
  const rows = 21;

  for (let y = 0; y < rows; y += 1) {
    for (let j = 0; j < segments; j += 1) {
      const angle = (j * 2 * Math.PI) / segments;
      const radius =
        10 +
        2 * Math.exp(-(((y - 10) / 1.2) ** 2)) +
        Math.max(0, 4 - y) * 0.4;
      vertices.push([radius * Math.cos(angle), y, radius * Math.sin(angle)]);
    }
  }

  for (let y = 0; y < rows - 1; y += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = y * segments + j;
      const b = y * segments + ((j + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      faces.push([a, c, b], [b, c, d]);
    }
  }

  return { vertices, faces } satisfies StlExportMesh;
};

describe("localized smoothing", () => {
  it("retains closed topology and independently reimports an actually smoothed STL", () => {
    const mesh = fixture();
    mesh.vertices.push([0, 0, 0], [0, 20, 0]);
    for (let j = 0; j < 48; j += 1) {
      const next = (j + 1) % 48;
      mesh.faces.push([1008, j, next], [1009, 960 + next, 960 + j]);
    }

    expect(auditManufacturingMesh(mesh).valid).toBe(true);
    const started = performance.now();
    const result = localizedSmooth(
      mesh,
      mesh.vertices.map((point) => brushWeight(Math.abs(point[1] - 10), 5)),
      0.7,
      20,
    );
    expect(result.audit.valid).toBe(true);
    expect(result.stats.maxDisplacementMm).toBeGreaterThan(0.05);

    const encoded = exportMeshesToStl([result.mesh]);
    const geometry = new STLLoader().parse(encoded);
    const positions = geometry.attributes.position.array;
    const vertices: [number, number, number][] = [];
    const faces: [number, number, number][] = [];
    for (let i = 0; i < positions.length; i += 3) {
      vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
    }
    for (let i = 0; i < vertices.length; i += 3) {
      faces.push([i, i + 1, i + 2]);
    }

    expect(auditManufacturingMesh({ vertices, faces }).valid).toBe(true);
    geometry.dispose();
    const report = {
      ...result.stats,
      durationMs: performance.now() - started,
      triangles: mesh.faces.length,
    };
    console.log("collar smoothing measurement", JSON.stringify(report));
    if (process.env.LAYERLING_SMOOTH_REPORT) {
      writeFileSync(process.env.LAYERLING_SMOOTH_REPORT, JSON.stringify(report, null, 2));
    }
  });

  it("reduces a collar with continuous weights, fixed surroundings, unchanged open topology and deterministic output", () => {
    const mesh = fixture();
    const before = JSON.stringify(mesh);
    const weights = mesh.vertices.map((point) =>
      brushWeight(Math.abs(point[1] - 10), 5),
    );
    const topology = smoothingTopology(mesh);
    const first = localizedSmooth(mesh, weights, 0.8, 30, topology);
    const second = localizedSmooth(mesh, weights, 0.8, 30, topology);

    expect(first.mesh).toEqual(second.mesh);
    expect(JSON.stringify(mesh)).toBe(before);
    expect(first.mesh.faces).toBe(mesh.faces);
    expect(Math.hypot(first.mesh.vertices[480][0], first.mesh.vertices[480][2])).toBeLessThan(12);
    expect(first.stats.maxDisplacementMm).toBeGreaterThan(0.05);
    expect(first.audit.boundaryEdges).toBe(96);
    expect(first.stats.resultValid).toBe(false);
    mesh.vertices.forEach((point, index) => {
      if (weights[index] === 0) expect(first.mesh.vertices[index]).toEqual(point);
    });
  });

  it("rejects malformed weights and non-manifold connectivity without repair", () => {
    const mesh = fixture();
    expect(() => localizedSmooth(mesh, [], 1, 10)).toThrow();
    expect(() =>
      smoothingTopology({
        ...mesh,
        faces: [...mesh.faces, mesh.faces[0], mesh.faces[0]],
      }),
    ).toThrow(/Non-manifold/);
  });
});
