import { STL_QUALITY_PRESETS } from "@/lib/stlQuality";
import type { StlExportMesh } from "@/lib/stlExport";
import { indexManufacturingMesh } from "@/lib/manufacturingMesh";

export type PrecisionSettings = {
  preset: "standard" | "high" | "ultra" | "custom";
  deviationMm: number;
  angleDeg: number;
  maxEdgeMm: number;
  aspectTarget: number;
  smoothing: number;
  sharpAngleDeg: number;
  repair: boolean;
  repairDeviationMm: number;
  triangleBudget: number;
  minWallMm: number;
  selfIntersections: boolean;
};
export const PRECISION_PRESETS = {
  standard: { ...STL_QUALITY_PRESETS.standard, maxEdgeMm: 0, aspectTarget: 10 },
  high: { ...STL_QUALITY_PRESETS.high, maxEdgeMm: 0, aspectTarget: 8 },
  ultra: { ...STL_QUALITY_PRESETS.ultra, maxEdgeMm: 0, aspectTarget: 6 },
};
export const DEFAULT_PRECISION: PrecisionSettings = {
  preset: "high",
  ...PRECISION_PRESETS.high,
  smoothing: 0,
  sharpAngleDeg: 40,
  repair: false,
  repairDeviationMm: 0.0001,
  triangleBudget: 4_000_000,
  minWallMm: 0.8,
  selfIntersections: true,
};
export function validatePrecisionSettings(s: PrecisionSettings) {
  for (const [key, min, max] of [
    ["deviationMm", 0.00001, 10],
    ["angleDeg", 0.1, 90],
    ["maxEdgeMm", 0, 10000],
    ["aspectTarget", 1, 1000],
    ["smoothing", 0, 0.5],
    ["sharpAngleDeg", 1, 179],
    ["repairDeviationMm", 0.000001, 0.1],
    ["triangleBudget", 1000, 12_000_000],
    ["minWallMm", 0, 100],
  ] as const) {
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max)
      throw new Error(`${key} must be between ${min} and ${max}`);
  }
}
type Point = [number, number, number];
type Face = [number, number, number];
const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
/** Collapse only numerically zero-length tessellation edges, not nearby unrelated features. */
export function stitchAnalyticNumericalEdges(
  input: StlExportMesh,
  epsilonMm: number,
) {
  const { vertices, faces } = indexManufacturingMesh(input),
    parent = vertices.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const f of faces)
    for (const [a, b] of [
      [f[0], f[1]],
      [f[1], f[2]],
      [f[2], f[0]],
    ])
      if (
        Math.hypot(...vertices[a].map((v, j) => v - vertices[b][j])) <=
        epsilonMm
      )
        parent[root(b)] = root(a);
  let movedMm = 0,
    removedFacets = 0;
  const out: [number, number, number][] = [];
  vertices.forEach((v, i) => {
    movedMm = Math.max(
      movedMm,
      Math.hypot(...v.map((x, j) => x - vertices[root(i)][j])),
    );
  });
  for (const f of faces) {
    const ids = f.map(root) as [number, number, number];
    if (new Set(ids).size < 3) {
      removedFacets++;
      continue;
    }
    out.push(ids);
  }
  if (movedMm > epsilonMm * 2)
    throw new Error(
      "Numerical tessellation stitching exceeded its positional bound",
    );
  return { mesh: { vertices, faces: out }, movedMm, removedFacets };
}
export function meshTriangleMetrics(mesh: StlExportMesh) {
  let maxEdgeMm = 0,
    maxAspectRatio = 0;
  for (const face of mesh.faces) {
    const [a, b, c] = face.map((i) => mesh.vertices[i]),
      u = b.map((v, j) => v - a[j]),
      v = c.map((v, j) => v - a[j]);
    const lengths = [
        [a, b],
        [b, c],
        [c, a],
      ].map(([a, b]) => Math.hypot(...a.map((x, j) => x - b[j]))),
      area2 = Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      );
    const longest = Math.max(...lengths);
    maxEdgeMm = Math.max(maxEdgeMm, longest);
    maxAspectRatio = Math.max(
      maxAspectRatio,
      area2 ? (longest * longest) / area2 : Infinity,
    );
  }
  return { maxEdgeMm, maxAspectRatio };
}
/** Conforming edge subdivision: geometry is unchanged; it adds no lost source fidelity. */
export function subdivideManufacturingMesh(
  input: StlExportMesh,
  maxEdgeMm: number,
  triangleBudget: number,
) {
  if (!maxEdgeMm) return input;
  let { vertices, faces } = indexManufacturingMesh(input);
  for (let pass = 0; pass < 30; pass++) {
    const mids = new Map<string, number>();
    for (const face of faces)
      for (const [a, b] of [
        [face[0], face[1]],
        [face[1], face[2]],
        [face[2], face[0]],
      ]) {
        const key = edgeKey(a, b);
        if (mids.has(key)) continue;
        if (
          Math.hypot(...vertices[a].map((v, j) => v - vertices[b][j])) >
          maxEdgeMm * (1 + 1e-10)
        ) {
          mids.set(key, vertices.length);
          vertices.push(
            vertices[a].map((v, j) => (v + vertices[b][j]) / 2) as Point,
          );
        }
      }
    if (!mids.size) return { vertices, faces };
    const next: Face[] = [];
    const add = (...triangles: Face[]) => {
      if (next.length + triangles.length > triangleBudget)
        throw new Error(
          `Refinement exceeds the selected ${triangleBudget.toLocaleString()} triangle resource budget; increase it or the maximum edge length`,
        );
      next.push(...triangles);
    };
    for (const [a, b, c] of faces) {
      const ab = mids.get(edgeKey(a, b)),
        bc = mids.get(edgeKey(b, c)),
        ca = mids.get(edgeKey(c, a));
      const mask =
        (ab === undefined ? 0 : 1) |
        (bc === undefined ? 0 : 2) |
        (ca === undefined ? 0 : 4);
      switch (mask) {
        case 0:
          add([a, b, c]);
          break;
        case 1:
          add([a, ab!, c], [ab!, b, c]);
          break;
        case 2:
          add([b, bc!, a], [bc!, c, a]);
          break;
        case 4:
          add([c, ca!, b], [ca!, a, b]);
          break;
        case 3:
          add([b, bc!, ab!], [a, ab!, c], [ab!, bc!, c]);
          break;
        case 5:
          add([a, ab!, ca!], [ab!, b, c], [ab!, c, ca!]);
          break;
        case 6:
          add([c, ca!, bc!], [a, b, ca!], [b, bc!, ca!]);
          break;
        case 7:
          add([a, ab!, ca!], [ab!, b, bc!], [ca!, bc!, c], [ab!, bc!, ca!]);
          break;
      }
    }
    faces = next;
  }
  throw new Error("Edge refinement did not converge");
}

