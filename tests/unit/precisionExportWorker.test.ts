import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { DEFAULT_PRECISION } from "@/lib/precisionMesh";
import type { PrecisionResult } from "@/lib/precisionExport";
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  posted: Record<string, unknown>[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(m: Record<string, unknown>) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  send(m: unknown) {
    this.onmessage?.({ data: m });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", { location: { href: "http://localhost:1234/" } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("precision worker ownership", () => {
  it("rejects known invalid geometry before creating or cloning into a worker", async () => {
    const { PrecisionExportSession } = await import(
        "@/lib/precisionExportWorker"
      ),
      session = new PrecisionExportSession();
    const shape = {
      kind: "mesh",
      name: "Empty",
      importedMesh: { positions: [] },
    } as unknown as import("@/types/layerling").WorkplaneShape;
    await expect(
      session.run([shape], "stl", DEFAULT_PRECISION),
    ).rejects.toThrow(/no complete triangles/);
    expect(FakeWorker.instances.length).toBe(0);
  });
  it("recovers cleanly from worker construction failure", async () => {
    const { PrecisionExportSession } = await import(
        "@/lib/precisionExportWorker"
      ),
      session = new PrecisionExportSession();
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("Worker creation blocked");
        }
      },
    );
    await expect(session.run([], "stl", DEFAULT_PRECISION)).rejects.toThrow(
      /creation blocked/,
    );
    vi.stubGlobal("Worker", FakeWorker);
    const next = session.run([], "stl", DEFAULT_PRECISION);
    session.dispose();
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
  });
  it("keeps one worker for cached previews and ignores unrelated messages", async () => {
    const { PrecisionExportSession } = await import(
        "@/lib/precisionExportWorker"
      ),
      session = new PrecisionExportSession();
    let settled = false;
    const first = session.run([], "stl", DEFAULT_PRECISION).then((r) => {
        settled = true;
        return r;
      }),
      w = FakeWorker.instances[0];
    w.send({ id: 99, type: "result", result: {} });
    expect(() => w.send(null)).not.toThrow();
    expect(() => w.send("invalid")).not.toThrow();
    await Promise.resolve();
    expect(settled).toBe(false);
    const result = {
      bytes: new Uint8Array([1]),
      report: { ready: true },
      preview: { before: new Float32Array(), after: new Float32Array() },
    } as PrecisionResult;
    w.send({ id: 1, type: "result", result });
    expect(await first).toBe(result);
    expect(w.terminated).toBe(false);
    const second = session.run([], "3mf", DEFAULT_PRECISION);
    expect(FakeWorker.instances.length).toBe(1);
    w.send({ id: 2, type: "result", result });
    await second;
    session.dispose();
    expect(w.terminated).toBe(true);
  });
  it("terminates active geometry work on cancellation and can start a fresh worker", async () => {
    const { PrecisionExportSession } = await import(
        "@/lib/precisionExportWorker"
      ),
      session = new PrecisionExportSession(),
      controller = new AbortController();
    const work = session.run([], "stl", DEFAULT_PRECISION, controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances[0].terminated).toBe(true);
    const next = session.run([], "stl", DEFAULT_PRECISION);
    expect(FakeWorker.instances.length).toBe(2);
    session.dispose();
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
  });
  it("bounds worker time and releases a crashed worker", async () => {
    const { PrecisionExportSession } = await import(
        "@/lib/precisionExportWorker"
      ),
      session = new PrecisionExportSession();
    const work = session.run([], "stl", DEFAULT_PRECISION),
      rejection = expect(work).rejects.toThrow(/15 minute/);
    await vi.advanceTimersByTimeAsync(900000);
    await rejection;
    expect(FakeWorker.instances[0].terminated).toBe(true);
    const next = session.run([], "stl", DEFAULT_PRECISION);
    FakeWorker.instances[1].onerror?.({ message: "WASM allocation failed" });
    await expect(next).rejects.toThrow(/allocation/);
    expect(FakeWorker.instances[1].terminated).toBe(true);
  });
});
