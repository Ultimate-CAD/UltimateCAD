/// <reference lib="webworker" />

import { buildMessage } from "@/lib/buildStamp";
import { getManifoldRuntime, setManifoldAssetBase } from "@/lib/editorMeshCore";
import { hollowMesh } from "@/lib/meshHollow";
import type { MeshHollowInput, MeshHollowResult } from "@/lib/meshHollow";

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

self.postMessage(buildMessage());

self.onmessage = async (event: MessageEvent<MeshHollowWorkerRequest>) => {
  const request = event.data;
  const post = (message: MeshHollowWorkerResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer });
  try {
    setManifoldAssetBase(request.assetBase);
    const runtime = await getManifoldRuntime();
    const result = hollowMesh(runtime, {
      positions: request.positions,
      indices: request.indices,
      thickness: request.thickness,
      openings: request.openings,
      ...(request.options ? { options: request.options } : {}),
    }, (text) => post({ requestId: request.requestId, type: "progress", text }));
    const positions = Float64Array.from(result.positions);
    const indices = Uint32Array.from(result.indices);
    post({ requestId: request.requestId, type: "result", positions, indices, stats: result.stats }, [positions.buffer, indices.buffer]);
  } catch (error) {
    post({ requestId: request.requestId, type: "error", message: error instanceof Error ? error.message : String(error ?? ""), name: error instanceof Error ? error.name : "Error" });
  }
};
