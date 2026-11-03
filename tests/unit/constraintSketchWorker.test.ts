import { afterEach, expect, it, vi } from "vitest";
import { solveSketchInWorker } from "@/lib/constraintSketchWorker";
import { mountingPlateSketch, type ConstraintSolution } from "@/lib/constraintSketch";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { TestWorker.instances.push(this); }
}
function setup() { TestWorker.instances=[];vi.stubGlobal("Worker",TestWorker); }
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it("terminates a cancelled solve, discards late answers, and permits an independent retry",async()=>{
  setup();const abort=new AbortController();
  const cancelled=solveSketchInWorker(mountingPlateSketch(),abort.signal);
  const rejected=expect(cancelled).rejects.toMatchObject({name:"AbortError"});
  abort.abort();await rejected;
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  const retry=solveSketchInWorker(mountingPlateSketch(),new AbortController().signal);
  const solution={valid:true,document:mountingPlateSketch()} as ConstraintSolution;
  TestWorker.instances[0].onmessage!({data:{id:1,solution}});
  TestWorker.instances[1].onmessage!({data:{id:1,solution}});
  expect(await retry).toBe(solution);
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  expect(TestWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
});

it("terminates a stalled solve at its deadline and starts no worker for an aborted signal",async()=>{
  setup();vi.useFakeTimers();const controller=new AbortController();
  const promise=solveSketchInWorker(mountingPlateSketch(),controller.signal);
  const rejected=expect(promise).rejects.toThrow(/20 second deadline/);
  await vi.advanceTimersByTimeAsync(20_000);await rejected;
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  controller.abort();await expect(solveSketchInWorker(mountingPlateSketch(),controller.signal)).rejects.toMatchObject({name:"AbortError"});
  expect(TestWorker.instances).toHaveLength(1);
});
