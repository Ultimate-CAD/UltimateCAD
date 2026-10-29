import { it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Session } from "node:inspector";
import manifoldModule from "manifold-3d";
import { importLylProject } from "@/lib/lylProject";
import {
  finishingSourcePositions,
  finishedMeshShape,
} from "@/lib/hollowFinishingShape";
import {
  prepareFinishingSource,
  cutHollowBase,
  validateFinishing,
} from "@/lib/hollowFinishing";
import { meshForShape } from "@/lib/editorMeshCore";
import {
  observeGeometryTiming,
  withGeometryTiming,
  type GeometrySpan,
} from "@/lib/geometryTiming";
import { retainedCutEvidence } from "../helpers/retainedCutEvidence";

it.skipIf(!process.env.LAYERLING_GEOMETRY_PROFILE)(
  "profiles preserved .8 fixtures and checks deterministic geometry and QA parity",
  async () => {
    const label = process.env.LAYERLING_GEOMETRY_PROFILE!,
      out = `.codex-run/geometry9/${label}`;
    mkdirSync(out, { recursive: true });
    const runtime = await manifoldModule();
    runtime.setup();
    const records = [];
    for (const [name, file, position] of [
      [
        "organic",
        `${process.env.LAYERLING_GEOMETRY_FIXTURE_DIR ?? ".codex-run/geometry9/fixtures"}/organic-upright.lyl`,
        5.123,
      ],
      [
        "500k",
        `${process.env.LAYERLING_GEOMETRY_FIXTURE_DIR ?? ".codex-run/geometry9/fixtures"}/closed-hollow-500000.lyl`,
        3.123,
      ],
    ] as const) {
      const loadStart = performance.now(),
        restored = await importLylProject(readFileSync(file)),
        shape = restored.shapes[0];
      const fixtureLoadMs = performance.now() - loadStart,
        spans: GeometrySpan[] = [];
      const inspector = new Session();
      inspector.connect();
      const post = (method: string, params: object = {}) =>
        new Promise<any>((resolve, reject) =>
          inspector.post(method as any, params, (error, result) =>
            error ? reject(error) : resolve(result),
          ),
        );
      if (process.env.LAYERLING_GEOMETRY_CPU) {
        await post("Profiler.enable");
        await post("Profiler.start");
      }
      observeGeometryTiming((span) => spans.push(span));
      const start = performance.now();
      const packed = withGeometryTiming("worker.input.scale", () =>
        finishingSourcePositions(shape),
      );
      const input = withGeometryTiming("worker.input.unpack", () => {
        const vertices: [number, number, number][] = [],
          faces: [number, number, number][] = [];
        for (let i = 0; i < packed.length; i += 3)
          vertices.push([packed[i], packed[i + 1], packed[i + 2]]);
        for (let i = 0; i < vertices.length; i += 3)
          faces.push([i, i + 1, i + 2]);
        return { vertices, faces };
      });
      const source = withGeometryTiming("source.prepare", () =>
        prepareFinishingSource(input),
      );
      const previewStart = performance.now();
      const result = withGeometryTiming("cut.total", () =>
        cutHollowBase(runtime, source, {
          axis: 1,
          position,
          keepPositive: true,
        }),
      );
      const pack = () => {
        const positions = new Float64Array(result.mesh.faces.length * 9);
        let i = 0;
        for (const f of result.mesh.faces)
          for (const n of f)
            for (const value of result.mesh.vertices[n]) positions[i++] = value;
        return positions;
      };
      const raw = withGeometryTiming("worker.packForTransform", pack);
      const manufacturing = withGeometryTiming("worker.rebaseTransform", () =>
        meshForShape(finishedMeshShape(shape, raw)),
      );
      const validation = withGeometryTiming("validation.total", () =>
        validateFinishing(
          source,
          result,
          0.8,
          (message) =>
            spans.push({
              name: `phase:${message}`,
              startMs: performance.now(),
              durationMs: 0,
              depth: 0,
            }),
          manufacturing,
        ),
      );
      withGeometryTiming("worker.packResponse", pack);
      const previewMs = performance.now() - previewStart,
        totalMs = performance.now() - start;
      observeGeometryTiming();
      if (process.env.LAYERLING_GEOMETRY_CPU) {
        const { profile } = await post("Profiler.stop");
        writeFileSync(`${out}/${name}.cpuprofile`, JSON.stringify(profile));
        const nodes = new Map<number, any>(
            profile.nodes.map((n: any) => [n.id, n]),
          ),
          cost = new Map<number, number>();
        profile.samples.forEach((id: number, i: number) =>
          cost.set(id, (cost.get(id) || 0) + (profile.timeDeltas[i] || 0)),
        );
        writeFileSync(
          `${out}/${name}-cpu-top.json`,
          JSON.stringify(
            [...cost]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 40)
              .map(([id, us]) => ({
                ...nodes.get(id).callFrame,
                selfMs: us / 1000,
              })),
            null,
            2,
          ),
        );
      }
      inspector.disconnect();
      const output = Float64Array.from(result.mesh.vertices.flat()),
        indices = Uint32Array.from(result.mesh.faces.flat());
      const geometryHash = createHash("sha256")
        .update(Buffer.from(output.buffer))
        .update(Buffer.from(indices.buffer))
        .digest("hex");
      const record = {
        name,
        fixture: file,
        fixtureLoadMs,
        previewMs,
        totalMs,
        geometryHash,
        stats: result.stats,
        audit: result.audit,
        validation,
        retained: retainedCutEvidence(source.mesh, result.mesh, {
          axis: 1,
          position,
          keepPositive: true,
        }),
        spans,
        memory: process.memoryUsage(),
        peakRssKiB: process.resourceUsage().maxRSS,
      };
      if (label !== "baseline") {
        const baseline = JSON.parse(
          readFileSync(".codex-run/geometry9/baseline/profile.json", "utf8"),
        ).find((candidate: any) => candidate.name === name);
        expect(geometryHash).toBe(baseline.geometryHash);
        expect(result.audit).toEqual(baseline.audit);
        expect(validation.surface).toEqual(baseline.validation.surface);
        expect(validation.encodedSurface).toEqual(
          baseline.validation.encodedSurface,
        );
      }
      records.push(record);
      writeFileSync(`${out}/profile.json`, JSON.stringify(records, null, 2));
      expect(validation.surface.selfIntersections).toMatchObject({
        complete: true,
        found: 0,
      });
      expect(validation.encodedSurface.selfIntersections).toMatchObject({
        complete: true,
        found: 0,
      });
    }
  },
  240000,
);
