import type { ManifoldToplevel, Vec2 } from "manifold-3d";
import type { StlExportMesh } from "@/lib/stlExport";
import {
  auditManufacturingMesh,
  indexManufacturingMesh,
} from "@/lib/manufacturingMesh";
import { manufacturingSurfaceChecks } from "@/lib/meshManufacturingQa";

type Point = [number, number, number];
type Face = [number, number, number];
export type HollowCut = {
  axis: 0 | 1 | 2;
  position: number;
  keepPositive: boolean;
};
export type FinishingMesh = { vertices: Point[]; faces: Face[] };
export type FinishingSource = ReturnType<typeof prepareFinishingSource>;

export function prepareFinishingSource(input: StlExportMesh) {
  if (input.faces.length > 2_000_000)
    throw new Error(
      "This finishing worker supports up to 2 million input triangles. Source was retained.",
    );
  const mesh = indexManufacturingMesh(input);
  const audit = auditManufacturingMesh(mesh);
  if (!audit.valid || audit.solidComponents !== 1)
    throw new Error(
      "Select one closed, consistently oriented manifold material body. Repair invalid or separate bodies explicitly before finishing.",
    );
  return { mesh, audit, surfaceChecked: false };
}

function area(loop: number[], vertices: Point[], u: number, v: number) {
  // Shift the origin to avoid cancellation for models far from zero.
  const origin = vertices[loop[0]];
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = vertices[loop[i]],
      b = vertices[loop[(i + 1) % loop.length]];
    sum +=
      (a[u] - origin[u]) * (b[v] - origin[v]) -
      (b[u] - origin[u]) * (a[v] - origin[v]);
  }
  return sum / 2;
}

function inside(
  p: Point,
  loop: number[],
  vertices: Point[],
  u: number,
  v: number,
) {
  let contained = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = vertices[loop[i]],
      b = vertices[loop[j]];
    const cross = (b[u] - a[u]) * (p[v] - a[v]) - (b[v] - a[v]) * (p[u] - a[u]);
    if (
      cross === 0 &&
      p[u] >= Math.min(a[u], b[u]) &&
      p[u] <= Math.max(a[u], b[u]) &&
      p[v] >= Math.min(a[v], b[v]) &&
      p[v] <= Math.max(a[v], b[v])
    )
      throw new Error(
        "Cut contours touch or overlap. Move the plane slightly away from the shared feature.",
      );
    if (
      a[v] > p[v] !== b[v] > p[v] &&
      p[u] < ((b[u] - a[u]) * (p[v] - a[v])) / (b[v] - a[v]) + a[u]
    )
      contained = !contained;
  }
  return contained;
}

/** Clips only crossing faces; unchanged retained faces and coordinates are copied exactly.
 * Triangulation uses the already bundled Manifold polygon kernel, not a new language/CSG engine.
 * No tolerance weld, projection of existing vertices, surface reconstruction or SDF is performed.
 */
