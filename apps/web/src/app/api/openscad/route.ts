import { NextResponse } from "next/server";
import { renderOpenScad, type OpenScadInput } from "@/lib/openScadServer";
import { isLocalRequest } from "@/lib/layerlingMcpLocalRequest";
import { parseCustomizer } from "@/lib/openscad/vendor/scadParser.cjs";

export const runtime = "nodejs";
export const revalidate = false;
const jobs = new Map<string, AbortController>();
const allowed = (request: Request) => Boolean(process.env.LAYERLING_OPENSCAD_EXECUTABLE) && isLocalRequest(request);
export function GET(request: Request) {
  return NextResponse.json({ available: allowed(request), representation: "openscad-triangle-mesh" }, { headers: { "Cache-Control": "no-store" } });
}
export async function DELETE(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "Local engine unavailable" }, { status: 403 });
  jobs.get(new URL(request.url).searchParams.get("jobId") ?? "")?.abort();
  return NextResponse.json({ canceled: true });
}
export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "Bundled local OpenSCAD engine is unavailable" }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 48_000_000) return NextResponse.json({ error: "OpenSCAD request too large" }, { status: 413 });
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  let jobId = "";
  try {
    const body = await request.json();
    const input = body.input as OpenScadInput;
    if (!input || typeof input.source !== "string" || input.source.length > 2_000_000) throw new Error("Invalid or oversized SCAD source");
    if (body.action === "analyze") return NextResponse.json(parseCustomizer(input.source));
    jobId = String(body.jobId ?? "");
    if (!/^[\w-]{1,100}$/.test(jobId) || jobs.has(jobId)) throw new Error("Invalid or active OpenSCAD job id");
    if (jobs.size >= 8) return NextResponse.json({ error: "Too many OpenSCAD requests; cancel an existing job" }, { status: 429 });
    jobs.set(jobId, controller);
    return NextResponse.json(await renderOpenScad(input, controller.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), canceled: controller.signal.aborted }, { status: controller.signal.aborted ? 499 : 422 });
  } finally {
    jobs.delete(jobId);
    request.signal.removeEventListener("abort", onAbort);
  }
}
