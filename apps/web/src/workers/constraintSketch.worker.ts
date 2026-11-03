/// <reference lib="webworker" />
import { solveConstraintSketch, type ConstraintSketch, type PlaneGcsRuntime } from "@/lib/constraintSketch";
let runtime: Promise<PlaneGcsRuntime> | null = null;
async function load() {
  const url="/assets/planegcs/1.3.0/index.js";
  runtime ??= (import(/* webpackIgnore: true */ url) as Promise<typeof import("@salusoft89/planegcs")>).then(async api => ({ api, module: await api.init_planegcs_module({ locateFile: () => "/assets/planegcs/1.3.0/planegcs_dist/planegcs.wasm" }) })).catch(error => { runtime=null; throw error; });
  return runtime;
}
self.onmessage = async (event: MessageEvent<{id:number;document:ConstraintSketch}>) => {
  try { self.postMessage({id:event.data.id,solution:solveConstraintSketch(event.data.document,await load())}); }
  catch(error) { self.postMessage({id:event.data.id,error:error instanceof Error?error.message:String(error)}); }
};
