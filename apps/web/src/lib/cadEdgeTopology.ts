import type { OcctKernel, ShapeHandle } from "occt-wasm";

/**
 * Build an edge-hash to incident-face-hashes map without walking every face for
 * every edge. OCCT's edgeToFaceMap does that nested traversal; the per-face
 * subShapeHashes call reports the same unique topological edges without
 * allocating edge handles.
 */
export function buildCadEdgeFaceMap(cad: OcctKernel, faces: readonly ShapeHandle[], hashUpperBound: number) {
  const map = new Map<number, number[]>();
  const topology = cad as OcctKernel & {
    subShapeHashes?: (shape: ShapeHandle, type: "edge", hashUpperBound: number) => number[];
  };
  if (typeof topology.subShapeHashes !== "function") {
    throw new Error("The CAD kernel does not support handle-free sub-shape hashes");
  }

  for (const face of faces) {
    const faceHash = cad.hashCode(face, hashUpperBound);
    for (const edgeHash of topology.subShapeHashes(face, "edge", hashUpperBound)) {
      const incident = map.get(edgeHash);
      if (incident) {
        // Match edgeToFaceMap's semantics: one face hash per edge, even if an
        // edge occurs more than once in the same face's boundary wires.
        if (!incident.includes(faceHash)) incident.push(faceHash);
      } else {
        map.set(edgeHash, [faceHash]);
      }
    }
  }
  return map;
}
