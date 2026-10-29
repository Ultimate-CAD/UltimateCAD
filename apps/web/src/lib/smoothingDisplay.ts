import { Box3, BufferAttribute, BufferGeometry } from "three";
import { MeshBVH, type SerializedBVH } from "three-mesh-bvh";
import type { StlExportMesh } from "@/lib/stlExport";

export type SmoothingDisplay = {
  position: Float32Array;
  normal: Float32Array;
  bvh: SerializedBVH;
  bounds: number[];
};

export function packSmoothingPositions(mesh: StlExportMesh) {
  const positions = new Float64Array(mesh.vertices.length * 3);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const p = mesh.vertices[i];
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  }
  return positions;
}

/** Worker-owned display cache. Exact source coordinates and face ordering are untouched. */
export class SmoothingDisplayCache {
  readonly geometry = new BufferGeometry();
  readonly tree: MeshBVH;
  private readonly faces: StlExportMesh["faces"];

  constructor(mesh: StlExportMesh) {
    this.faces = mesh.faces;
    const position = new Float32Array(mesh.vertices.length * 3);
    mesh.vertices.forEach((p, i) => position.set(p, i * 3));
    const index = new Uint32Array(mesh.faces.length * 3);
    mesh.faces.forEach((f, i) => index.set(f, i * 3));
    this.geometry.setAttribute("position", new BufferAttribute(position, 3));
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.tree = new MeshBVH(this.geometry, { indirect: true });
  }

  update(mesh: StlExportMesh) {
    const attribute = this.geometry.getAttribute("position");
    if (attribute.count !== mesh.vertices.length || mesh.faces !== this.faces) {
      throw Error("Smoothing display topology changed");
    }

    mesh.vertices.forEach((p, i) => attribute.setXYZ(i, p[0], p[1], p[2]));
    this.geometry.computeVertexNormals();
    this.tree.refit();
    this.geometry.computeBoundingBox();
  }

  snapshot() {
    const bvh = MeshBVH.serialize(this.tree, { cloneBuffers: true });
    const position = (this.geometry.getAttribute("position").array as Float32Array).slice();
    const normal = (this.geometry.getAttribute("normal").array as Float32Array).slice();
    const box = this.geometry.boundingBox ?? this.tree.getBoundingBox(new Box3());
    const display: SmoothingDisplay = {
      position,
      normal,
      bvh,
      bounds: [...box.min.toArray(), ...box.max.toArray()],
    };
    const transfer = [
      position.buffer,
      normal.buffer,
      ...bvh.roots,
      bvh.index?.buffer,
      bvh.indirectBuffer?.buffer,
    ].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
    return { display, transfer: [...new Set(transfer)] };
  }

  dispose() {
    this.geometry.dispose();
  }
}

/** Display-only updates; Float64 algorithm weights remain in the worker. */
export function updateSmoothingColors(
  attribute: BufferAttribute,
  indices: ArrayLike<number>,
  weights: ArrayLike<number>,
) {
  if (indices.length !== weights.length) {
    throw Error("Invalid selection delta");
  }

  const array = attribute.array as Float32Array;
  let min = attribute.count;
  let max = -1;

  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const weight = weights[k];
    if (
      !Number.isInteger(i) ||
      i < 0 ||
      i >= attribute.count ||
      !Number.isFinite(weight)
    ) {
      throw Error("Invalid selection delta");
    }

    array[i * 3] = .1 + .9 * weight;
    array[i * 3 + 1] = .65 - .25 * weight;
    array[i * 3 + 2] = .85 - .75 * weight;
    min = Math.min(min, i);
    max = Math.max(max, i);
  }

  if (max >= min) {
    attribute.addUpdateRange(min * 3, (max - min + 1) * 3);
    attribute.needsUpdate = true;
  }
}
