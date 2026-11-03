import { evaluateFeatureParameters, type FeatureParameter } from "@/lib/featureParameters";

export interface SketchPadHistory {
  schema: 1;
  sketch: { id: string; kind: "sketch" };
  pad: { id: string; kind: "pad"; profileId: string; depthParameter: string };
  parameters: FeatureParameter[];
}

export function createSketchPadHistory(depth: number): SketchPadHistory {
  const sketchId = crypto.randomUUID();
  return {
    schema: 1,
    sketch: { id: sketchId, kind: "sketch" },
    pad: { id: crypto.randomUUID(), kind: "pad", profileId: sketchId, depthParameter: "depth" },
    parameters: [{ name: "depth", expression: depth + " mm", unit: "mm" }],
  };
}

export function resolvePadDepth(history: SketchPadHistory): number {
  if (history?.schema !== 1 || history.sketch?.kind !== "sketch" || history.pad?.kind !== "pad") throw Error("Unsupported feature history");
  const { sketch, pad } = history;
  if (![sketch.id,pad.id].every(id => typeof id === "string" && id.length > 0 && id.length <= 160) ||
      sketch.id === pad.id || pad.profileId !== sketch.id) throw Error("Broken pad profile reference");
  const result = evaluateFeatureParameters(history.parameters).cache.get(pad.depthParameter);
  if (!result || result.unit !== "mm" || result.value < 0.1 || result.value > 1e6) {
    throw Error("Pad depth requires a length parameter between 0.1 and 1000000 mm");
  }
  return result.value;
}
