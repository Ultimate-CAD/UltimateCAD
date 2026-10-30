import { buildsDiffer, BUILD_ID, isBuildMessage, reportWorkerBuild } from "@/lib/buildStamp";
import type { MeshHollowInput, MeshHollowResult } from "@/lib/meshHollow";
import {nativeMeshHollow,canNativeMeshHollow} from '@/lib/nativeMeshHollow';

const MESH_HOLLOW_TIMEOUT_MS = 300_000;

type MeshHollowWorkerRequest = {
  requestId: number;
  assetBase: string;
  positions: Float64Array;
  indices: Uint32Array;
  thickness: number;
  openings: MeshHollowInput["openings"];
  options?: MeshHollowInput["options"];
};

type MeshHollowWorkerResponse =
  | { requestId: number; type: "progress"; text: string }
  | { requestId: number; type: "result"; positions: Float64Array; indices: Uint32Array; stats: MeshHollowResult["stats"] }
  | { requestId: number; type: "error"; message: string; name: string };

let requestCounter = 0;

/** Hollow an imported triangle mesh in its own worker so cancelling it can stop the computation. */
export function hollowMeshOffThread(input: MeshHollowInput, signal?: AbortSignal, onProgress?: (text: string) => void): Promise<MeshHollowResult> {
  if(canNativeMeshHollow(input))return nativeMeshHollow(input,signal,onProgress).then(result=>result??hollowMeshWasmOffThread(input,signal,onProgress));
  return hollowMeshWasmOffThread(input,signal,onProgress);
}
function hollowMeshWasmOffThread(input: MeshHollowInput, signal?: AbortSignal, onProgress?: (text: string) => void): Promise<MeshHollowResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === "undefined" || typeof window === "undefined") {
    return Promise.reject(new Error("Mesh hollowing requires a Web Worker"));
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("../workers/meshHollow.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  const requestId = ++requestCounter;
  let timer: number | undefined;
  let abort: (() => void) | undefined;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer !== undefined) window.clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    worker.terminate();
  };

  return new Promise<MeshHollowResult>((resolve, reject) => {
    abort = () => {
      finish();
      reject(abortError());
    };
    timer = window.setTimeout(() => {
      finish();
      reject(new Error("Mesh hollowing took too long"));
    }, MESH_HOLLOW_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<MeshHollowWorkerResponse | unknown>) => {
      if (finished) return;
      const message = event.data;
      if (isBuildMessage(message)) {
        reportWorkerBuild(message);
        if (buildsDiffer(BUILD_ID, message.build)) {
          finish();
          reject(new Error("The mesh hollowing worker belongs to another build; reload the editor"));
        }
        return;
      }
      if (!message || typeof message !== "object" || !("requestId" in message) || message.requestId !== requestId || !("type" in message)) return;
      if (message.type === "progress" && "text" in message) {
        onProgress?.(String(message.text));
        return;
      }
      finish();
      if (message.type === "error" && "message" in message) {
        const error = new Error(String(message.message));
        error.name = "name" in message ? String(message.name) : "Error";
        reject(error);
      } else if (message.type === "result" && "positions" in message && "indices" in message && "stats" in message) {
        resolve({ positions: Array.from(message.positions as Float64Array), indices: Array.from(message.indices as Uint32Array), stats: message.stats as MeshHollowResult["stats"] });
      }
    };
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message || "The mesh hollowing worker stopped"));
    };
    worker.onmessageerror = () => {
      if (finished) return;
      finish();
      reject(new Error("The mesh hollowing worker returned an unreadable result"));
    };
    signal?.addEventListener("abort", abort, { once: true });

    // Copy caller-owned arrays before transferring: the editor's source mesh stays attached.
    const positions = Float64Array.from(input.positions);
    const indices = Uint32Array.from(input.indices);
    const request: MeshHollowWorkerRequest = {
      requestId,
      assetBase: new URL(".", window.location.href).href,
      positions,
      indices,
      thickness: input.thickness,
      openings: input.openings,
      ...(input.options ? { options: input.options } : {}),
    };
    try {
      worker.postMessage(request, [positions.buffer, indices.buffer]);
    } catch (error) {
      if (finished) return;
      finish();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function abortError() {
  return new DOMException("Mesh hollowing was cancelled", "AbortError");
}
