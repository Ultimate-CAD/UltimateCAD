/// <reference lib="webworker" />
import { buildMessage } from "@/lib/buildStamp";
import { getManifoldRuntime, setManifoldAssetBase } from "@/lib/editorMeshCore";
import { PrecisionExportEngine } from "@/lib/precisionExport";
import type { WorkplaneShape } from "@/types/layerling";
import type { PrecisionSettings } from "@/lib/precisionMesh";
import type { PrecisionFormat } from "@/lib/precisionExport";
let engine: PrecisionExportEngine | null = null;
self.postMessage(buildMessage());
self.onmessage = async (
  e: MessageEvent<{
    id: number;
    shapes: WorkplaneShape[];
    format: PrecisionFormat;
    settings: PrecisionSettings;
    assetBase: string;
  }>,
) => {
  const r = e.data;
  try {
    setManifoldAssetBase(r.assetBase);
    engine ??= new PrecisionExportEngine(await getManifoldRuntime());
    const result = await engine.run(r.shapes, r.format, r.settings, (text) =>
      self.postMessage({ id: r.id, type: "progress", text }),
    );
    self.postMessage({ id: r.id, type: "result", result }, [
      result.preview.before.buffer,
      result.preview.after.buffer,
      ...(result.bytes ? [result.bytes.buffer] : []),
    ]);
  } catch (error) {
    self.postMessage({
      id: r.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
