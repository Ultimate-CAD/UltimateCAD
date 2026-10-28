import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { planarMeshFaces } from "@/lib/cadPlanarMesh";

/** Faceted input stays faceted: fitting flat regions is not analytic-surface recovery.
 * The existing planar fitter uses 0.001 mm plane/corner tolerances. Volume agreement
 * bounds unintended cavity loss; kernel validity and a single solid are mandatory.
 */
export function planarMeshSolid(cad: OcctKernel, positions: ArrayLike<number>, indices: ArrayLike<number>): ShapeHandle | null {
  const flat = planarMeshFaces(cad, positions, indices);
  if (!flat) return null;
  let sourceVolume = 0, surfaceArea = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    sourceVolume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    surfaceArea += Math.hypot((by-ay)*(cz-az)-(bz-az)*(cy-ay), (bz-az)*(cx-ax)-(bx-ax)*(cz-az), (bx-ax)*(cy-ay)-(by-ay)*(cx-ax)) / 2;
  }
  try {
    for (const tolerance of [1e-6, 1e-5, 1e-4]) {
      let candidate: ShapeHandle | undefined;
      try {
        candidate = cad.sewAndSolidify(flat.faces, tolerance);
        const healed = cad.healSolid(candidate, tolerance);
        cad.release(candidate); candidate = healed;
        const oriented = cad.fixFaceOrientations(candidate);
        cad.release(candidate); candidate = oriented;
        if (cad.isSolid(candidate) && cad.isValid(candidate) &&
          Math.abs(Math.abs(cad.getVolume(candidate)) - Math.abs(sourceVolume)) <= Math.max(1e-6, surfaceArea * 0.002)) {
          const result = candidate; candidate = undefined; return result;
        }
      } finally { if (candidate !== undefined) cad.release(candidate); }
    }
    return null;
  } finally { flat.faces.forEach(face => cad.release(face)); }
}
