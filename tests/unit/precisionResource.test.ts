import { describe, it, expect } from "vitest";
import {
  BoundedLruCache,
  assertKnownPrecisionSourceBudget,
} from "@/lib/precisionResource";
import type { WorkplaneShape } from "@/types/layerling";

describe("precision resource preflight and retained caches", () => {
  it("evicts by byte budget with hit promotion and does not retain oversized entries", () => {
    const cache = new BoundedLruCache<{ bytes: number }>(
      80,
      12,
      (v) => v.bytes,
    );
    cache.set("a", { bytes: 30 });
    cache.set("b", { bytes: 30 });
    expect(cache.get("a")).toEqual({ bytes: 30 });
    cache.set("c", { bytes: 30 });
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
    expect(cache.retainedBytes).toBeLessThanOrEqual(80);
    expect(cache.set("oversized", { bytes: 100 })).toBe(false);
    expect(cache.retainedBytes).toBeLessThanOrEqual(80);
    expect(cache.size).toBe(2);
  });
  it("bounds retention across repeated distinct large results", () => {
    const cache = new BoundedLruCache<Uint8Array>(
      4 * 1024 ** 2,
      12,
      (v) => v.byteLength,
    );
    for (let i = 0; i < 40; i++) {
      cache.set(String(i), new Uint8Array(1024 ** 2));
      expect(cache.retainedBytes).toBeLessThanOrEqual(4 * 1024 ** 2);
    }
    expect(cache.size).toBe(3);
    expect(cache.get("0")).toBeUndefined();
    expect(cache.get("39")).toBeDefined();
  });
  it("rejects oversized, incomplete and empty imported sources without inventing fallback solids", () => {
    const shape = (positions: number[], patch: Partial<WorkplaneShape> = {}) =>
      ({
        id: "raw",
        name: "Raw",
        kind: "mesh",
        color: "#0098c7",
        x: 0,
        z: 0,
        size: 1,
        width: 1,
        depth: 1,
        height: 1,
        rotation: 0,
        importedMesh: {
          positions,
          baseWidth: 1,
          baseDepth: 1,
          baseHeight: 1,
          triangleCount: positions.length / 9,
          sourceFormat: "obj",
        },
        ...patch,
      }) as WorkplaneShape;
    expect(() =>
      assertKnownPrecisionSourceBudget([shape(new Array(9009).fill(0))], 1000),
    ).toThrow(/before export preparation/);
    expect(() => assertKnownPrecisionSourceBudget([shape([])], 1000)).toThrow(
      /no complete triangles/,
    );
    expect(() =>
      assertKnownPrecisionSourceBudget(
        [shape([], { importedMesh: undefined })],
        1000,
      ),
    ).toThrow(/missing geometry/);
    expect(() =>
      assertKnownPrecisionSourceBudget([shape(new Array(10).fill(0))], 1000),
    ).toThrow(/incomplete/);
    const missing = shape([], { importedMesh: undefined });
    const group = shape([], {
      id: "group",
      importedMesh: undefined,
      groupedShapes: [missing],
    });
    expect(() => assertKnownPrecisionSourceBudget([group], 1000)).toThrow(
      /missing geometry/,
    );
    expect(() =>
      assertKnownPrecisionSourceBudget(
        [
          {
            ...group,
            importedMesh: shape(new Array(9).fill(0)).importedMesh,
          },
        ],
        1000,
      ),
    ).not.toThrow();
    expect(() =>
      assertKnownPrecisionSourceBudget(
        [
          {
            ...group,
            importedMesh: shape(new Array(9009).fill(0)).importedMesh,
          },
        ],
        1000,
      ),
    ).toThrow(/before export preparation/);
    expect(() =>
      assertKnownPrecisionSourceBudget(
        [shape(new Array(9009).fill(0), { hidden: true })],
        1000,
      ),
    ).not.toThrow();
  });
});
