import type { WorkplaneShape } from "@/types/layerling";

/** Exact geometry on the selected body wins over a retained mesh/group history. */
export function isPureMeshHollowSource(shape: WorkplaneShape): boolean {
  if (shape.cadBrep || shape.importedMesh?.brepStep) return false;
  if (shape.groupedShapes?.length) return shape.groupedShapes.some(isPureMeshHollowSource);
  if (shape.kind === "mesh" && shape.importedMesh) return true;
  return false;
}
