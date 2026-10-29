import { Euler, Matrix4, Vector3 } from "three";
import type { WorkplaneShape } from "@/types/layerling";
import {
  resizedImportedMeshPositions,
  meshYawDegrees,
} from "@/lib/workplaneShapes";

export function finishingSourcePositions(shape: WorkplaneShape) {
  return Float64Array.from(resizedImportedMeshPositions(shape));
}

/** Rebase the real bounds and retain the original world transform, including mirrors and tilted bodies. */
export function finishedMeshShape(
  shape: WorkplaneShape,
  input: ArrayLike<number>,
): WorkplaneShape {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < input.length; i++) {
    const a = i % 3;
    min[a] = Math.min(min[a], input[i]);
    max[a] = Math.max(max[a], input[i]);
  }
  const [width, height, depth] = max.map((x, i) => x - min[i]);
  const origin = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const positions = new Array<number>(input.length);
  for (let i = 0; i < input.length; i++)
    positions[i] = input[i] - origin[i % 3];
  const shift = new Vector3(
    origin[0],
    origin[1] + height / 2 - shape.height / 2,
    origin[2],
  );
  shift.multiply(
    new Vector3(
      shape.mirrorX ? -1 : 1,
      shape.mirrorY ? -1 : 1,
      shape.mirrorZ ? -1 : 1,
    ),
  );
  shift.applyMatrix4(
    new Matrix4().makeRotationFromEuler(
      new Euler(
        ((shape.rotationX ?? 0) * Math.PI) / 180,
        (meshYawDegrees(shape) * Math.PI) / 180,
        ((shape.rotationZ ?? 0) * Math.PI) / 180,
        "XYZ",
      ),
    ),
  );
  return {
    ...shape,
    x: shape.x + shift.x,
    z: shape.z + shift.z,
    elevation: (shape.elevation ?? 0) + shape.height / 2 + shift.y - height / 2,
    width,
    depth,
    height,
    radius: width / 2,
    importedMesh: {
      positions,
      baseWidth: width,
      baseHeight: height,
      baseDepth: depth,
      triangleCount: positions.length / 9,
      sourceFormat: "json",
    },
    groupedShapes: undefined,
    groupOperation: undefined,
    edgeTreatments: undefined,
    edgeTreatmentHistory: undefined,
    cadBrep: undefined,
    cadDisplayEdges: undefined,
  };
}
