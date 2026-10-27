/** Script-driven geometry is a distinct representation, never an OCCT B-rep. */
export type ScadValue = number | string | boolean | number[];
export type ScadFile = { encoding: "utf8" | "base64"; data: string };
export type OpenScadDocument = {
  version: 1;
  source: string;
  fileName: string;
  parameters: Record<string, ScadValue>;
  expressions: Record<string, string>;
  presets: Record<string, { parameters: Record<string, ScadValue>; expressions: Record<string, string> }>;
  files: Record<string, ScadFile>;
  sourceDirectory?: string;
  libraryPaths: string[];
  meshKey?: string;
  engineVersion?: string;
  needsRegeneration?: boolean;
};
export type ScadParameter = {
  name: string; group: string; description: string; type: "number" | "string" | "boolean" | "vector";
  default: ScadValue; widget: string; min?: number; max?: number; step?: number;
  options?: Array<{ value: ScadValue; label: string }>;
};
export type ScadSchema = { parameters: ScadParameter[]; groups: string[]; modules: string[]; includes: Array<{ kind: string; file: string }>; requiredLibraries: string[] };
export type ScadRenderResult = {
  stlBase64: string; key: string; cached: boolean; durationMs: number; engineVersion: string;
  dependencies: Array<{ path: string; sha256: string }>; files: Record<string, ScadFile>; diagnostics: string;
};
export const OPENSCAD_EXAMPLE = `/* [Dimensions] */
// Outside width in mm
width = 40; // [10:1:100]
// Outside depth in mm
depth = 30; // [10:1:100]
height = 12; // [5:1:50]
wall = 2; // [1:0.5:5]
/* [Detail] */
round_hole = true;
quality = 32; // [16:Low,32:Normal,64:Fine]
/* [Hidden] */
inner_width = width - 2*wall;
function inner_depth(d,w) = d - 2*w;
module shell() {
  difference() {
    cube([width,depth,height]);
    translate([wall,wall,wall]) cube([inner_width,inner_depth(depth,wall),height]);
    if(round_hole) translate([width/2,depth/2,-1]) cylinder(h=height+2,d=6,$fn=quality);
  }
}
shell();
`;
export function newOpenScadDocument(source = OPENSCAD_EXAMPLE, fileName = "parametric-box.scad"): OpenScadDocument {
  return { version: 1, source, fileName, parameters: {}, expressions: {}, presets: {}, files: {}, libraryPaths: [] };
}
/** Validate persisted metadata; evaluation remains exclusively in the native process. */
export function validateOpenScadDocument(value: unknown): asserts value is OpenScadDocument {
  if (!value || typeof value !== "object") throw new Error("Invalid OpenSCAD document");
  const doc = value as OpenScadDocument;
  if (doc.version !== 1 || typeof doc.source !== "string" || doc.source.length > 2_000_000 || typeof doc.fileName !== "string" || !doc.fileName.toLowerCase().endsWith(".scad")) throw new Error("Invalid OpenSCAD source or version");
  for (const field of ["parameters", "expressions", "presets", "files"] as const) {
    if (!doc[field] || typeof doc[field] !== "object" || Array.isArray(doc[field])) throw new Error(`Invalid OpenSCAD ${field}`);
  }
  if (!Array.isArray(doc.libraryPaths) || doc.libraryPaths.some(p => typeof p !== "string")) throw new Error("Invalid OpenSCAD library paths");
  if (JSON.stringify(doc).length > 48_000_000) throw new Error("OpenSCAD document exceeds 48 MB");
  for (const [name, expression] of Object.entries(doc.expressions)) {
    if (!/^\$?[a-zA-Z_]\w*$/.test(name) || typeof expression !== "string" || expression.length > 4096) throw new Error("Invalid OpenSCAD parameter expression");
  }
  for (const [name, parameter] of Object.entries(doc.parameters)) {
    if (!/^\$?[a-zA-Z_]\w*$/.test(name) || !(typeof parameter === "string" || typeof parameter === "boolean" || (typeof parameter === "number" && Number.isFinite(parameter)) || (Array.isArray(parameter) && parameter.every(v => typeof v === "number" && Number.isFinite(v))))) throw new Error("Invalid OpenSCAD parameter value");
  }
}
