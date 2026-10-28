import { describe, expect, it } from "vitest";
import {
  CAD_FALLBACK_MESH_TRIANGLES,
  CAD_MESH_WORKING_BUDGET_BYTES,
  assertCadMeshBudget,
  cadMeshWorkingBytes,
} from "@/lib/cadMeshBudget";

describe("CAD mesh working-memory budget", () => {
  it("uses the 1 GiB estimate without making ordinary dense meshes ineligible", () => {
    expect(CAD_MESH_WORKING_BUDGET_BYTES).toBe(1024 ** 3);
    expect(CAD_FALLBACK_MESH_TRIANGLES).toBe(4_000);
    for (const triangles of [14_772, 20_000, 50_000, 100_000]) {
      expect(cadMeshWorkingBytes(triangles)).toBe(triangles * 4_096);
      expect(() => assertCadMeshBudget(triangles)).not.toThrow();
    }
    expect(cadMeshWorkingBytes(262_144)).toBe(CAD_MESH_WORKING_BUDGET_BYTES);
    expect(() => assertCadMeshBudget(262_144)).not.toThrow();
  });

  it("rejects a mesh above the isolated-worker memory budget", () => {
    expect(cadMeshWorkingBytes(262_145)).toBeGreaterThan(CAD_MESH_WORKING_BUDGET_BYTES);
    expect(() => assertCadMeshBudget(262_145)).toThrow(/above the 1024 MiB isolated CAD worker budget/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    "rejects invalid triangle count %s",
    (triangles) => {
      expect(() => assertCadMeshBudget(triangles)).toThrow("Invalid mesh topology size");
    },
  );
});
