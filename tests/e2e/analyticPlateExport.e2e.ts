import { expect, it, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import manifoldModule from "manifold-3d";
import { sevenHolePlateSelection } from "../fixtures/sevenHolePlate";
import baseline from "../fixtures/seven-hole-plate-baseline.json";
import { independentlyReimport } from "../helpers/manufacturingReimport";
import {
  DEFAULT_PRECISION,
  PRECISION_PRESETS,
} from "@/lib/precisionMesh";
import type { PrecisionSettings } from "@/lib/precisionMesh";
import type { WorkplaneShape } from "@/types/layerling";

const diagnostics = vi.hoisted(() => ({ body: null as any }));

vi.mock("@/lib/brepKernel", async () => {
  const { occtExportTestKernel } = await import("../helpers/occtExportKernel");
  return occtExportTestKernel(diagnostics);
});

it(
  "exports a normally grouped seven-hole plate at High, Ultra and Custom, with valid cache transitions",
  async () => {
    const { buildGroupedShapeFromSelection } = await import(
      "@/lib/editorBooleans"
    );
    const { PrecisionExportEngine } = await import("@/lib/precisionExport");
    const selected = sevenHolePlateSelection(),
      selectionBefore = JSON.stringify(selected);
    const grouped = await buildGroupedShapeFromSelection(selected, 4_000_000);
    expect(grouped.group, grouped.failureNotice).not.toBeNull();
    const group = grouped.group!,
      groupBefore = JSON.stringify(group),
      rt = await manifoldModule();
    rt.setup();
    const engine = new PrecisionExportEngine(rt),
      root = `.codex-run/export11/verified-${Date.now()}`;
    mkdirSync(root, { recursive: true });
    writeFileSync(`${root}/group.json`, JSON.stringify(group, null, 2));
    const cases: Record<string, PrecisionSettings> = {
      high: {
        ...DEFAULT_PRECISION,
        ...PRECISION_PRESETS.high,
        preset: "high",
      },
      ultra: {
        ...DEFAULT_PRECISION,
        ...PRECISION_PRESETS.ultra,
        preset: "ultra",
      },
      fine: {
        ...DEFAULT_PRECISION,
        deviationMm: 0.001,
        angleDeg: 1,
        preset: "custom",
      },
      edge: { ...DEFAULT_PRECISION, maxEdgeMm: 1, preset: "custom" },
    };
    for (const name of ["high", "ultra", "fine", "edge", "high"] as const) {
      const settings = cases[name],
        reference = baseline.cases[name];
      for (const format of ["stl", "3mf"] as const) {
        const result = await engine.run([group], format, settings),
          body = result.report.bodies[0];
        expect(result.report.ready, JSON.stringify(result.report)).toBe(true);
        expect(result.bytes).not.toBeNull();
        expect(body.surface.selfIntersections.complete).toBe(true);
        expect(body.surface.selfIntersections.found).toBe(0);
        expect(body.repair).toBeNull();
        expect(result.report.triangles).toBe(reference.triangles);
        expect(body.totalDeviationBudgetMm).toBeLessThanOrEqual(
          settings.deviationMm,
        );
        expect(body.analyticDeviationMm).toBe(reference.analyticDeviationMm);
        const hash = createHash("sha256")
          .update(result.preview.after)
          .digest("hex");
        expect(hash).toBe(reference.previewSha256);
        const decoded = independentlyReimport(result.bytes!, format);
        expect(decoded.audit.valid, JSON.stringify(decoded.audit)).toBe(true);
        expect(decoded.audit.triangles).toBe(result.report.triangles);
        writeFileSync(`${root}/${name}.${format}`, result.bytes!);
        writeFileSync(
          `${root}/${name}-${format}.json`,
          JSON.stringify(
            {
              report: result.report,
              reimport: decoded.audit,
              geometrySha256: hash,
            },
            null,
            2,
          ),
        );
      }
    }
    expect(diagnostics.body.valid).toBe(true);
    expect(diagnostics.body.volume).toBeCloseTo(Math.PI * 1510 * 6, 5);
    expect(diagnostics.body.relations).toHaveLength(10);
    writeFileSync(`${root}/body.brep`, diagnostics.body.brep);
    writeFileSync(
      `${root}/face-relations.json`,
      JSON.stringify(diagnostics.body.relations, null, 2),
    );
    const wider = { ...group, width: 84 },
      changed = await engine.run([wider], "3mf", cases.high);
    expect(changed.report.ready).toBe(true);
    expect(changed.report.bodies[0].audit.dimensionsMm[0]).toBeCloseTo(84, 2);
    expect(
      createHash("sha256").update(changed.preview.after).digest("hex"),
    ).not.toBe(baseline.cases.high.previewSha256);
    const restored = await engine.run([group], "3mf", cases.high);
    expect(
      createHash("sha256").update(restored.preview.after).digest("hex"),
    ).toBe(baseline.cases.high.previewSha256);
    expect(JSON.stringify(group)).toBe(groupBefore);
    expect(JSON.stringify(selected)).toBe(selectionBefore);
    console.log(root);
  },
  180000,
);

it("keeps genuinely intersecting closed meshes blocked in binary STL and 3MF", async () => {
  const { PrecisionExportEngine } = await import("@/lib/precisionExport"),
    { auditManufacturingMesh } = await import("@/lib/manufacturingMesh");
  const p = [
      [0, 0, 0],
      [0, 2, 0],
      [2, 0, 0],
      [0, 0, 2],
    ],
    f = [
      [0, 1, 2],
      [0, 3, 1],
      [0, 2, 3],
      [1, 3, 2],
    ];
  const vertices = [
      ...p,
      ...p.map((v) => v.map((x) => x + 0.25)),
    ] as [number, number, number][],
    faces = [...f, ...f.map((v) => v.map((x) => x + 4))] as [
      number,
      number,
      number,
    ][];
  expect(auditManufacturingMesh({ vertices, faces }).valid).toBe(true);
  const source: WorkplaneShape = {
    id: "actual-crossing",
    name: "Intersecting closed tetrahedra",
    kind: "mesh",
    color: "#0169cc",
    x: 0,
    z: 0,
    size: 3,
    width: 3,
    depth: 3,
    height: 3,
    rotation: 0,
    importedMesh: {
      positions: faces.flatMap((face) =>
        face.flatMap((i) => vertices[i]),
      ),
      baseWidth: 3,
      baseHeight: 3,
      baseDepth: 3,
      triangleCount: 8,
      sourceFormat: "json",
    },
  };
  const rt = await manifoldModule();
  rt.setup();
  const engine = new PrecisionExportEngine(rt);
  for (const format of ["stl", "3mf"] as const)
    for (const maxEdgeMm of [0, 1]) {
      const result = await engine.run([source], format, {
        ...DEFAULT_PRECISION,
        maxEdgeMm,
      });
      expect(result.report.bodies[0].audit.valid).toBe(true);
      expect(
        result.report.bodies[0].surface.selfIntersections.found,
      ).toBeGreaterThan(0);
      expect(result.report.ready).toBe(false);
      expect(result.bytes).toBeNull();
    }
});

it("handles flush cutters, translated plates, scale and native group rotation", async () => {
  const { buildGroupedShapeFromSelection } = await import(
    "@/lib/editorBooleans"
  );
  const { PrecisionExportEngine } = await import("@/lib/precisionExport");
  const rt = await manifoldModule();
  rt.setup();
  const engine = new PrecisionExportEngine(rt);
  for (const variant of ["flush", "translated", "scaled", "rotated"]) {
    const selected = sevenHolePlateSelection().map((shape) =>
      variant === "flush" && shape.hole
        ? { ...shape, elevation: 0, height: 6 }
        : variant === "translated"
          ? {
              ...shape,
              x: shape.x + 1200.125,
              z: shape.z - 600.375,
              elevation: (shape.elevation ?? 0) + 5.25,
            }
          : variant === "scaled"
            ? {
                ...shape,
                x: shape.x / 2,
                z: shape.z / 2,
                elevation: (shape.elevation ?? 0) / 2,
                size: shape.size / 2,
                width: Number(shape.width) / 2,
                depth: Number(shape.depth) / 2,
                height: Number(shape.height) / 2,
              }
            : shape,
    );
    const grouped = await buildGroupedShapeFromSelection(selected, 4_000_000);
    expect(grouped.group).not.toBeNull();
    const source =
      variant === "rotated" ? { ...grouped.group!, rotation: 23 } : grouped.group!;
    for (const preset of ["high", "ultra"] as const) {
      const result = await engine.run([source], "stl", {
        ...DEFAULT_PRECISION,
        ...PRECISION_PRESETS[preset],
        preset,
      });
      expect(
        result.report.ready,
        `${variant}: ${JSON.stringify(result.report)}`,
      ).toBe(true);
      expect(result.report.bodies[0].surface.selfIntersections.found).toBe(0);
      expect(independentlyReimport(result.bytes!, "stl").audit.valid).toBe(
        true,
      );
    }
  }
}, 120000);
