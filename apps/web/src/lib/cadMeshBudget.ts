/** Conservative allowance for kernel faces, healing temporaries and JS topology.
 * This is a working-memory budget, not an eligibility limit on display triangles.
 * Exact solids do not pay for their tessellation here. Workers remain killable.
 */
export const CAD_MESH_WORKING_BUDGET_BYTES = 1024 * 1024 * 1024;
export const CAD_FALLBACK_MESH_TRIANGLES = 4_000;
export function cadMeshWorkingBytes(triangles: number) {
  return Math.max(0, Math.ceil(triangles)) * 4096;
}
export function assertCadMeshBudget(triangles: number) {
  if (!Number.isFinite(triangles) || triangles < 0) throw new Error("Invalid mesh topology size");
  const estimated = cadMeshWorkingBytes(triangles);
  if (estimated > CAD_MESH_WORKING_BUDGET_BYTES) {
    throw new Error(`Mesh preparation needs an estimated ${Math.ceil(estimated / 1024 / 1024)} MiB, above the 1024 MiB isolated CAD worker budget. Use exact STEP geometry, separate parts, or simplify the mesh.`);
  }
}
