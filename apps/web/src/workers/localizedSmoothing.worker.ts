import {
  auditManufacturingMesh,
  indexManufacturingMesh,
} from "@/lib/manufacturingMesh";
import { manufacturingSurfaceChecks } from "@/lib/meshManufacturingQa";
import {
  brushWeight,
  localizedSmooth,
  smoothingTopology,
} from "@/lib/localizedSmoothing";
import type { StlExportMesh } from "@/lib/stlExport";

let mesh: StlExportMesh;
let topology: ReturnType<typeof smoothingTopology>;
let weights: Float64Array;
let grid = new Map<string, number[]>();
let cell = 1;

self.onmessage = ({ data }) => {
  try {
    if (data.type === "init") {
      const vertices: [number, number, number][] = [];
      const faces: [number, number, number][] = [];

      for (let i = 0; i < data.positions.length; i += 3) {
        vertices.push([
          data.positions[i],
          data.positions[i + 1],
          data.positions[i + 2],
        ]);
      }
      for (let i = 0; i < vertices.length; i += 3) {
        faces.push([i, i + 1, i + 2]);
      }

      mesh = indexManufacturingMesh({ vertices, faces });
      const audit = auditManufacturingMesh(mesh);
      if (
        audit.nonManifoldEdges ||
        audit.nonManifoldVertices ||
        audit.degenerateFaces ||
        audit.duplicateFaces ||
        audit.windingMismatches
      ) {
        throw Error("Source has invalid topology. Smooth Mesh does not repair it.");
      }

      const surface = manufacturingSurfaceChecks(mesh, true, 0);
      if (surface.selfIntersections.found || !surface.selfIntersections.complete) {
        throw Error(
          "Source has intersecting or unverified surfaces. Smooth Mesh does not repair it.",
        );
      }

      topology = smoothingTopology(mesh);
      weights = new Float64Array(mesh.vertices.length);
      cell = Math.max(...audit.dimensionsMm) / 64 || 1;
      grid = new Map();
      mesh.vertices.forEach((point, index) => {
        const key = point.map((value) => Math.floor(value / cell)).join(",");
        const list = grid.get(key) ?? [];
        list.push(index);
        grid.set(key, list);
      });
      self.postMessage({ type: "ready", mesh, weights });
    } else if (data.type === "paint") {
      const { point, radius, subtract } = data;
      if (
        !Number.isFinite(radius) ||
        radius <= 0 ||
        point.length !== 3 ||
        point.some((value: number) => !Number.isFinite(value))
      ) {
        throw Error("Invalid brush");
      }

      const min = point.map((value: number) => Math.floor((value - radius) / cell));
      const max = point.map((value: number) => Math.floor((value + radius) / cell));
      const candidates: number[][] = [];
      if (
        (max[0] - min[0] + 1) *
          (max[1] - min[1] + 1) *
          (max[2] - min[2] + 1) >
        grid.size * 4
      ) {
        for (const [key, ids] of grid) {
          const coordinates = key.split(",").map(Number);
          if (
            coordinates.every(
              (value, axis) => value >= min[axis] && value <= max[axis],
            )
          ) {
            candidates.push(ids);
          }
        }
      } else {
        for (let x = min[0]; x <= max[0]; x += 1) {
          for (let y = min[1]; y <= max[1]; y += 1) {
            for (let z = min[2]; z <= max[2]; z += 1) {
              const ids = grid.get(`${x},${y},${z}`);
              if (ids) candidates.push(ids);
            }
          }
        }
      }

      for (const ids of candidates) {
        for (const index of ids) {
          const weight = brushWeight(
            Math.hypot(
              ...mesh.vertices[index].map(
                (value, axis) => value - point[axis],
              ),
            ),
            radius,
          );
          weights[index] = subtract
            ? weights[index] * (1 - weight)
            : Math.max(weights[index], weight);
        }
      }
      self.postMessage({ type: "selection", weights });
    } else if (data.type === "preview") {
      const result = localizedSmooth(
        mesh,
        weights,
        data.strength,
        data.iterations,
        topology,
      );
      if (!result.stats.maxDisplacementMm) {
        throw Error("Paint a movable region first. Open boundary vertices stay fixed.");
      }

      const surface = manufacturingSurfaceChecks(result.mesh, true, 0);
      if (surface.selfIntersections.found || !surface.selfIntersections.complete) {
        throw Error(
          "Preview has intersecting or unverified surfaces; source retained. Reduce the region or smoothing strength.",
        );
      }
      self.postMessage({ type: "preview", ...result });
    } else if (data.type === "clear") {
      weights.fill(0);
      self.postMessage({ type: "selection", weights });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
