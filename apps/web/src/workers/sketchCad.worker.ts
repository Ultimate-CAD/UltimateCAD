/// <reference lib="webworker" />

import { OcctKernel, type OcctModuleFactory, type ShapeHandle } from "occt-wasm";
import { CAD_MODIFIER_RUNTIME_BASE } from "@/lib/cadModifierRuntime";
import { sketchCadDeflection } from "@/lib/sketchCadDeflection";
import { cadSketchRegions } from "@/lib/sketchCadProfile";
import { buildRevolvedSketchSolid } from "@/lib/cadSketchRevolve";
import { buildStrokedSketchSolid } from "@/lib/cadSketchStroke";
import { buildSweptSketchSolid } from "@/lib/cadSketchSweep";
import { buildInsetSketchSolid } from "@/lib/cadSketchInset";
import { resolveRevolveAngle } from "@/lib/sketchPadHistory";
import { FeatureSolidCache } from "@/lib/featureSolidCache";
import { replaySketchPocket } from "@/lib/replaySketchPocket";
import { replayThroughHoles } from "@/lib/replayThroughHoles";
import { pathWire } from "@/lib/sketchCadWire";
import { buildMessage } from "@/lib/buildStamp";
import { SKETCH_INSET_UNSUPPORTED, SKETCH_STROKE_UNSUPPORTED, type SketchCadBuildRequest, type SketchCadBuildResponse } from "@/lib/sketchCadTypes";

/** Past this many edges in a sketch's outlines the kernel's validity check is skipped (it takes seconds to minutes there). */
const LARGE_SKETCH_EDGES = 1500;

let kernelPromise: Promise<OcctKernel> | null = null;

function kernel() {
  const moduleUrl = `${CAD_MODIFIER_RUNTIME_BASE}/occt-wasm.js`;
  // Drop a rejected attempt so a transient failure (e.g. a network blip
  // fetching the 22 MB wasm) can be retried on the next call instead of
  // poisoning sketch-to-3D for the rest of the session - same fix as
  // brepKernel.ts's loadBrepWithOcct.
  kernelPromise ??= import(/* webpackIgnore: true */ moduleUrl)
    .then((imported: { default: OcctModuleFactory }) => OcctKernel.init({
      createModule: imported.default,
      wasm: `${CAD_MODIFIER_RUNTIME_BASE}/occt-wasm.wasm`,
    }))
    .catch((error) => {
      kernelPromise = null;
      throw error;
    });
  return kernelPromise;
}

function post(message: SketchCadBuildResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

// The first thing the page hears: which build this worker is from (lib/buildStamp.ts).
self.postMessage(buildMessage());

const featureCache = new FeatureSolidCache();

self.onmessage = async (event: MessageEvent<SketchCadBuildRequest>) => {
  const request = event.data;
  let cad: OcctKernel | null = null;
  try {
    cad = await kernel();
    cad.releaseAll();
    let result: ShapeHandle;
    const baseHistory=request.profile.constraintSketch?.featureHistory;
    if (baseHistory?.pad.kind === "revolve") {
      result = buildRevolvedSketchSolid(cad,request.profile,baseHistory.pad.startAngle ?? 0,resolveRevolveAngle(baseHistory));
    } else if (request.revolve) {
      result = buildRevolvedSketchSolid(cad, request.profile, request.revolve.startAngle, request.revolve.sweepAngle);
    } else if (request.sweep) {
      result = buildSweptSketchSolid(cad, request.profile);
    } else if (request.stroke) {
      const stroked = buildStrokedSketchSolid(cad, request.profile, request.stroke, request.height);
      if (!stroked) throw new Error(SKETCH_STROKE_UNSUPPORTED);
      result = stroked;
    } else if (request.inset) {
      const inset = buildInsetSketchSolid(cad, request.profile, request.inset, request.height);
      if (!inset) throw new Error(SKETCH_INSET_UNSUPPORTED);
      result = inset;
    } else {
      const buildPad = () => {
        const regions = cadSketchRegions(request.profile);
        if (regions.length === 0) throw new Error("No closed profile found. Draw at least one closed loop and ensure it has no degenerate (zero-area) geometry.");
        const solids: ShapeHandle[] = regions.map((region) => {
          let face = cad!.makeFace(pathWire(cad!, region.outer));
          if (region.holes.length > 0) face = cad!.addHolesInFace(face, region.holes.map((hole) => pathWire(cad!, hole)));
          return cad!.extrude(face, 0, request.height, 0);
        });
        const pad = solids.length === 1 ? solids[0] : cad!.makeCompound(solids);
        // The validity check grows steeply with the edges: a stroked traced drawing (7 000 straight pieces,
        // a hole in it) took 51 s of a 56 s build (#461). A body that large is checked by its volume instead.
        const edgeCount = regions.reduce((sum, region) => sum + region.outer.steps.length + region.holes.reduce((inner, hole) => inner + hole.steps.length, 0), 0);
        const sound = !request.profile.constraintSketch && edgeCount > LARGE_SKETCH_EDGES ? cad!.getVolume(pad) > 1e-9 : cad!.isValid(pad);
        if (!sound) throw new Error("OpenCascade produced invalid sketch topology");
        return pad;
      };
      if (request.profile.constraintSketch?.featureHistory) {
        // The pad depends on the solved profile and its depth. Changes to
        // downstream feature parameters cannot change the pad's exact shape.
        const {constraintSketch, ...geometry} = request.profile;
        const key = JSON.stringify([constraintSketch.featureHistory!.pad.id, request.height, geometry]);
        result = featureCache.run(cad,key,buildPad);
      } else result = buildPad();
    }
    const history = request.profile.constraintSketch?.featureHistory;
    const featureHeight=baseHistory?.pad.kind==="revolve" ? cad.getBoundingBox(result).ymax : request.height;
    if (history?.pocket && !history.pocket.suppressed) result = replaySketchPocket(cad,result,history.pocket,featureHeight);
    if (history?.holes?.length) {
      if (request.revolve || request.sweep || request.stroke || request.inset) throw Error("Hole history requires its original pad");
      result = replayThroughHoles(cad,result,history,featureHeight);
    }
    const deflection = sketchCadDeflection(request.profile);
    const mesh = cad.tessellate(result, { linearDeflection: deflection.linear, angularDeflection: deflection.angular });
    const positions = new Float32Array(mesh.positions);
    const normals = new Float32Array(mesh.normals);
    const indices = new Uint32Array(mesh.indices);
    const brep = cad.toBREP(result);
    post({ type: "built", requestId: request.requestId, positions, normals, indices, triangleCount: mesh.triangleCount, brep, deflection }, [positions.buffer, normals.buffer, indices.buffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "The CAD kernel could not build this sketch");
    post({ type: "error", requestId: request.requestId, message });
    if (/memory|WebAssembly|abort/i.test(message)) kernelPromise = null;
  } finally {
    try {
      cad?.releaseAll();
    } catch {
      // The arena may already have reset after a kernel error.
    }
  }
};

export {};
