import type { WorkplaneShape } from "@/types/layerling";
import type { PrecisionSettings } from "@/lib/precisionMesh";
import { validatePrecisionSettings } from "@/lib/precisionMesh";
import { assertKnownPrecisionSourceBudget } from "@/lib/precisionResource";
import type { PrecisionFormat, PrecisionResult } from "@/lib/precisionExport";
import {
  verificationFailure,
  verificationVerdict,
  type VerificationVerdict,
} from "@/lib/manufacturingVerdict";
import {
  BUILD_ID,
  buildsDiffer,
  isBuildMessage,
  reportWorkerBuild,
} from "@/lib/buildStamp";

/** One worker per open studio. Termination cancels WASM, refinement and encoding immediately. */
export class PrecisionExportSession {
  private worker: Worker | null = null;
  private cancel: (() => void) | null = null;
  private sequence = 0;
  private outcome: VerificationVerdict | null = null;
  get lastOutcome() {
    return this.outcome;
  }
  private reject(error: unknown): Promise<never> {
    this.outcome = verificationFailure(error);
    return Promise.reject(error);
  }
  dispose() {
    this.cancel?.();
    this.worker?.terminate();
    this.worker = null;
  }
  run(
    shapes: readonly WorkplaneShape[],
    format: PrecisionFormat,
    settings: PrecisionSettings,
    signal?: AbortSignal,
    onProgress?: (s: string) => void,
  ): Promise<PrecisionResult> {
    if (signal?.aborted)
      return this.reject(new DOMException("Export canceled", "AbortError"));
    if (this.cancel)
      return Promise.reject(new Error("An export preview is already running"));
    this.outcome = null;
    try {
      validatePrecisionSettings(settings);
      assertKnownPrecisionSourceBudget(shapes, settings.triangleBudget);
    } catch (error) {
      return this.reject(error);
    }
    if (typeof Worker === "undefined" || typeof window === "undefined")
      return this.reject(
        new Error("Precision export requires a Web Worker"),
      );
    if (!this.worker) {
      try {
        this.worker = new Worker(
          new URL("../workers/precisionExport.worker.ts", import.meta.url),
          { type: "module", name: "layerling-precision-export" },
        );
      } catch (error) {
        return this.reject(error);
      }
    }
    const worker = this.worker,
      id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.cancel = null;
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
      };
      const fail = (error: Error) => {
        this.outcome = verificationFailure(error);
        finish();
        worker.terminate();
        this.worker = null;
        reject(error);
      };
      const abort = () =>
        fail(
          new DOMException(
            "Export canceled; source geometry preserved",
            "AbortError",
          ),
        );
      const timer = setTimeout(
        () =>
          fail(
            new Error(
              "Precision export exceeded its 15 minute worker time budget",
            ),
          ),
        900000,
      );
      this.cancel = abort;
      signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = (e) =>
        fail(new Error(e.message || "Precision worker failed"));
      worker.onmessageerror = () =>
        fail(new Error("Precision worker could not decode its result"));
      worker.onmessage = (e) => {
        const message = e.data;
        if (isBuildMessage(message)) {
          reportWorkerBuild(message);
          if (buildsDiffer(BUILD_ID, message.build))
            fail(
              new Error(
                "Precision export worker belongs to another build; reload the editor",
              ),
            );
          return;
        }
        if (!message || typeof message !== "object") return;
        if (message.id !== id) return;
        if (message.type === "progress") {
          onProgress?.(message.text);
          return;
        }
        if (message.type === "error") {
          fail(new Error(message.message));
          return;
        }
        if (message.type === "result") {
          this.outcome =
            message.result?.report?.verification ??
            verificationVerdict(
              "inconclusive",
              "Worker result has no surface verdict",
            );
          finish();
          resolve(message.result);
        }
      };
      try {
        worker.postMessage({
          id,
          shapes,
          format,
          settings,
          assetBase: new URL(".", window.location.href).href,
        });
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}
