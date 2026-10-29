import { beforeAll, describe, expect, it } from "vitest";
import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  cutHollowBase,
  prepareFinishingSource,
  validateFinishing,
  type FinishingMesh,
} from "@/lib/hollowFinishing";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";
import { importedShapeFromTriangleSoup } from "@/lib/stlImport";
import { exportLylProject } from "@/lib/lylProject";
import {
  DEFAULT_WORKPLANE_WORKSPACE,
  DEFAULT_SNAP_GRID,
} from "@/lib/workplaneSettings";
import { exportMeshesToStl } from "@/lib/stlExport";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  finishedMeshShape,
  finishingSourcePositions,
} from "@/lib/hollowFinishingShape";
import { meshForShape } from "@/lib/editorMeshCore";
import type { WorkplaneShape } from "@/types/layerling";
import { retainedCutEvidence } from "../helpers/retainedCutEvidence";

let runtime: ManifoldToplevel;
const evidenceDirectory =
  process.env.LAYERLING_FINISH_EVIDENCE_DIR ?? ".codex-run/geometry9/evidence";
beforeAll(async () => {
  runtime = await manifoldModule();
  runtime.setup();
});

// Separate outer and negative inner shells, with exact shared rings and closed ends.
export function closedHollowFixture(
  segments = 32,
  rows = 4,
  flared = false,
): FinishingMesh {
  const vertices: [number, number, number][] = [],
    faces: [number, number, number][] = [];
  for (let shell = 0; shell < 2; shell++) {
    const offset = vertices.length;
    for (let row = 0; row < rows; row++) {
      const y = shell ? 2 + (16 * row) / (rows - 1) : (20 * row) / (rows - 1);
      const radius =
        (shell ? 8 : 10) + (flared ? y * 0.18 + Math.sin(y / 3) * 0.5 : 0);
      for (let j = 0; j < segments; j++) {
        const a = (2 * Math.PI * j) / segments;
        vertices.push([radius * Math.cos(a), y, radius * Math.sin(a)]);
      }
    }
    const add = (a: number, b: number, c: number) =>
      faces.push(shell ? [a, c, b] : [a, b, c]);
    for (let row = 0; row < rows - 1; row++)
      for (let j = 0; j < segments; j++) {
        const a = offset + row * segments + j,
          b = offset + row * segments + ((j + 1) % segments),
          c = a + segments,
          d = b + segments;
        add(a, c, b);
        add(b, c, d);
      }
    const bottom = vertices.length;
    vertices.push([0, shell ? 2 : 0, 0]);
    const top = vertices.length;
    vertices.push([0, shell ? 18 : 20, 0]);
    for (let j = 0; j < segments; j++) {
      add(bottom, offset + j, offset + ((j + 1) % segments));
      add(
        top,
        offset + (rows - 1) * segments + ((j + 1) % segments),
        offset + (rows - 1) * segments + j,
      );
    }
  }
  return { vertices, faces };
}