export function cutHollowBase(
  runtime: Pick<ManifoldToplevel, "triangulate">,
  source: FinishingSource,
  cut: HollowCut,
) {
  const start = performance.now();
  if (![0, 1, 2].includes(cut.axis) || !Number.isFinite(cut.position))
    throw new Error("Choose a finite local cutting-plane position and axis.");
  const { mesh } = source,
    { axis, position, keepPositive } = cut;
  const u = (axis + 1) % 3,
    v = (axis + 2) % 3;
  const vertices: Point[] = [],
    faces: Face[] = [],
    original = new Map<number, number>(),
    crossings = new Map<string, number>();
  const onPlane = new Set<number>();
  const distance = mesh.vertices.map(
    (p) => (p[axis] - position) * (keepPositive ? 1 : -1),
  );
  let retainedTriangles = 0,
    clippedTriangles = 0,
    removedTriangles = 0;
  const vertex = (i: number) => {
    let n = original.get(i);
    if (n === undefined) {
      n = vertices.length;
      vertices.push([...mesh.vertices[i]]);
      original.set(i, n);
      if (distance[i] === 0) onPlane.add(n);
    }
    return n;
  };
  const crossing = (a: number, b: number) => {
    if (distance[a] === 0) return vertex(a);
    if (distance[b] === 0) return vertex(b);
    const low = Math.min(a, b),
      high = Math.max(a, b),
      key = `${low},${high}`;
    let n = crossings.get(key);
    if (n === undefined) {
      const p = mesh.vertices[low],
        q = mesh.vertices[high],
        t = distance[low] / (distance[low] - distance[high]);
      const point = p.map((x, j) =>
        j === axis ? position : x + t * (q[j] - x),
      ) as Point;
      n = vertices.length;
      vertices.push(point);
      crossings.set(key, n);
      onPlane.add(n);
    }
    return n;
  };
  for (const face of mesh.faces) {
    const d = face.map((i) => distance[i]);
    if (d.every((x) => x === 0))
      throw new Error(
        "The plane coincides with an existing face. Adjust its position slightly for an unambiguous cut.",
      );
    if (d.every((x) => x >= 0)) {
      faces.push(face.map(vertex) as Face);
      retainedTriangles++;
      continue;
    }
    if (d.every((x) => x <= 0)) {
      removedTriangles++;
      continue;
    }
    const polygon: number[] = [];
    for (let j = 0; j < 3; j++) {
      const a = face[j],
        b = face[(j + 1) % 3];
      if (distance[a] >= 0) polygon.push(vertex(a));
      if (
        (distance[a] > 0 && distance[b] < 0) ||
        (distance[a] < 0 && distance[b] > 0)
      )
        polygon.push(crossing(a, b));
    }
    for (let j = 1; j < polygon.length - 1; j++)
      faces.push([polygon[0], polygon[j], polygon[j + 1]]);
    clippedTriangles++;
  }
  if (!removedTriangles && !clippedTriangles)
    throw new Error("The plane removes no material. Move it inside the body.");
  if (!faces.length)
    throw new Error(
      "The retained side is empty. Reverse the retained side or move the plane.",
    );

  // Only planar edges can become a cut boundary; every crossing is shared by its source edge ID.
  const planeEdges = new Map<string, { a: number; b: number; count: number }>();
  for (const f of faces)
    for (let j = 0; j < 3; j++) {
      const a = f[j],
        b = f[(j + 1) % 3];
      if (!onPlane.has(a) || !onPlane.has(b)) continue;
      const key = `${Math.min(a, b)},${Math.max(a, b)}`,
        existing = planeEdges.get(key);
      if (existing) existing.count++;
      else planeEdges.set(key, { a, b, count: 1 });
    }
  const next = new Map<number, number>(),
    incoming = new Set<number>();
  for (const { a, b, count } of planeEdges.values())
    if (count === 1) {
      if (next.has(a) || incoming.has(b))
        throw new Error(
          "Ambiguous branching cut contour. Move the plane away from the touching feature.",
        );
      next.set(a, b);
      incoming.add(b);
    }
  const loops: number[][] = [];
  while (next.size) {
    const first = next.keys().next().value!,
      loop: number[] = [];
    let n = first;
    do {
      loop.push(n);
      const target = next.get(n);
      if (target === undefined)
        throw new Error(
          "Cut boundary is not a closed contour; no geometry was applied.",
        );
      next.delete(n);
      n = target;
    } while (n !== first);
    if (loop.length < 3)
      throw new Error(
        "The cut creates a collapsed contour. Move the plane away from the thin feature.",
      );
    loops.push(loop);
  }
  const areas = loops.map((l) => area(l, vertices, u, v));
  const depths = loops.map(
    (l, i) =>
      loops.filter(
        (other, j) => i !== j && inside(vertices[l[0]], other, vertices, u, v),
      ).length,
  );
  if (!depths.some((d) => d % 2 === 1))
    throw new Error(
      "This plane does not intersect an enclosed cavity. Move the plane into the hollow region; a solid cap would not open the body.",
    );
  loops.forEach((loop, i) => {
    if (!Number.isFinite(areas[i]) || areas[i] === 0)
      throw new Error("The cut creates a zero-area contour.");
    // The retained side boundary runs opposite to its closing rim.
    const expected = (depths[i] % 2 === 0 ? 1 : -1) * (keepPositive ? 1 : -1);
    if (Math.sign(areas[i]) !== expected)
      throw new Error(
        "Nested cut contours have inconsistent material orientation. Inspect shell orientation and cavity containment.",
      );
    if (areas[i] * (depths[i] % 2 === 0 ? 1 : -1) < 0) loop.reverse();
  });
  const ordered = loops.flat(),
    polygons = loops.map((l) =>
      l.map((i) => [vertices[i][u], vertices[i][v]] as Vec2),
    );
  const caps = runtime.triangulate(polygons, 0, false);
  const rimStart = faces.length;
  for (const [a, b, c] of caps)
    faces.push(
      keepPositive
        ? [ordered[a], ordered[c], ordered[b]]
        : [ordered[a], ordered[b], ordered[c]],
    );
  const result: FinishingMesh = { vertices, faces };
  const audit = auditManufacturingMesh(result),
    encodedAudit = auditManufacturingMesh(result, true);
  if (
    !audit.valid ||
    !encodedAudit.valid ||
    audit.solidComponents !== source.audit.solidComponents ||
    encodedAudit.solidComponents !== source.audit.solidComponents
  )
    throw new Error(
      `The cut could not create a safe connected rim (${audit.boundaryEdges}/${encodedAudit.boundaryEdges} boundary edges, ${encodedAudit.degenerateFaces} encoded degenerates). Try another plane; no repair was applied.`,
    );
  if (audit.cavityShells !== 0)
    throw new Error(
      "The cut leaves another sealed cavity. Finishing this configuration requires a separate cavity selection.",
    );
  if (audit.signedVolumeMm3 >= source.audit.signedVolumeMm3)
    throw new Error(
      "The cut did not reduce material volume reliably. Move the plane farther inside the body.",
    );
  let maxEncodingDisplacementMm = 0;
  for (const p of vertices)
    maxEncodingDisplacementMm = Math.max(
      maxEncodingDisplacementMm,
      Math.hypot(...p.map((x) => x - Math.fround(x))),
    );
  return {
    mesh: result,
    audit,
    encodedAudit,
    stats: {
      sourceTriangles: mesh.faces.length,
      resultTriangles: faces.length,
      retainedTriangles,
      clippedTriangles,
      removedTriangles,
      rimTriangles: faces.length - rimStart,
      contours: loops.length,
      openings: depths.filter((d) => d % 2 === 1).length,
      retainedVertexDisplacementMm: 0,
      maxEncodingDisplacementMm,
      geometryMs: performance.now() - start,
      sourceVolumeMm3: source.audit.signedVolumeMm3,
      resultVolumeMm3: audit.signedVolumeMm3,
    },
  };
}

