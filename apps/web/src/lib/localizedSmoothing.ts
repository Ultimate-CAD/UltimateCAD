import type { StlExportMesh } from "@/lib/stlExport";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";

export type SmoothingTopology = {
  neighbors: number[][];
  pinned: Uint8Array;
  faces: StlExportMesh["faces"];
};

/** No welding, reindexing, shell joining, or face insertion. Open boundaries are fixed. */
export function smoothingTopology(mesh: StlExportMesh): SmoothingTopology {
  const neighbors = mesh.vertices.map(() => new Set<number>());
  const pinned = new Uint8Array(mesh.vertices.length);
  const edges = new Map<string, number>();

  for (const face of mesh.faces) {
    if (
      face.length !== 3 ||
      new Set(face).size !== 3 ||
      face.some(
        (index) =>
          !Number.isInteger(index) || index < 0 || index >= neighbors.length,
      )
    ) {
      throw Error("Invalid triangle indices");
    }

    for (let corner = 0; corner < 3; corner += 1) {
      const a = face[corner];
      const b = face[(corner + 1) % 3];
      neighbors[a].add(b);
      neighbors[b].add(a);

      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of edges) {
    if (count > 2) throw Error("Non-manifold mesh cannot be smoothed safely");
    if (count === 1) {
      for (const index of key.split(",").map(Number)) pinned[index] = 1;
    }
  }

  if (
    mesh.vertices.some(
      (point) =>
        point.length !== 3 || point.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw Error("Non-finite mesh coordinates");
  }

  return {
    neighbors: neighbors.map((set) => [...set].sort((a, b) => a - b)),
    pinned,
    faces: mesh.faces,
  };
}

/** C2 spatial falloff; callers combine strokes by max (add) or multiplication (subtract). */
export function brushWeight(distance: number, radius: number) {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw Error("Brush radius must be positive");
  }

  const t = Math.max(0, Math.min(1, 1 - distance / radius));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Constrained Taubin pair. Zero-weight and open-boundary vertices are bit-identical. */
export function localizedSmooth(
  mesh: StlExportMesh,
  weights: ArrayLike<number>,
  strength: number,
  iterations: number,
  topology = smoothingTopology(mesh),
) {
  if (
    weights.length !== mesh.vertices.length ||
    !Number.isFinite(strength) ||
    strength < 0 ||
    strength > 1 ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 100
  ) {
    throw Error("Invalid smoothing settings");
  }

  const active: number[] = [];
  for (let index = 0; index < weights.length; index += 1) {
    if (
      !Number.isFinite(weights[index]) ||
      weights[index] < 0 ||
      weights[index] > 1
    ) {
      throw Error("Invalid selection weight");
    }
    if (
      weights[index] > 0 &&
      !topology.pinned[index] &&
      topology.neighbors[index].length
    ) {
      active.push(index);
    }
  }

  let points = mesh.vertices.map(
    (point) => [...point] as [number, number, number],
  );
  const normal = (
    positions: typeof points,
    face: readonly number[],
  ) => {
    const a = positions[face[0]];
    const b = positions[face[1]];
    const c = positions[face[2]];
    const u = b.map((value, index) => value - a[index]);
    const v = c.map((value, index) => value - a[index]);
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  };

  const selected = new Set(active);
  const affected = mesh.faces.filter((face) =>
    face.some((index) => selected.has(index)),
  );

  for (let step = 0; step < iterations; step += 1) {
    const before = affected.map((face) => normal(points, face));

    for (const factor of [0.5, -0.53]) {
      const next: [number, number, number][] = [];
      for (const index of active) {
        const adjacent = topology.neighbors[index];
        next.push(
          points[index].map(
            (value, axis) =>
              value +
              factor *
                strength *
                weights[index] *
                (adjacent.reduce(
                  (sum, neighbor) => sum + points[neighbor][axis],
                  0,
                ) /
                  adjacent.length -
                  value),
          ) as [number, number, number],
        );
      }
      active.forEach((index, i) => {
        points[index] = next[i];
      });
    }

    for (let index = 0; index < affected.length; index += 1) {
      const a = before[index];
      const b = normal(points, affected[index]);
      const dot = a.reduce((sum, value, axis) => sum + value * b[axis], 0);
      if (!Number.isFinite(dot) || dot <= 0) {
        throw Error(
          "Smoothing would collapse or invert a triangle; reduce strength or iterations",
        );
      }
    }
  }

  const result = { ...mesh, vertices: points };
  const sourceAudit = auditManufacturingMesh(mesh);
  const audit = auditManufacturingMesh(result);
  for (const key of [
    "boundaryEdges",
    "nonManifoldEdges",
    "nonManifoldVertices",
    "windingMismatches",
    "degenerateFaces",
    "duplicateFaces",
    "shells",
  ] as const) {
    if (audit[key] !== sourceAudit[key]) {
      throw Error("Smoothing changed mesh integrity; source retained");
    }
  }

  let maxDisplacementMm = 0;
  let sum = 0;
  for (const index of active) {
    const displacement = Math.hypot(
      ...points[index].map(
        (value, axis) => value - mesh.vertices[index][axis],
      ),
    );
    maxDisplacementMm = Math.max(maxDisplacementMm, displacement);
    sum += displacement * displacement;
  }

  return {
    mesh: result,
    stats: {
      movedVertices: active.length,
      maxDisplacementMm,
      rmsDisplacementMm: Math.sqrt(sum / Math.max(1, active.length)),
      sourceVolumeMm3: sourceAudit.signedVolumeMm3,
      resultVolumeMm3: audit.signedVolumeMm3,
      sourceValid: sourceAudit.valid,
      resultValid: audit.valid,
    },
    audit,
  };
}
