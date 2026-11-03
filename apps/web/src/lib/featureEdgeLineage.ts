import type { EvolutionData, OcctKernel, ShapeHandle } from "occt-wasm";

/** Only this role pair is durable. Handles belong to the evaluation's kernel arena. */
export interface FeatureEdgeRef {
  firstFace: string;
  secondFace: string;
}

export type NamedFaces = Map<string, ShapeHandle[]>;
const HASH_LIMIT = 2_147_483_647;

function uniqueFaces(kernel: OcctKernel, solids: ShapeHandle[]) {
  const faces = new Map<number, ShapeHandle>();
  for (const solid of solids) {
    for (const face of kernel.getSubShapes(solid, "face")) {
      const hash = kernel.hashCode(face, HASH_LIMIT);
      const existing = faces.get(hash);
      if (existing !== undefined && !kernel.isSame(existing, face)) {
        throw new Error("Ambiguous face hash in feature evaluation");
      }
      faces.set(hash, face);
    }
  }
  return faces;
}

function modifiedFaces(history: EvolutionData) {
  const mapped = new Map<number, number[]>();
  const data = history.modified;
  for (let i = 0; i < data.length;) {
    const input = data[i++];
    const count = data[i++];
    if (!Number.isInteger(count) || count < 0 || i + count > data.length || mapped.has(input)) {
      throw new Error("Invalid OCCT face evolution record");
    }
    mapped.set(input, data.slice(i, i + count));
    i += count;
  }
  return mapped;
}

/** Propagate named stock and tool faces through this cut, including removals and splits. */
export function cutWithNamedFaces(kernel: OcctKernel, stock: ShapeHandle, tool: ShapeHandle, roles: NamedFaces) {
  const inputs = uniqueFaces(kernel, [stock, tool]);
  const history = kernel.cutWithHistory(stock, tool, [...inputs.keys()], HASH_LIMIT);
  const outputs = uniqueFaces(kernel, [history.result]);
  const modified = modifiedFaces(history);
  const deleted = new Set(history.deleted);
  const next: NamedFaces = new Map();
  for (const [role, faces] of roles) {
    const surviving = new Set<ShapeHandle>();
    for (const face of faces) {
      const key = kernel.hashCode(face, HASH_LIMIT);
      const input = inputs.get(key);
      if (input === undefined || !kernel.isSame(input, face)) throw new Error("Stale input face: " + role);
      if (deleted.has(key)) continue;
      const replacements = modified.get(key);
      if (replacements) {
        for (const hash of replacements) {
          const output = outputs.get(hash);
          if (output === undefined) throw new Error("Missing modified face: " + role);
          surviving.add(output);
        }
      } else {
        const same = outputs.get(key);
        if (same !== undefined && kernel.isSame(same, input)) surviving.add(same);
      }
    }
    next.set(role, [...surviving]);
  }
  return { solid: history.result, faces: next };
}

export function resolveFeatureEdge(kernel: OcctKernel, named: NamedFaces, ref: FeatureEdgeRef) {
  function face(role: string) {
    const matches = named.get(role) ?? [];
    if (!matches.length) throw new Error("Missing feature face: " + role);
    if (matches.length !== 1) throw new Error("Split feature face: " + role);
    return matches[0];
  }
  const a = face(ref.firstFace), b = face(ref.secondFace);
  if (kernel.isSame(a, b)) throw new Error("An edge requires two distinct faces");
  const first = kernel.getSubShapes(a, "edge"), second = kernel.getSubShapes(b, "edge");
  const common: ShapeHandle[] = [];
  for (const edge of first) {
    if (second.some(other => kernel.isSame(edge, other)) && !common.some(other => kernel.isSame(edge, other))) {
      common.push(edge);
    }
  }
  if (common.length !== 1) throw new Error("Expected one shared edge, found " + common.length);
  return common[0];
}