export function validateFinishing(
  source: FinishingSource,
  result: ReturnType<typeof cutHollowBase>,
  minWallMm = 0.8,
  progress: (message: string) => void = () => {},
  manufacturingMesh: StlExportMesh = result.mesh,
) {
  const started = performance.now();
  const verify = (
    mesh: StlExportMesh,
    audit: ReturnType<typeof auditManufacturingMesh>,
    label: string,
  ) => {
    progress(label);
    const surface = manufacturingSurfaceChecks(
      mesh,
      true,
      minWallMm,
      audit.shellSeeds,
    );
    if (
      !surface.selfIntersections.complete ||
      surface.selfIntersections.found ||
      surface.shellOrientationConcerns
    )
      throw new Error(
        `${label}: ${surface.selfIntersections.found ? "self-intersection detected" : surface.shellOrientationConcerns ? "shell orientation/containment concern" : "complete surface validation exceeded its existing budget"}. Apply is blocked; source was retained.`,
      );
    return surface;
  };
  if (!source.surfaceChecked) {
    verify(source.mesh, source.audit, "Validating original material surface");
    source.surfaceChecked = true;
  }
  const surface = verify(result.mesh, result.audit, "Validating cut and rim");
  const encoded = indexManufacturingMesh(manufacturingMesh, true),
    encodedAudit = auditManufacturingMesh(encoded);
  if (
    !encodedAudit.valid ||
    encodedAudit.solidComponents !== source.audit.solidComponents
  )
    throw new Error(
      "The final float32 manufacturing coordinates collapse or disconnect material. Apply is blocked; move the object nearer the origin or choose a different plane.",
    );
  const encodedSurface = verify(
    encoded,
    encodedAudit,
    "Validating float32 manufacturing surface",
  );
  let maxManufacturingEncodingDisplacementMm = 0;
  for (const p of manufacturingMesh.vertices)
    maxManufacturingEncodingDisplacementMm = Math.max(
      maxManufacturingEncodingDisplacementMm,
      Math.hypot(
        p[0] - Math.fround(p[0]),
        p[1] - Math.fround(p[1]),
        p[2] - Math.fround(p[2]),
      ),
    );
  return {
    surface,
    encodedSurface,
    maxManufacturingEncodingDisplacementMm,
    validationMs: performance.now() - started,
  };
}
