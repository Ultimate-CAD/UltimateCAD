import type { OcctKernel, ShapeHandle } from "occt-wasm";

/** Per-worker, bounded exact geometry. No native handles survive releaseAll(). */
export class FeatureSolidCache {
  private readonly entries = new Map<string, Uint8Array>();
  private bytes = 0;
  constructor(private readonly budget = 32 * 1024 * 1024) {}

  run(kernel: OcctKernel, key: string, build: () => ShapeHandle): ShapeHandle {
    const cached = this.entries.get(key);
    if (cached) {
      const shape = kernel.fromBREPBinary(cached);
      this.entries.delete(key);
      this.entries.set(key,cached);
      return shape;
    }
    const shape = build();
    const data = kernel.toBREPBinary(shape);
    const cost = data.byteLength + key.length * 2;
    if (cost > this.budget) return shape;
    while (this.bytes + cost > this.budget) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[0].length * 2 + oldest[1].byteLength;
    }
    this.entries.set(key,new Uint8Array(data));
    this.bytes += cost;
    return shape;
  }
}