describe("open hollow base", () => {
  it.each([false, true])(
    "creates an oriented annular rim with exact retained faces (flared=%s)",
    (flared) => {
      const mesh = closedHollowFixture(32, 4, flared),
        snapshot = JSON.stringify(mesh),
        source = prepareFinishingSource(mesh);
      const result = cutHollowBase(runtime, source, {
        axis: 1,
        position: 3.1,
        keepPositive: true,
      });
      expect(result.audit).toMatchObject({
        valid: true,
        boundaryEdges: 0,
        nonManifoldEdges: 0,
        nonManifoldVertices: 0,
        windingMismatches: 0,
        cavityShells: 0,
        solidComponents: 1,
      });
      expect(result.audit.dimensionsMm[1]).toBeCloseTo(16.9, 10);
      if (!flared) {
        const expected =
          16 * Math.sin((2 * Math.PI) / 32) * (100 * 16.9 - 64 * 14.9);
        expect(result.audit.signedVolumeMm3).toBeCloseTo(expected, 7);
      }
      expect(result.stats).toMatchObject({
        contours: 2,
        openings: 1,
        retainedVertexDisplacementMm: 0,
      });
      expect(JSON.stringify(mesh)).toBe(snapshot);
      const retained = new Set(
        result.mesh.faces.map((f) =>
          JSON.stringify(f.map((i) => result.mesh.vertices[i])),
        ),
      );
      for (const f of mesh.faces.filter((f) =>
        f.every((i) => mesh.vertices[i][1] >= 3.1),
      ))
        expect(
          retained.has(JSON.stringify(f.map((i) => mesh.vertices[i]))),
        ).toBe(true);
      const qa = validateFinishing(source, result);
      expect(qa.surface.selfIntersections).toMatchObject({
        complete: true,
        found: 0,
      });
      expect(qa.encodedSurface.selfIntersections).toMatchObject({
        complete: true,
        found: 0,
      });
      const stl = exportMeshesToStl([result.mesh]),
        geo = new STLLoader().parse(stl),
        p = geo.getAttribute("position");
      const loaded: FinishingMesh = { vertices: [], faces: [] };
      for (let i = 0; i < p.count; i++)
        loaded.vertices.push([p.getX(i), p.getY(i), p.getZ(i)]);
      for (let i = 0; i < p.count; i += 3) loaded.faces.push([i, i + 1, i + 2]);
      expect(auditManufacturingMesh(loaded).valid).toBe(true);
      geo.dispose();
    },
  );
  it("supports the negative retained side and a plane through a ring", () => {
    const source = prepareFinishingSource(closedHollowFixture());
    const result = cutHollowBase(runtime, source, {
      axis: 1,
      position: 20 / 3,
      keepPositive: false,
    });
    expect(result.audit.valid).toBe(true);
    validateFinishing(source, result);
  });
  it.each([0, 2] as const)(
    "opens a cavity on local axis %s with the correct rim orientation",
    (axis) => {
      const source = prepareFinishingSource(closedHollowFixture());
      const result = cutHollowBase(runtime, source, {
        axis,
        position: 1.123,
        keepPositive: true,
      });
      expect(result.audit.valid).toBe(true);
      expect(result.stats.openings).toBe(1);
      validateFinishing(source, result);
    },
  );
  it("keeps a thin wall and exposes its warning without thickening", () => {
    const mesh = closedHollowFixture();
    for (const p of mesh.vertices)
      if (Math.hypot(p[0], p[2]) > 7.9 && Math.hypot(p[0], p[2]) < 8.1) {
        p[0] *= 9.8 / 8;
        p[2] *= 9.8 / 8;
      }
    const source = prepareFinishingSource(mesh),
      before = JSON.stringify(mesh);
    const result = cutHollowBase(runtime, source, {
      axis: 1,
      position: 3.1,
      keepPositive: true,
    });
    const qa = validateFinishing(source, result);
    expect(qa.surface.wallConcern).toBe(true);
    expect(qa.encodedSurface.wallConcern).toBe(true);
    expect(JSON.stringify(mesh)).toBe(before);
  });
  it("refuses a plane missing the cavity, an entire face, or an empty retained side", () => {
    const source = prepareFinishingSource(closedHollowFixture());
    for (const position of [1, 0, 30])
      expect(() =>
        cutHollowBase(runtime, source, {
          axis: 1,
          position,
          keepPositive: true,
        }),
      ).toThrow();
  });
  it("fails invalid inputs instead of repairing them", () => {
    const broken = closedHollowFixture();
    broken.faces.pop();
    expect(() => prepareFinishingSource(broken)).toThrow(/closed/);
  });
  it("classifies multiple cavities without bridging or filling their openings", () => {
    const outer = runtime.Manifold.cube([30, 20, 20]).translate([-15, 0, -10]);
    const left = runtime.Manifold.cube([5, 16, 5]).translate([-10, 2, -2.5]);
    const right = runtime.Manifold.cube([5, 16, 5]).translate([5, 2, -2.5]);
    const first = outer.subtract(left),
      solid = first.subtract(right),
      native = solid.getMesh();
    try {
      const mesh: FinishingMesh = { vertices: [], faces: [] };
      for (let i = 0; i < native.vertProperties.length; i += native.numProp)
        mesh.vertices.push([
          native.vertProperties[i],
          native.vertProperties[i + 1],
          native.vertProperties[i + 2],
        ]);
      for (let i = 0; i < native.triVerts.length; i += 3)
        mesh.faces.push([
          native.triVerts[i],
          native.triVerts[i + 1],
          native.triVerts[i + 2],
        ]);
      const source = prepareFinishingSource(mesh),
        result = cutHollowBase(runtime, source, {
          axis: 1,
          position: 3.1,
          keepPositive: true,
        });
      expect(result.stats.openings).toBe(2);
      expect(result.stats.contours).toBe(3);
      validateFinishing(source, result);
    } finally {
      solid.delete();
      first.delete();
      outer.delete();
      left.delete();
      right.delete();
    }
  });
  it("refuses float32-collapsed thin walls instead of silently removing them", () => {
    const mesh = closedHollowFixture();
    for (const p of mesh.vertices)
      if (Math.hypot(p[0], p[2]) > 7.9 && Math.hypot(p[0], p[2]) < 8.1) {
        p[0] *= 9.99999999 / 8;
        p[2] *= 9.99999999 / 8;
      }
    const source = prepareFinishingSource(mesh);
    expect(() =>
      cutHollowBase(runtime, source, {
        axis: 1,
        position: 3.1,
        keepPositive: true,
      }),
    ).toThrow(/safe connected rim/);
  });
  it("updates real dimensions and preserves the world location of tilted, mirrored and scaled geometry", () => {
    const mesh = closedHollowFixture(),
      raw = mesh.faces.flatMap((f) => f.flatMap((i) => mesh.vertices[i]));
    for (const mirrorX of [false, true]) {
      const shape = {
        id: "same",
        kind: "mesh",
        name: "test",
        x: 14,
        z: -8,
        elevation: 7,
        width: 30,
        depth: 24,
        height: 40,
        rotation: 29,
        rotationX: 17,
        rotationZ: -12,
        mirrorX,
        mirrorY: true,
        mirrorZ: false,
        importedMesh: {
          positions: raw,
          baseWidth: 20,
          baseDepth: 20,
          baseHeight: 20,
          triangleCount: raw.length / 9,
          sourceFormat: "json",
        },
      } as WorkplaneShape;
      const local = finishingSourcePositions(shape),
        retainedFaces = mesh.faces
          .map((_, i) => i)
          .filter((i) =>
            [0, 1, 2].every((j) => local[i * 9 + j * 3 + 1] >= 6.2),
          ),
        fakeCut = retainedFaces.flatMap((i) =>
          Array.from(local.subarray(i * 9, i * 9 + 9)),
        );
      const after = finishedMeshShape(shape, fakeCut),
        worldBefore = meshForShape(shape),
        worldAfter = meshForShape(after);
      expect(after.id).toBe(shape.id);
      const old = retainedFaces.flatMap((i) =>
          worldBefore.faces[i].map((j) => worldBefore.vertices[j]),
        ),
        actual = worldAfter.faces.flatMap((f) =>
          f.map((i) => worldAfter.vertices[i]),
        );
      expect(actual.length).toBe(old.length);
      let max = 0;
      actual.forEach((p, i) => {
        max = Math.max(max, Math.hypot(...p.map((v, j) => v - old[i][j])));
      });
      expect(max).toBeLessThan(1e-12);
    }
  });
  it("supports a near-bottom thin cap and reports thickness concerns", () => {
    const source = prepareFinishingSource(closedHollowFixture());
    const result = cutHollowBase(runtime, source, {
      axis: 1,
      position: 17.99,
      keepPositive: false,
    });
    expect(result.audit.valid).toBe(true);
    validateFinishing(source, result);
  });
});

