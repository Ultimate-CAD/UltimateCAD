import type { ConstraintSketch } from "@/lib/constraintSketch";
import { evaluateFeatureParameters, type FeatureParameter } from "@/lib/featureParameters";

export interface ThroughHoleFeature {
  id: string;
  kind: "throughHole";
  inputId: string;
  suppressed: boolean;
  xMm: number;
  zMm: number;
  diameterMm: number;
  pattern?: HolePattern;
}

export interface HolePattern {
  id: string;
  kind: "linear" | "circular";
  inputId: string;
  count: number;
  stepX: number;
  stepZ: number;
  centerX: number;
  centerZ: number;
  angleDeg: number;
}

export function holeInstance(hole:ThroughHoleFeature,index:number) {
  const p = hole.pattern;
  if (!index || !p) return { x:hole.xMm,z:hole.zMm,wall:hole.id+"/wall" };
  const wall = p.id + "/instance/" + index + "/wall";
  if (p.kind === "linear") return {wall,x:hole.xMm+index*p.stepX,z:hole.zMm+index*p.stepZ};
  const angle = index*p.angleDeg*Math.PI/180;
  const x = hole.xMm-p.centerX, z = hole.zMm-p.centerZ;
  return {wall,x:p.centerX+x*Math.cos(angle)-z*Math.sin(angle),z:p.centerZ+x*Math.sin(angle)+z*Math.cos(angle)};
}

export interface SketchPadHistory {
  schema: 1;
  sketch: { id: string; kind: "sketch" };
  pad: { id: string; kind: "pad" | "revolve"; profileId: string; depthParameter: string; angleParameter?: string; startAngle?: number };
  parameters: FeatureParameter[];
  pocket?: { id:string; sketchId:string; inputId:string; profile:ConstraintSketch; depthMm:number; suppressed:boolean };
  holes?: ThroughHoleFeature[];
  rimFinish?: { id: string; inputId: string; holeId: string; instance?: number; patternId?: string; kind: "fillet" | "chamfer"; sizeMm: number; suppressed: boolean };
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
  if (history?.schema !== 1 || history.sketch?.kind !== "sketch" || !["pad","revolve"].includes(history.pad?.kind)) throw Error("Unsupported feature history");
  const { sketch, pad } = history;
  if (![sketch.id,pad.id].every(id => typeof id === "string" && id.length > 0 && id.length <= 160) ||
      sketch.id === pad.id || pad.profileId !== sketch.id) throw Error("Broken pad profile reference");
  const ids = new Set([sketch.id,pad.id]);
  let previous = pad.id;
  if (history.holes !== undefined && (!Array.isArray(history.holes) || history.holes.length > 128)) throw Error("Unsupported hole history");
  if (history.pocket !== undefined) {
    const p=history.pocket;
    if (!p || ![p.id,p.sketchId].every(id=>typeof id==="string" && id.length>0 && id.length<=160 && !ids.has(id)) ||
       p.id===p.sketchId || p.inputId!==pad.id || typeof p.suppressed!=="boolean" || !p.profile || p.profile.featureHistory!==undefined ||
       !(Number.isFinite(p.depthMm) && p.depthMm>0 && p.depthMm<=1e6)) throw Error("Invalid sketch pocket");
    ids.add(p.id); ids.add(p.sketchId); previous=p.id;
  }
  let totalCuts=0;
  for (const hole of history.holes ?? []) {
    if (!hole || hole.kind !== "throughHole" || typeof hole.id !== "string" || !hole.id || hole.id.length > 160 ||
        ids.has(hole.id) || hole.inputId !== previous || typeof hole.suppressed !== "boolean") throw Error("Broken hole feature link");
    if (![hole.xMm,hole.zMm,hole.diameterMm].every(v=>Number.isFinite(v) && Math.abs(v)<=1e6) || hole.diameterMm <= 0) throw Error("Invalid hole dimensions for " + hole.id);
    ids.add(hole.id);
    previous = hole.id;
    const pattern=hole.pattern;
    if (pattern !== undefined) {
      if (!pattern || typeof pattern.id !== "string" || !pattern.id || pattern.id.length>160 || ids.has(pattern.id) ||
        pattern.inputId!==hole.id || !["linear","circular"].includes(pattern.kind) || !Number.isInteger(pattern.count) ||
        pattern.count<1 || pattern.count>256 || ![pattern.stepX,pattern.stepZ,pattern.centerX,pattern.centerZ,pattern.angleDeg].every(v=>Number.isFinite(v) && Math.abs(v)<=1e6)) throw Error("Invalid hole pattern for " + hole.id);
      ids.add(pattern.id);
    }
    totalCuts+=hole.suppressed ? 0 : pattern?.count ?? 1;
    if (totalCuts>512) throw Error("Through-hole history exceeds 512 cuts per rebuild");
  }
  const finish = history.rimFinish;
  if (finish !== undefined) {
    if (!finish || !Number.isInteger(finish.instance ?? 0) || (finish.instance ?? 0)<0 || !finish.id || typeof finish.id !== "string" || ids.has(finish.id) || finish.inputId !== previous ||
        !["fillet","chamfer"].includes(finish.kind) || typeof finish.suppressed !== "boolean" ||
        !history.holes?.some(h=>h.id === finish.holeId) || !(Number.isFinite(finish.sizeMm) && finish.sizeMm > 0 && finish.sizeMm <= 1e6))
      throw Error("Broken rim treatment definition");
  }
  const values = evaluateFeatureParameters(history.parameters).cache;
  if (pad.kind === "revolve") resolveRevolveAngle(history);
  const result = values.get(pad.depthParameter);
  if (!result || result.unit !== "mm" || result.value < 0.01 || result.value > 1e6) {
    throw Error("Pad depth requires a length parameter between 0.01 and 1000000 mm");
  }
  return result.value;
}


export function resolveRevolveAngle(history:SketchPadHistory):number {
  const op=history.pad;
  const angle=evaluateFeatureParameters(history.parameters).cache.get(op.angleParameter ?? "");
  if (!angle || angle.unit!=="deg" || !(Math.abs(angle.value)>1e-6 && Math.abs(angle.value)<=360) ||
      !(Number.isFinite(op.startAngle ?? 0) && Math.abs(op.startAngle ?? 0)<=360000)) throw Error("Revolve needs a finite angle from -360 to 360 deg, excluding zero");
  return angle.value;
}
