import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeshHollowInput, MeshHollowResult } from "@/lib/meshHollow";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: Array<{ message: Record<string, unknown>; transfer: Transferable[] }> = [];
  terminated = false;

  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: Record<string, unknown>, transfer: Transferable[] = []) { this.posted.push({ message, transfer }); }
  terminate() { this.terminated = true; }
  send(data: unknown) { this.onmessage?.({ data }); }
}

const input: MeshHollowInput = {
  positions: new Float32Array([0, 1, 2, 3, 4, 5]),
  indices: new Uint16Array([0, 1, 2]),
  thickness: 1.2,
  openings: "bottom",
  options: { direction: "inward", maxErrorMm: 0.1 },
};
const result: MeshHollowResult = {
  positions: [1, 2, 3],
  indices: [0, 1, 2],
  stats: {
    method: "mesh-sdf", cellSizeMm: 0.1, maxErrorMm: 0.1, measuredErrorMm: 0.03,
    sourceTriangles: 1, resultTriangles: 1, sourceVolumeMm3: 2, resultVolumeMm3: 1,
    cavityVolumeMm3: 1, evaluations: 10, durationMs: 5, omittedCavities: 0,
  },
};

async function load(build = "") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BUILD_ID", build);
  return import("@/lib/meshHollowWorker");
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", {
    location: { href: "http://localhost/editor/" },
    setTimeout: (callback: TimerHandler, delay?: number) => globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (timer: number) => globalThis.clearTimeout(timer),
    dispatchEvent: vi.fn(() => true),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mesh hollow worker wrapper", () => {
  it("copies and transfers typed arrays, forwards progress, and returns arrays", async () => {
    const { hollowMeshOffThread } = await load();
    const sourcePositions = input.positions as Float32Array;
    const sourceIndices = input.indices as Uint16Array;
    const progress = vi.fn();
    const pending = hollowMeshOffThread(input, undefined, progress);
    const worker = FakeWorker.instances[0];
    const { message, transfer } = worker.posted[0];
    const sentPositions = message.positions as Float64Array;
    const sentIndices = message.indices as Uint32Array;
    expect(sentPositions).toBeInstanceOf(Float64Array);
    expect(sentIndices).toBeInstanceOf(Uint32Array);
    expect(sentPositions.buffer).not.toBe(sourcePositions.buffer);
    expect(sentIndices.buffer).not.toBe(sourceIndices.buffer);
    expect(transfer).toEqual([sentPositions.buffer, sentIndices.buffer]);
    expect(sourcePositions.byteLength).toBeGreaterThan(0);
    expect(sourceIndices.byteLength).toBeGreaterThan(0);
    expect(message).toMatchObject({ thickness: input.thickness, openings: input.openings, options: input.options });

    worker.send({ requestId: message.requestId, type: "progress", text: "Building cavity" });
    expect(progress).toHaveBeenCalledWith("Building cavity");
    worker.send({ requestId: message.requestId, type: "result", positions: Float64Array.from(result.positions), indices: Uint32Array.from(result.indices), stats: result.stats });
    await expect(pending).resolves.toEqual(result);
    expect(worker.terminated).toBe(true);
  });

  it("rejects an already-aborted request without creating a worker", async () => {
    const { hollowMeshOffThread } = await load();
    const controller = new AbortController();
    controller.abort();
    await expect(hollowMeshOffThread(input, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("rejects cancellation immediately and terminates the in-flight worker", async () => {
    const { hollowMeshOffThread } = await load();
    const controller = new AbortController();
    const pending = hollowMeshOffThread(input, controller.signal);
    const worker = FakeWorker.instances[0];
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("times out and terminates the worker", async () => {
    vi.useFakeTimers();
    const { hollowMeshOffThread } = await load();
    const pending = hollowMeshOffThread(input);
    const worker = FakeWorker.instances[0];
    const rejection = expect(pending).rejects.toThrow(/too long/i);
    await vi.advanceTimersByTimeAsync(300_000);
    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("rejects a worker from another build and signals the reload event", async () => {
    const { hollowMeshOffThread } = await load("current-build");
    const pending = hollowMeshOffThread(input);
    const worker = FakeWorker.instances[0];
    worker.send({ type: "build", build: "old-build" });
    await expect(pending).rejects.toThrow(/another build/i);
    expect(worker.terminated).toBe(true);
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "layerling:build-mismatch" }));
  });
});
