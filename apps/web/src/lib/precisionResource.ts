import type { WorkplaneShape } from "@/types/layerling";
import { isNonSolidShape } from "@/lib/workplaneShapes";

/** Conservative retained JS mesh estimate, separate from transient meshing/QA memory. */
export function retainedMeshBytes(mesh: {
  vertices: readonly unknown[];
  faces: readonly unknown[];
}) {
  return 1024 + (mesh.vertices.length + mesh.faces.length) * 128;
}
/** Planning estimate, calibrated above the measured ~2.02 GiB / 786k-triangle QA run. */
export function precisionWorkingBytes(triangles: number) {
  return 768 * 1024 ** 2 + Math.ceil(Math.max(0, triangles) * 2200);
}

export class BoundedLruCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  constructor(
    readonly maxBytes: number,
    readonly maxEntries: number,
    private estimate: (value: T) => number,
  ) {}
  get size() {
    return this.entries.size;
  }
  get retainedBytes() {
    return this.bytes;
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T) {
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key);
      this.bytes -= old.bytes;
    }
    const bytes = key.length * 2 + this.estimate(value);
    if (bytes > this.maxBytes) return false;
    while (
      this.entries.size &&
      (this.entries.size >= this.maxEntries ||
        this.bytes + bytes > this.maxBytes)
    ) {
      const key = this.entries.keys().next().value!,
        entry = this.entries.get(key)!;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    return true;
  }
}

/** Reject known oversized triangle soups before cloning, JSON keys or mesh construction. */
export function assertKnownPrecisionSourceBudget(
  shapes: readonly WorkplaneShape[],
  budget: number,
) {
  let triangles = 0;
  for (const shape of shapes) {
    if (
      !shape.hidden &&
      !isNonSolidShape(shape) &&
      shape.kind === "mesh" &&
      !shape.importedMesh &&
      !shape.cadBrep &&
      !shape.groupedShapes?.length
    )
      throw new Error(
        `Imported mesh ${shape.name} is missing geometry; export will not invent a replacement body`,
      );
    if (
      shape.hidden ||
      isNonSolidShape(shape) ||
      shape.kind !== "mesh" ||
      !shape.importedMesh ||
      shape.cadBrep ||
      shape.importedMesh.brepStep ||
      shape.groupedShapes?.length
    )
      continue;
    const count = shape.importedMesh.positions.length;
    if (count < 9)
      throw new Error(
        `Imported mesh ${shape.name} has no complete triangles; export will not invent replacement geometry`,
      );
    if (count % 9)
      throw new Error(
        `Imported mesh ${shape.name} has an incomplete triangle list`,
      );
    triangles += count / 9;
    if (triangles > budget)
      throw new Error(
        `Combined source/cutter geometry exceeds the selected ${budget.toLocaleString()} triangle working budget before export preparation`,
      );
  }
}
