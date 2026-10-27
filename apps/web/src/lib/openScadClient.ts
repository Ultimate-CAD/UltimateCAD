import type { WorkplaneShape } from "@/types/layerling";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import { newOpenScadDocument, validateOpenScadDocument, type OpenScadDocument, type ScadRenderResult } from "@/lib/openScadTypes";

export async function renderScadShape(document: OpenScadDocument, previous?: WorkplaneShape | null, signal?: AbortSignal): Promise<{ shape: WorkplaneShape; result: ScadRenderResult }> {
  validateOpenScadDocument(document);
  const jobId = crypto.randomUUID();
  const abort = () => { void fetch(`/api/openscad?jobId=${jobId}`, { method: "DELETE", keepalive: true }).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch("/api/openscad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, input: document }), signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `OpenSCAD engine returned ${response.status}`);
    const result = payload as ScadRenderResult;
    const model: OpenScadDocument = { ...document, files: { ...document.files, ...result.files }, meshKey: result.key, engineVersion: result.engineVersion, needsRegeneration: false };
    validateOpenScadDocument(model);
    if (previous?.openScad?.meshKey === result.key) return { shape: { ...previous, openScad: model }, result };
    const bytes = Uint8Array.from(atob(result.stlBase64), c => c.charCodeAt(0));
    const { importedShapeFromStlOffThread } = await import("@/lib/geometryWorker");
    const mesh = await importedShapeFromStlOffThread(document.fileName.replace(/\.scad$/i, ".stl"), bytes.buffer, true);
    if (signal?.aborted) throw new DOMException("Render canceled", "AbortError");
    // Keep scene identity/placement; dimensions now come from the SCAD result, not an approximate B-rep.
    const shape = canonicalizeShape({ ...mesh, ...(previous ? { id: previous.id, name: previous.name, color: previous.color, x: previous.x, z: previous.z, elevation: previous.elevation, rotation: previous.rotation, rotationX: previous.rotationX, rotationZ: previous.rotationZ, hole: previous.hole, hidden: previous.hidden } : { x: 0, z: 0 }), openScad: model });
    return { shape, result };
  } finally { signal?.removeEventListener("abort", abort); }
}

export async function importOpenScadFile(file: File, companions: readonly File[] = []): Promise<WorkplaneShape> {
  const document = newOpenScadDocument(await file.text(), (file.webkitRelativePath || file.name).replace(/\\/g, "/") || "model.scad");
  const desktop = (window as unknown as { layerlingFiles?: { pathForFile(file: File): string } }).layerlingFiles;
  const sourcePath = desktop?.pathForFile(file);
  if (sourcePath) document.sourceDirectory = sourcePath.replace(/[\\/][^\\/]+$/, "");
  for (const other of companions) {
    if (other === file) continue;
    const name = other.webkitRelativePath || other.name;
    if (/\.scad$/i.test(name)) document.files[name] = { encoding: "utf8", data: await other.text() };
    else {
      const bytes = new Uint8Array(await other.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      document.files[name] = { encoding: "base64", data: btoa(binary) };
    }
  }
  return (await renderScadShape(document)).shape;
}
