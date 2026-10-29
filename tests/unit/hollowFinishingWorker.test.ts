import { it, expect, vi } from "vitest";
import manifoldModule from "manifold-3d";

vi.mock("@/lib/editorMeshCore", () => ({
  getManifoldRuntime: async () => {
    const runtime = await manifoldModule();
    runtime.setup();
    return runtime;
  },
  setManifoldAssetBase: () => {},
}));

it("isolates source, caches a validated cut, and echoes revisions on failures", async () => {
  const messages: any[] = [];
  const worker = {
    onmessage: null as any,
    postMessage: (m: any) => messages.push(m),
  };
  vi.stubGlobal("self", worker);
  try {
    await import("@/workers/hollowFinishing.worker");
    // Closed box with a closed negative inner box.
    const runtime = await manifoldModule();
    runtime.setup();
    const a = runtime.Manifold.cube([20, 20, 20]),
      b = runtime.Manifold.cube([16, 16, 16]).translate([2, 2, 2]);
    const solid = a.subtract(b),
      mesh = solid.getMesh();
    const positions = Float64Array.from(
      Array.from(mesh.triVerts).flatMap((i) =>
        Array.from(mesh.vertProperties.subarray(i * 3, i * 3 + 3)),
      ),
    );
    solid.delete();
    a.delete();
    b.delete();
    const original = positions.slice();
    await worker.onmessage({
      data: {
        type: "init",
        assetBase: "http://localhost/",
        revision: 1,
        positions,
      },
    });
    expect(messages.at(-1)).toMatchObject({ type: "ready", revision: 1 });
    const cut = { axis: 1, position: 3.1, keepPositive: true };
    await worker.onmessage({ data: { type: "preview", revision: 2, cut } });
    expect(messages.at(-1)).toMatchObject({
      type: "preview",
      revision: 2,
      stats: { cacheHit: false },
      surface: { selfIntersections: { complete: true, found: 0 } },
    });
    const result = messages.at(-1).positions.slice();
    await worker.onmessage({ data: { type: "preview", revision: 3, cut } });
    expect(messages.at(-1)).toMatchObject({
      type: "preview",
      revision: 3,
      stats: { cacheHit: true },
    });
    expect(messages.at(-1).positions).toEqual(result);
    await worker.onmessage({
      data: { type: "preview", revision: 4, cut: { ...cut, position: 1 } },
    });
    expect(messages.at(-1)).toMatchObject({ type: "error", revision: 4 });
    expect(positions).toEqual(original);
  } finally {
    vi.unstubAllGlobals();
  }
});
