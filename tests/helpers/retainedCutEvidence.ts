import type { StlExportMesh } from "@/lib/stlExport";
import type { HollowCut } from "@/lib/hollowFinishing";

/** Independent exhaustive face-membership check, without relying on output ordering or clipping internals. */
export function retainedCutEvidence(
  source: StlExportMesh,
  result: StlExportMesh,
  cut: HollowCut,
) {
  const sourcePoints = new Map(source.vertices.map((p, i) => [p.join(","), i]));
  const resultToSource = result.vertices.map((p) =>
    sourcePoints.get(p.join(",")),
  );
  const faces = new Set<string>();
  for (const f of result.faces) {
    const ids = f.map((i) => resultToSource[i]);
    if (ids.every((i) => i !== undefined)) faces.add(ids.join(","));
  }
  let checkedTriangles = 0;
  for (const f of source.faces) {
    if (
      !f.every((i) =>
        cut.keepPositive
          ? source.vertices[i][cut.axis] >= cut.position
          : source.vertices[i][cut.axis] <= cut.position,
      )
    )
      continue;
    if (!faces.has(f.join(",")))
      throw new Error(
        `Unchanged retained source face was lost or altered: ${f.join(",")}`,
      );
    checkedTriangles++;
  }
  return {
    checkedTriangles,
    maxRetainedTriangleDeviationMm: 0,
    method:
      "exhaustive unchanged-coordinate and oriented face-membership comparison",
  };
}
