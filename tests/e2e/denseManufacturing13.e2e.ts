import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  auditIndexedManufacturingMesh,
  indexManufacturingMesh,
} from "@/lib/manufacturingMesh";
import { manufacturingIndexedSurfaceChecks } from "@/lib/meshManufacturingQa";
import { observeGeometryTiming } from "@/lib/geometryTiming";
import type { StlExportMesh } from "@/lib/stlExport";

const require = createRequire(import.meta.url);
const { decodeResult } = require("../../desktop/native-geometry-protocol.cjs");
const fixture = process.env.LAYERLING_DENSE_QA_FILE;

function hashFile(file: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function hashMesh(mesh: StlExportMesh) {
  const hash = createHash("sha256");
  const coordinates = Buffer.allocUnsafe(mesh.vertices.length * 24);
  let offset = 0;
  for (const point of mesh.vertices) {
    for (const value of point) {
      coordinates.writeDoubleLE(value, offset);
      offset += 8;
    }
  }
  hash.update(coordinates);
  const indices = Buffer.allocUnsafe(mesh.faces.length * 12);
  offset = 0;
  for (const face of mesh.faces) {
    for (const index of face) {
      indices.writeUInt32LE(index, offset);
      offset += 4;
    }
  }
  return hash.update(indices).digest("hex");
}

function writeCanonicalProtocolMesh(file: string, mesh: StlExportMesh) {
  const positionCount = mesh.vertices.length * 3;
  const indexCount = mesh.faces.length * 3;
  const bytes = Buffer.allocUnsafe(16 + positionCount * 8 + indexCount * 4);
  bytes.writeUInt32LE(0x31524c4c, 0);
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(positionCount, 8);
  bytes.writeUInt32LE(indexCount, 12);
  let offset = 16;
  for (const point of mesh.vertices) {
    for (const value of point) {
      bytes.writeDoubleLE(value, offset);
      offset += 8;
    }
  }
  for (const face of mesh.faces) {
    for (const index of face) {
      bytes.writeUInt32LE(index, offset);
      offset += 4;
    }
  }
  writeFileSync(file, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

async function decodeFixture(file: string): Promise<StlExportMesh> {
  const bytes = readFileSync(file);
  const extension = path.extname(file).toLowerCase();
  if (extension === ".bin") {
    const decoded = decodeResult(bytes);
    const positions = decoded.positions as Float64Array;
    const indices = decoded.indices as Uint32Array;
    return {
      vertices: Array.from({ length: positions.length / 3 }, (_, i) => [
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]),
      faces: Array.from({ length: indices.length / 3 }, (_, i) => [
        indices[i * 3],
        indices[i * 3 + 1],
        indices[i * 3 + 2],
      ]),
    };
  }
  if (extension === ".stl") {
    const geometry = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const positions = geometry.attributes.position.array;
    const vertices = Array.from({ length: positions.length / 3 }, (_, i) => [
      positions[i * 3],
      positions[i * 3 + 2],
      -positions[i * 3 + 1],
    ] as [number, number, number]);
    const faces = Array.from({ length: vertices.length / 3 }, (_, i) => [
      i * 3,
      i * 3 + 1,
      i * 3 + 2,
    ] as [number, number, number]);
    geometry.dispose();
    return { vertices, faces };
  }
  if (extension === ".3mf") {
    const xml = strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);
    expect(xml).toMatch(/unit="millimeter"/);
    return {
      vertices: [
        ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\s*\/>/g),
      ].map((match) => [+match[1], +match[3], -match[2]] as [number, number, number]),
      faces: [
        ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"[^>]*>/g),
      ].map((match) => [+match[1], +match[2], +match[3]] as [number, number, number]),
    };
  }
  throw new Error(`Unsupported dense QA fixture format: ${extension}`);
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

it.skipIf(!fixture || !existsSync(fixture))(
  "profiles cached dense geometry manufacturing QA without repair or remeshing",
  async () => {
    const outputDir = path.resolve(
      process.env.LAYERLING_DENSE_QA_DIR ??
        `.codex-run/certification13/baseline-${Date.now()}-${process.pid}`,
    );
    mkdirSync(outputDir, { recursive: true });
    const preservedSource = path.join(outputDir, `source-input${path.extname(fixture!)}`);
    copyFileSync(fixture!, preservedSource);
    const report: Record<string, unknown> = {
      fixture: path.resolve(fixture!),
      preservedSource,
      startedAt: new Date().toISOString(),
      phases: [],
    };
    const phases = report.phases as Record<string, unknown>[];
    const sample = (name: string, startedAt: number, before: ReturnType<typeof memorySnapshot>) => {
      phases.push({
        name,
        durationMs: performance.now() - startedAt,
        before,
        after: memorySnapshot(),
      });
    };

    const sourceSha256Before = await hashFile(fixture!);
    report.sourceSha256Before = sourceSha256Before;
    report.preservedSourceSha256 = await hashFile(preservedSource);
    const decodeStarted = performance.now();
    const decodeMemory = memorySnapshot();
    const source = await decodeFixture(fixture!);
    sample("decode", decodeStarted, decodeMemory);
    report.sourceTriangleCount = source.faces.length;
    report.sourceVertexCount = source.vertices.length;
    report.sourceGeometrySha256Before = hashMesh(source);

    const spans: { name: string; startMs: number; durationMs: number; depth: number }[] = [];
    observeGeometryTiming((span) => spans.push(span));
    let canonical: StlExportMesh;
    let audit;
    let surface;
    try {
      const indexStarted = performance.now();
      const indexMemory = memorySnapshot();
      canonical = indexManufacturingMesh(source);
      sample("canonicalIndex", indexStarted, indexMemory);
      const canonicalPath = path.join(outputDir, "canonical-source.mesh.bin");
      report.canonicalProtocolMesh = canonicalPath;
      report.canonicalProtocolMeshSha256 = writeCanonicalProtocolMesh(
        canonicalPath,
        canonical,
      );

      const auditStarted = performance.now();
      const auditMemory = memorySnapshot();
      audit = auditIndexedManufacturingMesh(canonical);
      sample("rawTopologyAudit", auditStarted, auditMemory);

      const surfaceStarted = performance.now();
      const surfaceMemory = memorySnapshot();
      surface = manufacturingIndexedSurfaceChecks(
        canonical,
        true,
        0.8,
        audit.shellSeeds,
        { profile: process.env.LAYERLING_DENSE_PROFILE === "1" },
      );
      sample("surfaceIntersectionAndThickness", surfaceStarted, surfaceMemory);
    } finally {
      observeGeometryTiming();
    }

    const sourceGeometrySha256After = hashMesh(source);
    const sourceSha256After = await hashFile(fixture!);
    const surfaceStatus = !audit.valid || surface.selfIntersections.found > 0
      ? "verified-invalid"
      : surface.selfIntersections.complete
        ? "verified-valid"
        : "inconclusive";
    const manufacturingStatus = surface.wallConcern ? "concern" : "no-sampled-wall-concern";
    Object.assign(report, {
      finishedAt: new Date().toISOString(),
      canonicalVertexCount: canonical.vertices.length,
      canonicalTriangleCount: canonical.faces.length,
      rawTopologyAudit: audit,
      surfaceChecks: surface,
      geometryTimingSpans: spans,
      sourceGeometrySha256After,
      sourceSha256After,
      sourceGeometryUnchanged: report.sourceGeometrySha256Before === sourceGeometrySha256After,
      sourceFileUnchanged: sourceSha256Before === sourceSha256After,
      surfaceStatus,
      manufacturingStatus,
      ready: surfaceStatus === "verified-valid" && !surface.wallConcern,
      wallConcernInterpretation: "A sampled thickness below 0.8 mm is a manufacturing concern; it does not invalidate the intersection check.",
      finalMemory: memorySnapshot(),
    });
    const reportPath = path.join(outputDir, "dense-manufacturing-qa.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    expect(audit.valid, JSON.stringify(audit)).toBe(true);
    expect(sourceGeometrySha256After).toBe(report.sourceGeometrySha256Before);
    expect(sourceSha256After).toBe(sourceSha256Before);
    expect(report.preservedSourceSha256).toBe(sourceSha256Before);
    if (process.env.LAYERLING_DENSE_REQUIRE_COMPLETE === "1")
      expect(surface.selfIntersections.complete, JSON.stringify(surface.selfIntersections)).toBe(true);
    console.log(`Dense QA report: ${reportPath}`);
  },
  150_000,
);