it.skipIf(!process.env.LAYERLING_FINISH_ORGANIC)(
  "finishes captured hollow organic without SDF",
  async () => {
    const bytes = readFileSync(process.env.LAYERLING_FINISH_ORGANIC!),
      geometry = new STLLoader().parse(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
      attribute = geometry.getAttribute("position");
    const p: number[] = [];
    // Captured manufacturing STL is explicitly Z-up; avoid the legacy STL orientation heuristic.
    for (let i = 0; i < attribute.count; i++)
      p.push(attribute.getX(i), attribute.getZ(i), -attribute.getY(i));
    geometry.dispose();
    const mesh: FinishingMesh = { vertices: [], faces: [] };
    for (let i = 0; i < p.length; i += 3)
      mesh.vertices.push([p[i], p[i + 1], p[i + 2]]);
    for (let i = 0; i < mesh.vertices.length; i += 3)
      mesh.faces.push([i, i + 1, i + 2]);
    const started = performance.now(),
      source = prepareFinishingSource(mesh);
    const result = cutHollowBase(runtime, source, {
      axis: 1,
      position: Number(process.env.LAYERLING_FINISH_POSITION || 5.123),
      keepPositive: true,
    });
    const qa = validateFinishing(source, result);
    mkdirSync(evidenceDirectory, { recursive: true });
    const uprightSource = importedShapeFromTriangleSoup(
      "Captured upright hollow organic",
      p,
      undefined,
      "json",
    );
    const project = await exportLylProject({
      projectId: "organic-finishing8-source-copy",
      projectName: "Captured upright hollow organic",
      createdAt: 1,
      modifiedAt: 2,
      shapes: [uprightSource],
      history: [],
      historyIndex: 0,
      assets: [],
      workspace: DEFAULT_WORKPLANE_WORKSPACE,
      snapGrid: DEFAULT_SNAP_GRID,
      placementElevation: 0,
    });
    writeFileSync(`${evidenceDirectory}/organic-upright.lyl`, project);
    writeFileSync(
      `${evidenceDirectory}/organic-result.json`,
      JSON.stringify(
        {
          stats: result.stats,
          retained: retainedCutEvidence(source.mesh, result.mesh, {
            axis: 1,
            position: Number(process.env.LAYERLING_FINISH_POSITION || 5.123),
            keepPositive: true,
          }),
          audit: result.audit,
          qa,
          totalMs: performance.now() - started,
          memory: process.memoryUsage(),
        },
        null,
        2,
      ),
    );
    writeFileSync(
      `${evidenceDirectory}/open-organic.stl`,
      Buffer.from(exportMeshesToStl([result.mesh])),
    );
    expect(result.encodedAudit.valid).toBe(true);
  },
  180000,
);

it.skipIf(!process.env.LAYERLING_FINISH_BENCH)(
  "benchmarks 100k and 500k with complete applicable validation",
  async () => {
    const records = [];
    for (const [segments, rows] of [
      [250, 100],
      [500, 250],
    ]) {
      const started = performance.now(),
        mesh = closedHollowFixture(segments, rows, true),
        before = process.memoryUsage(),
        prepared = performance.now();
      const source = prepareFinishingSource(mesh),
        initialized = performance.now();
      const result = cutHollowBase(runtime, source, {
        axis: 1,
        position: 3.123,
        keepPositive: true,
      });
      const qa = validateFinishing(source, result);
      const firstMs = performance.now() - initialized;
      const second = cutHollowBase(runtime, source, {
        axis: 1,
        position: 4.123,
        keepPositive: true,
      });
      const qa2 = validateFinishing(source, second);
      records.push({
        sourceTriangles: mesh.faces.length,
        fixtureMs: prepared - started,
        initializeMs: initialized - prepared,
        firstMs,
        stats: result.stats,
        retained: retainedCutEvidence(source.mesh, result.mesh, {
          axis: 1,
          position: 3.123,
          keepPositive: true,
        }),
        validationMs: qa.validationMs,
        repeatStats: second.stats,
        repeatValidationMs: qa2.validationMs,
        sourceSurfaceCached: source.surfaceChecked,
        audit: result.audit,
        before,
        after: process.memoryUsage(),
        peakRssKiB: process.resourceUsage().maxRSS,
      });
      expect(qa.encodedSurface.selfIntersections.complete).toBe(true);
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(
        `${evidenceDirectory}/benchmark.json`,
        JSON.stringify(records, null, 2),
      );
      if (process.env.LAYERLING_FINISH_WRITE_FIXTURES) {
        const positions = mesh.faces.flatMap((f) =>
          f.flatMap((i) => mesh.vertices[i]),
        );
        const [width, height, depth] = source.audit.dimensionsMm;
        const shape = {
          id: `finishing-${mesh.faces.length}`,
          name: `Closed flared hollow ${mesh.faces.length}`,
          kind: "mesh",
          x: 0,
          z: 0,
          elevation: 0,
          width,
          depth,
          height,
          size: Math.max(width, depth),
          rotation: 0,
          locked: false,
          hidden: false,
          color: "#0098c7",
          importedMesh: {
            positions,
            baseWidth: width,
            baseHeight: height,
            baseDepth: depth,
            triangleCount: mesh.faces.length,
            sourceFormat: "json",
          },
        } as WorkplaneShape;
        const project = await exportLylProject({
          projectId: `finishing-${mesh.faces.length}-source`,
          projectName: shape.name,
          createdAt: 1,
          modifiedAt: 2,
          shapes: [shape],
          history: [],
          historyIndex: 0,
          assets: [],
          workspace: DEFAULT_WORKPLANE_WORKSPACE,
          snapGrid: DEFAULT_SNAP_GRID,
          placementElevation: 0,
        });
        writeFileSync(
          `${evidenceDirectory}/closed-hollow-${mesh.faces.length}.lyl`,
          project,
        );
      }
    }
  },
  240000,
);
