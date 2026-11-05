import type { WorkplaneShape } from "@/types/layerling";
import { exportBodiesWithLooseHoles, unionOverlappingExportMeshes, visibleExportShapes } from "@/lib/editorBooleans";
import { meshForShape, type MeshData } from "@/lib/editorMeshCore";
import { analyticMeshForExport } from "@/lib/stepExport";
import { exportMeshesToStl } from "@/lib/stlExport";
import { DEFAULT_STL_QUALITY, stlQualitySettings, type StlQuality } from "@/lib/stlQuality";

/** Ordinary export. No topology, intersection, thickness, deviation certification or repair. */
export async function exportStlDesign(shapes: readonly WorkplaneShape[], quality: StlQuality = DEFAULT_STL_QUALITY) {
  const settings = stlQualitySettings(quality);
  const warnings: string[] = [];
  const { visible } = visibleExportShapes(shapes);
  const mesher = async (shape: WorkplaneShape): Promise<MeshData> => {
    // One OCCT meshing pass with requested deflections. Sampling/certification and
    // numerical mesh conditioning belong to the optional analysis path.
    const analytic = await analyticMeshForExport(shape, settings.deviationMm, settings.angleDeg, undefined, Number.MAX_SAFE_INTEGER, false);
    if (analytic) return analytic.mesh;
    if (shape.kind === "mesh" && !shape.groupedShapes?.length && (!shape.importedMesh || shape.importedMesh.positions.length < 9 || shape.importedMesh.positions.length % 9 !== 0))
      throw new Error("STL conversion failed: missing or incomplete source mesh geometry");
    return meshForShape(shape);
  };
  const cut = await exportBodiesWithLooseHoles(visible, mesher);
  if (cut.holeCutsFailed) throw new Error("STL conversion failed while subtracting a hole; no uncut replacement was exported");
  // Pass the actual export meshes to the existing union, rather than rebuilding
  // a viewport approximation. Keep every resulting shell and small component.
  const result = await unionOverlappingExportMeshes(cut.solids, cut.meshes, cut.meshes.map(() => true), true);
  if (result.gescheitert) warnings.push("Some overlapping meshes could not be joined; their original surfaces are included, unverified.");
  const triangles = result.meshes.reduce((n, mesh) => n + mesh.faces.length, 0);
  if (!triangles) throw new Error("No geometry to export as STL");
  const bytes = new Uint8Array(exportMeshesToStl(result.meshes, { preserveFacets: true, unverified: true }));
  return { bytes, triangles, bodies: result.meshes.length, mergedBodies: result.verschmolzen, failedMerges: result.gescheitert, warnings, verified: false as const, quality: settings };
}
