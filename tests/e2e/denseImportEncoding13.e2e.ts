import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import manifoldModule from "manifold-3d";
import { importedShapeFromStl } from "@/lib/stlImport";
import { meshForShape } from "@/lib/editorMeshCore";
import { importLylProject } from "@/lib/lylProject";
import { auditManufacturingMesh, indexManufacturingMesh } from "@/lib/manufacturingMesh";
import { PrecisionExportEngine } from "@/lib/precisionExport";
import { DEFAULT_PRECISION } from "@/lib/precisionMesh";
import type { StlExportMesh } from "@/lib/stlExport";
import type { WorkplaneShape } from "@/types/layerling";

vi.mock("@/lib/brepKernel", () => ({
  loadBrepWithOcct: () => {
    throw new Error("Import encoding audit must not retessellate a B-rep");
  },
}));

const stlFixture = path.resolve(
  process.env.LAYERLING_IMPORT_ENCODING_STL ||
    ".codex-run/adaptive10/manufacturing-1793350350780/result.stl",
);
const lylFixture = path.resolve(
  process.env.LAYERLING_IMPORT_ENCODING_LYL ||
    ".codex-run/certification13/packaged-1793639896233/dense-import-source.lyl",
);

function hashFile(file: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function hashPositions(positions: readonly number[]) {
  const bytes = Buffer.allocUnsafe(positions.length * 8);
  for (let index = 0; index < positions.length; index++)
    bytes.writeDoubleLE(positions[index], index * 8);
  return createHash("sha256").update(bytes).digest("hex");
}

function writeProtocolMesh(file: string, mesh: StlExportMesh) {
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

function decodeExport(file: string, format: "stl" | "3mf"): StlExportMesh {
  if (format === "stl") {
    const bytes = readFileSync(file);
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
  const xml = strFromU8(unzipSync(readFileSync(file))["3D/3dmodel.model"]);
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

async function runFormat(
  runtime: Awaited<ReturnType<typeof manifoldModule>>,
  shape: WorkplaneShape,
  format: "stl" | "3mf",
  outputDir: string,
) {
  const engine = new PrecisionExportEngine(runtime);
  const result = await engine.run([shape], format, {
    ...DEFAULT_PRECISION,
    repair: false,
  });
  const reportPath = path.join(outputDir, `${format}-report.json`);
  writeFileSync(reportPath, JSON.stringify(result.report, null, 2));
  const details: Record<string, unknown> = {
    format,
    reportPath,
    bytesProduced: Boolean(result.bytes),
    reportTriangles: result.report.triangles,
    bodyAudit: result.report.bodies[0]?.audit,
    surface: result.report.bodies[0]?.surface,
    ready: result.report.ready,
    verification: result.report.verification,
  };
  if (result.bytes) {
    const file = path.join(outputDir, `result.${format}`);
    writeFileSync(file, result.bytes);
    const decoded = decodeExport(file, format);
    const decodedAudit = auditManufacturingMesh(decoded);
    const canonical = indexManufacturingMesh(decoded);
    const canonicalPath = path.join(outputDir, `${format}-encoded-world.mesh.bin`);
    const canonicalSha256 = writeProtocolMesh(canonicalPath, canonical);
    const reimportPath = path.join(outputDir, `${format}-reimport-audit.json`);
    writeFileSync(reimportPath, JSON.stringify(decodedAudit, null, 2));
    Object.assign(details, {
      bytes: result.bytes.byteLength,
      outputPath: file,
      reimportAuditPath: reimportPath,
      reimportAudit: decodedAudit,
      canonicalPath,
      canonicalSha256,
    });
  }
  return details;
}

function saveCanonicalMesh(
  file: string,
  mesh: StlExportMesh,
  float32 = false,
) {
  const indexed = indexManufacturingMesh(mesh, float32);
  return {
    sha256: writeProtocolMesh(file, indexed),
    vertices: indexed.vertices.length,
    triangles: indexed.faces.length,
  };
}

async function analyzeCapturedProject(
  fixture: string,
  outputDir: string,
  runtime: Awaited<ReturnType<typeof manifoldModule>>,
) {
  const project = await importLylProject(readFileSync(fixture));
  const shape = project.shapes.find(
    (candidate) => candidate.kind === "mesh" && candidate.importedMesh,
  );
  expect(shape, "Captured source project has no imported STL mesh").toBeDefined();
  const imported = shape!;
  const positionsHash = hashPositions(imported.importedMesh!.positions);
  let localAudit;
  {
    const localMesh = meshForShape({ ...imported, x: 0, z: 0 });
    localAudit = auditManufacturingMesh(localMesh);
  }
  const exactWorldMesh = meshForShape(imported);
  const exactAudit = auditManufacturingMesh(exactWorldMesh);
  const float32Audit = auditManufacturingMesh(exactWorldMesh, true);
  const exactCanonicalPath = path.join(outputDir, "import-world-exact.mesh.bin");
  const exactCanonical = saveCanonicalMesh(exactCanonicalPath, exactWorldMesh);
  const float32CanonicalPath = path.join(outputDir, "import-world-float32.mesh.bin");
  const float32Canonical = saveCanonicalMesh(float32CanonicalPath, exactWorldMesh, true);
  const geometryBefore = hashPositions(imported.importedMesh!.positions);
  const outputs: Record<string, unknown>[] = [];
  for (const format of ["3mf", "stl"] as const) {
    try {
      outputs.push(await runFormat(runtime, imported, format, outputDir));
    } catch (error) {
      const errorText = error instanceof Error ? error.stack ?? error.message : String(error);
      const errorPath = path.join(outputDir, `${format}-error.txt`);
      writeFileSync(errorPath, errorText);
      outputs.push({ format, error: errorText, errorPath });
    }
  }
  const geometryAfter = hashPositions(imported.importedMesh!.positions);
  const summary = {
    shape: {
      name: imported.name,
      position: [imported.x, imported.z, imported.elevation ?? 0],
      dimensions: [imported.width, imported.height, imported.depth],
      sourceTriangles: imported.importedMesh!.triangleCount,
      positionCount: imported.importedMesh!.positions.length,
      positionsSha256: positionsHash,
    },
    localAudit,
    exactWorldAudit: exactAudit,
    float32WorldAudit: float32Audit,
    exactCanonicalPath,
    exactCanonical,
    float32CanonicalPath,
    float32Canonical,
    geometryUnchangedByExports: geometryBefore === geometryAfter,
    precisionOutputs: outputs,
  };
  return summary;
}

// Large captured-project audit is opt-in; the small encoding regression always runs.
it.skipIf(process.env.LAYERLING_DENSE_IMPORT_ENCODING !== "1")(
  "traces dense imported STL topology through stored coordinates and precision output encodings",
  async () => {
    const outputDir = path.resolve(
      process.env.LAYERLING_IMPORT_ENCODING_DIR ||
        `.codex-run/certification13/import-encoding-${Date.now()}`,
    );
    mkdirSync(outputDir, { recursive: true });
    const stlHashBefore = await hashFile(stlFixture);
    const lylHashBefore = await hashFile(lylFixture);
    const runtime = await manifoldModule();
    runtime.setup();
    const capturedLylShape = await analyzeCapturedProject(lylFixture, outputDir, runtime);
    let stlBytes = readFileSync(stlFixture);
    const directImport = importedShapeFromStl(path.basename(stlFixture),
      stlBytes.buffer.slice(stlBytes.byteOffset, stlBytes.byteOffset + stlBytes.byteLength) as ArrayBuffer);
    stlBytes = Buffer.alloc(0);
    const directPositionsHash = hashPositions(directImport.importedMesh!.positions);
    const directLocalAudit = (() => {
      const local = meshForShape({ ...directImport, x: 0, z: 0 });
      return auditManufacturingMesh(local);
    })();
    const stlHashAfter = await hashFile(stlFixture);
    const lylHashAfter = await hashFile(lylFixture);
    const summary = {
      stlFixture,
      lylFixture,
      outputDir,
      inputHashes: {
        stlSha256Before: stlHashBefore,
        stlSha256After: stlHashAfter,
        lylSha256Before: lylHashBefore,
        lylSha256After: lylHashAfter,
      },
      capturedLylShape,
      directStlImporter: {
        name: directImport.name,
        position: [directImport.x, directImport.z, directImport.elevation ?? 0],
        dimensions: [directImport.width, directImport.height, directImport.depth],
        sourceTriangles: directImport.importedMesh!.triangleCount,
        positionCount: directImport.importedMesh!.positions.length,
        positionsSha256: directPositionsHash,
        matchesCapturedLylPositions:
          directPositionsHash === capturedLylShape.shape.positionsSha256,
        localAudit: directLocalAudit,
      },
    };
    const reportPath = path.join(outputDir, "encoding-trace.json");
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));

    expect(stlHashAfter).toBe(stlHashBefore);
    expect(lylHashAfter).toBe(lylHashBefore);
    console.log(`Import encoding report: ${reportPath}`);
  },
  150_000,
);