/** Only flips coplanar internal diagonals. Sharp features and the represented surface stay fixed. */
export function improvePlanarAspect(input: StlExportMesh, target: number) {
  const { vertices, faces } = indexManufacturingMesh(input),
    edges = new Map<string, number[]>();
  faces.forEach((f, i) => {
    for (const [a, b] of [
      [f[0], f[1]],
      [f[1], f[2]],
      [f[2], f[0]],
    ]) {
      const k = edgeKey(a, b),
        e = edges.get(k) ?? [];
      e.push(i);
      edges.set(k, e);
    }
  });
  const touched = new Set<number>();
  let flips = 0;
  const score = (f: Face) =>
    meshTriangleMetrics({ vertices, faces: [f] }).maxAspectRatio;
  const normal = (f: Face) => {
    const [a, b, c] = f.map((i) => vertices[i]),
      u = b.map((v, j) => v - a[j]),
      v = c.map((v, j) => v - a[j]);
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  };
  for (const [k, list] of edges) {
    if (list.length !== 2 || list.some((i) => touched.has(i))) continue;
    const [i, j] = list,
      [a, b] = k.split(":").map(Number),
      c = faces[i].find((v) => v !== a && v !== b)!,
      d = faces[j].find((v) => v !== a && v !== b)!;
    if (
      c === undefined ||
      d === undefined ||
      c === d ||
      edges.has(edgeKey(c, d))
    )
      continue;
    const before = Math.max(score(faces[i]), score(faces[j]));
    if (before <= target) continue;
    const n = normal(faces[i]),
      l = Math.hypot(...n);
    if (
      !l ||
      Math.abs(
        n.reduce((s, v, k) => s + v * (vertices[d][k] - vertices[a][k]), 0),
      ) /
        l >
        1e-10
    )
      continue;
    let f: Face = [c, d, a],
      g: Face = [d, c, b];
    if (normal(f).reduce((s, v, k) => s + v * n[k], 0) < 0) {
      f = [d, c, a];
      g = [c, d, b];
    }
    if (normal(g).reduce((s, v, k) => s + v * n[k], 0) <= 0) continue;
    if (Math.max(score(f), score(g)) >= before) continue;
    faces[i] = f;
    faces[j] = g;
    touched.add(i);
    touched.add(j);
    flips++;
  }
  return { mesh: { vertices, faces }, flips };
}
