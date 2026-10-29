import type { StlExportMesh } from "@/lib/stlExport";
import { withGeometryTiming } from "@/lib/geometryTiming";

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
  return withGeometryTiming("mesh.index", () => indexMesh(mesh, float32));
}
function indexMesh(mesh: StlExportMesh, float32: boolean) {
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
    if (!point.every(Number.isFinite))
      throw new Error(
        "Mesh coordinates exceed the encoding's finite coordinate range",
      );
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
  return withGeometryTiming("mesh.topology", () => auditMesh(mesh, float32));
}
function auditMesh(mesh: StlExportMesh, float32: boolean): ManufacturingAudit {
  return auditIndexedMesh(indexManufacturingMesh(mesh, float32));
}
/** For an owned canonical mesh just returned by indexManufacturingMesh.
 * No implicit global caching or assumption about arbitrary caller-owned arrays.
 */
export function auditIndexedManufacturingMesh(
  mesh: StlExportMesh,
): ManufacturingAudit {
  return withGeometryTiming("mesh.topology", () => auditIndexedMesh(mesh));
}
function auditIndexedMesh({
  vertices,
  faces,
}: StlExportMesh): ManufacturingAudit {
  type Edge = {
    a: number;
    b: number;
    first: number;
    second: number;
    extra: number[] | undefined;
    count: number;
    direction: number;
  };
  const edges = new Map<number | string, Edge>();
  const numericEdges =
    vertices.length <= Math.floor(Math.sqrt(Number.MAX_SAFE_INTEGER));
  const seen = new Set<string>();
  // Each unique face corner is a node in the incident-vertex fan. Join it only
  // across an actual shared edge, exactly as the former per-vertex graph did.
  if (faces.length > Math.floor(0xffffffff / 3))
    throw new Error("Mesh exceeds topology index capacity");
  const cornerParent = new Uint32Array(faces.length * 3);
  for (let i = 0; i < cornerParent.length; i++) cornerParent[i] = i;
  const cornerRoot = (n: number): number => {
    while (cornerParent[n] !== n) {
      cornerParent[n] = cornerParent[cornerParent[n]];
      n = cornerParent[n];
    }
    return n;
  };
  const joinCorner = (a: number, b: number) => {
    cornerParent[cornerRoot(a)] = cornerRoot(b);
  };
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
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const twiceArea = Math.hypot(
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    );
    if (twiceArea < 2e-8) smallFaces++;
    faceAreas.push(twiceArea);
    if (twiceArea === 0) degenerateFaces++;
    let first = ai,
      middle = bi,
      last = ci;
    if (first > middle) [first, middle] = [middle, first];
    if (middle > last) [middle, last] = [last, middle];
    if (first > middle) [first, middle] = [middle, first];
    const key = `${first}:${middle}:${last}`;
    if (seen.has(key)) duplicateFaces++;
    seen.add(key);
    // Count degenerate faces in the topology too: they must never masquerade as a valid cap.
    live.push(i);
    for (const [a, b] of [
      [ai, bi],
      [bi, ci],
      [ci, ai],
    ]) {
      const low = Math.min(a, b),
        high = Math.max(a, b);
      const key = numericEdges
        ? low * vertices.length + high
        : `${low}:${high}`;
      let edge = edges.get(key);
      if (!edge) {
        edge = {
          a: low,
          b: high,
          first: i,
          second: -1,
          extra: undefined,
          count: 0,
          direction: 0,
        };
        edges.set(key, edge);
      } else if (edge.second === -1) edge.second = i;
      else {
        edge.extra ??= [];
        edge.extra.push(i);
      }
      edge.count++;
      edge.direction += a < b ? 1 : -1;
    }
  });
  let boundaryEdges = 0,
    nonManifoldEdges = 0,
    windingMismatches = 0;
  const joinEdge = (edge: Edge, current: number) => {
    const first = edge.first;
    join(first, current);
    joinCorner(
      first * 3 + faces[first].indexOf(edge.a),
      current * 3 + faces[current].indexOf(edge.a),
    );
    joinCorner(
      first * 3 + faces[first].indexOf(edge.b),
      current * 3 + faces[current].indexOf(edge.b),
    );
  };
  for (const edge of edges.values()) {
    if (edge.count === 1) boundaryEdges++;
    if (edge.count > 2) nonManifoldEdges++;
    if (edge.count === 2 && edge.direction !== 0) windingMismatches++;
    if (edge.second !== -1) joinEdge(edge, edge.second);
    if (edge.extra) for (const face of edge.extra) joinEdge(edge, face);
  }
  let nonManifoldVertices = 0;
  const firstFan = new Float64Array(vertices.length);
  firstFan.fill(-1);
  const multipleFans = new Uint8Array(vertices.length);
  faces.forEach((face, i) => {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = face[corner];
      if (
        (corner > 0 && vertex === face[0]) ||
        (corner === 2 && vertex === face[1])
      )
        continue;
      const root = cornerRoot(i * 3 + corner);
      if (firstFan[vertex] === -1) firstFan[vertex] = root;
      else if (firstFan[vertex] !== root && !multipleFans[vertex]) {
        multipleFans[vertex] = 1;
        nonManifoldVertices++;
      }
    }
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
  // Integrate each connected shell around its own origin. World-coordinate
  // determinants lose small solid volumes when an object is far from (0,0,0).
  const shellOrigins = new Map<number, readonly number[]>();
  faces.forEach((face, i) => {
    const r = root(i);
    let origin = shellOrigins.get(r);
    if (!origin) {
      origin = vertices[face[0]];
      shellOrigins.set(r, origin);
    }
    const a = vertices[face[0]],
      b = vertices[face[1]],
      c = vertices[face[2]];
    const ax = a[0] - origin[0],
      ay = a[1] - origin[1],
      az = a[2] - origin[2],
      bx = b[0] - origin[0],
      by = b[1] - origin[1],
      bz = b[2] - origin[2],
      cx = c[0] - origin[0],
      cy = c[1] - origin[1],
      cz = c[2] - origin[2];
    const volume =
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
    faceVolumes.push(volume);
    signedVolumeMm3 += volume;
  });
  const valid =
    faces.length > 0 &&
    !boundaryEdges &&
    !nonManifoldEdges &&
    !nonManifoldVertices &&
    !windingMismatches &&
    !degenerateFaces &&
    !duplicateFaces &&
    Number.isFinite(signedVolumeMm3) &&
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
