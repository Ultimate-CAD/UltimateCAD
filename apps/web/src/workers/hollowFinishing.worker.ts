/// <reference lib="webworker" />
import {
  getManifoldRuntime,
  setManifoldAssetBase,
  meshForShape,
} from "@/lib/editorMeshCore";
import {
  prepareFinishingSource,
  cutHollowBase,
  validateFinishing,
  type FinishingSource,
  type HollowCut,
} from "@/lib/hollowFinishing";
import { buildMessage } from "@/lib/buildStamp";
import { finishedMeshShape } from "@/lib/hollowFinishingShape";
import type { WorkplaneShape } from "@/types/layerling";
import {
  observeGeometryTiming,
  startGeometryTiming,
  withGeometryTiming,
  type GeometrySpan,
} from "@/lib/geometryTiming";

let source: FinishingSource | undefined;
let shape: WorkplaneShape | undefined;
let cached:
  | {
      key: string;
      result: ReturnType<typeof cutHollowBase>;
      validation: ReturnType<typeof validateFinishing>;
      positions: Float64Array;
    }
  | undefined;
self.postMessage(buildMessage());
self.onmessage = async ({ data }) => {
  const requestStart = performance.now(),
    timings: GeometrySpan[] = [];
  observeGeometryTiming((span) => timings.push(span));
  const post = (
    type: string,
    detail: object = {},
    transfer: Transferable[] = [],
  ) =>
    self.postMessage(
      {
        type,
        revision: data.revision,
        ...detail,
        ...(type !== "progress"
          ? {
              timings: timings.slice(),
              requestMs: performance.now() - requestStart,
            }
          : {}),
      },
      { transfer },
    );
  try {
    if (data.type === "init") {
      setManifoldAssetBase(data.assetBase);
      const vertices: [number, number, number][] = [],
        faces: [number, number, number][] = [];
      const p: Float64Array = data.positions;
      if (p.length % 9) throw new Error("Invalid source triangle data");
      if (p.length / 9 > 2_000_000)
        throw new Error(
          "Open Hollow Base supports up to 2 million input triangles. Source retained.",
        );
      const endUnpack = startGeometryTiming("worker.input.unpack");
      for (let i = 0; i < p.length; i += 3)
        vertices.push([p[i], p[i + 1], p[i + 2]]);
      for (let i = 0; i < vertices.length; i += 3)
        faces.push([i, i + 1, i + 2]);
      endUnpack();
      source = withGeometryTiming("source.prepare", () =>
        prepareFinishingSource({ vertices, faces }),
      );
      cached = undefined;
      shape = data.shape;
      post("ready", { audit: source.audit });
    } else if (data.type === "preview") {
      if (!source) throw new Error("Finishing source is not initialized");
      const cut: HollowCut = data.cut,
        key = JSON.stringify(cut);
      let cacheHit = true;
      if (cached?.key !== key) {
        cacheHit = false;
        post("progress", {
          message: "Clipping triangles and constructing rim",
        });
        const activeSource = source;
        const runtime = await getManifoldRuntime();
        if (source !== activeSource)
          throw new Error(
            "Source changed while initializing the preview engine; request a new preview.",
          );
        const result = withGeometryTiming("cut.total", () =>
          cutHollowBase(runtime, activeSource, cut),
        );
        const endPack = startGeometryTiming("worker.packForTransform");
        const raw = new Float64Array(result.mesh.faces.length * 9);
        let i = 0;
        for (const f of result.mesh.faces)
          for (const n of f)
            for (const value of result.mesh.vertices[n]) raw[i++] = value;
        endPack();
        // Verify the exact rebasing/mirroring/rotation and encoding that Apply will use.
        const manufacturingMesh = withGeometryTiming(
          "worker.rebaseTransform",
          () =>
            shape ? meshForShape(finishedMeshShape(shape, raw)) : result.mesh,
        );
        const validation = withGeometryTiming("validation.total", () =>
          validateFinishing(
            activeSource,
            result,
            0.8,
            (message) => post("progress", { message }),
            manufacturingMesh,
          ),
        );
        cached = { key, result, validation, positions: raw };
      }
      const { result, validation } = cached!;
      // Transfer only a copy; retain exactly one immutable packed preview for cache hits.
      const positions = withGeometryTiming("worker.packResponse", () =>
        cached!.positions.slice(),
      );
      post(
        "preview",
        {
          positions,
          stats: {
            ...result.stats,
            maxManufacturingEncodingDisplacementMm:
              validation.maxManufacturingEncodingDisplacementMm,
            validationMs: validation.validationMs,
            cacheHit,
            requestMs: performance.now() - requestStart,
          },
          audit: result.audit,
          surface: validation.surface,
          encodedSurface: validation.encodedSurface,
        },
        [positions.buffer],
      );
    }
  } catch (error) {
    post("error", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    observeGeometryTiming();
  }
};
