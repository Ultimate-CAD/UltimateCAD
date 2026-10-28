import type { StlExportMesh } from "@/lib/stlExport";

export type ManufacturingAudit = {
  triangles: number;
  vertices: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  nonManifoldVertices: number;
  windingMismatches: number;
  degenerateFaces: number;
  smallFaces: number;
  duplicateFaces: number;
  shells: number;
  signedVolumeMm3: number;
  dimensionsMm: number[];
  solidComponents: number;
  cavityShells: number;
  shellSeeds: { position: number[]; normal: number[] }[];
  valid: boolean;
  units: "mm";
};

/** Exact coordinate welding, deliberately without a rounding grid that can merge real features. */
export function indexManufacturingMesh(mesh: StlExportMesh, float32 = false) {
  const vertices: [number, number, number][] = [],
    ids = new Map<string, number>();
  const remap = mesh.vertices.map((p) => {
    if (!p.every(Number.isFinite))
      throw new Error("Mesh contains non-finite coordinates");
    const point = p.map((v) => (float32 ? Math.fround(v) : v)) as [
      number,
      number,
      number,
    ];
    const key = point.join(",");
    let id = ids.get(key);
    if (id === undefined) {
      id = vertices.length;
      ids.set(key, id);
      vertices.push(point);
    }
    return id;
  });
  const faces = mesh.faces.map(
    (face) =>
      face.map((i) => {
        if (!Number.isInteger(i) || i < 0 || i >= remap.length)
          throw new Error("Mesh contains an invalid vertex index");
        return remap[i];
      }) as [number, number, number],
  );
  return { vertices, faces };
}

export function auditManufacturingMesh(
  mesh: StlExportMesh,
  float32 = false,
): ManufacturingAudit {
  const { vertices, faces } = indexManufacturingMesh(mesh, float32);
  const edges = new Map<string, { faces: number[]; direction: number }>();
  const seen = new Set<string>(),
    incident: number[][] = Array.from({ length: vertices.length }, () => []);
  const parent = faces.map((_, i) => i);
  const root = (n: number): number => {
    while (parent[n] !== n) {
      parent[n] = parent[parent[n]];
      n = parent[n];
    }
    return n;
  };
  const join = (a: number, b: number) => {
    parent[root(a)] = root(b);
  };
  let degenerateFaces = 0,
    smallFaces = 0,
    duplicateFaces = 0,
    signedVolumeMm3 = 0;
  const faceVolumes: number[] = [];
  const faceAreas: number[] = [];
  const live: number[] = [];
  faces.forEach(([ai, bi, ci], i) => {
    const [a, b, c] = [vertices[ai], vertices[bi], vertices[ci]];
    const u = b.map((v, j) => v - a[j]),
      v = c.map((v, j) => v - a[j]);
    const twiceArea = Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    );
    if (twiceArea < 2e-8) smallFaces++;
    faceAreas.push(twiceArea);
    if (twiceArea === 0) degenerateFaces++;
    const key = [ai, bi, ci].sort((a, b) => a - b).join(":");
    if (seen.has(key)) duplicateFaces++;
    seen.add(key);
    // Count degenerate faces in the topology too: they must never masquerade as a valid cap.
    for (const vertex of new Set([ai, bi, ci])) incident[vertex].push(i);
    live.push(i);
    const volume =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    signedVolumeMm3 += volume;
    faceVolumes.push(volume);
    for (const [a, b] of [
      [ai, bi],
      [bi, ci],
      [ci, ai],
    ]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { faces: [], direction: 0 };
      edge.faces.push(i);
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  });
  let boundaryEdges = 0,
    nonManifoldEdges = 0,
    windingMismatches = 0;
  const links: [number, number][][] = Array.from(
    { length: vertices.length },
    () => [],
  );
  for (const [key, edge] of edges) {
    if (edge.faces.length === 1) boundaryEdges++;
    if (edge.faces.length > 2) nonManifoldEdges++;
    if (edge.faces.length === 2 && edge.direction !== 0) windingMismatches++;
    for (let i = 1; i < edge.faces.length; i++) {
      join(edge.faces[0], edge.faces[i]);
      for (const v of key.split(":").map(Number))
        links[v].push([edge.faces[0], edge.faces[i]]);
    }
  }
  let nonManifoldVertices = 0;
  incident.forEach((faces, vertex) => {
    if (!faces.length) return;
    const adjacency = new Map(faces.map((f) => [f, [] as number[]]));
    for (const [a, b] of links[vertex]) {
      adjacency.get(a)!.push(b);
      adjacency.get(b)!.push(a);
    }
    const visited = new Set<number>(),
      pending = [faces[0]];
    while (pending.length) {
      const f = pending.pop()!;
      if (visited.has(f)) continue;
      visited.add(f);
      pending.push(...adjacency.get(f)!);
    }
    if (visited.size !== faces.length) nonManifoldVertices++;
  });
  const dimensionsMm = [0, 1, 2].map((axis) => {
    let min = Infinity,
      max = -Infinity;
    for (const v of vertices) {
      min = Math.min(min, v[axis]);
      max = Math.max(max, v[axis]);
    }
    return max - min;
  });
  const valid =
    faces.length > 0 &&
    !boundaryEdges &&
    !nonManifoldEdges &&
    !nonManifoldVertices &&
    !windingMismatches &&
    !degenerateFaces &&
    !duplicateFaces &&
    signedVolumeMm3 > 0 &&
    dimensionsMm.every((v) => Number.isFinite(v) && v > 0);
  const shellVolumes = new Map<number, number>();
  faceVolumes.forEach((v, i) => {
    const r = root(i);
    shellVolumes.set(r, (shellVolumes.get(r) ?? 0) + v);
  });
  const seedFaces = new Map<number, number>();
  faces.forEach((_, i) => {
    const r = root(i),
      previous = seedFaces.get(r);
    if (previous === undefined || faceAreas[i] > faceAreas[previous])
      seedFaces.set(r, i);
  });
  const shellSeeds = [...seedFaces.values()].map((i) => {
    const [a, b, c] = faces[i].map((j) => vertices[j]),
      u = b.map((v, j) => v - a[j]),
      v = c.map((v, j) => v - a[j]);
    const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      length = Math.hypot(...n) || 1;
    return {
      position: a.map((v, j) => (v + b[j] + c[j]) / 3),
      normal: n.map((v) => v / length),
    };
  });
  return {
    triangles: faces.length,
    vertices: vertices.length,
    boundaryEdges,
    nonManifoldEdges,
    nonManifoldVertices,
    windingMismatches,
    degenerateFaces,
    smallFaces,
    duplicateFaces,
    shells: new Set(live.map(root)).size,
    signedVolumeMm3,
    dimensionsMm,
    solidComponents: [...shellVolumes.values()].filter((v) => v > 0).length,
    cavityShells: [...shellVolumes.values()].filter((v) => v < 0).length,
    shellSeeds,
    valid,
    units: "mm",
  };
}
