import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { exportMeshesToStl, type StlExportMesh } from "@/lib/stlExport";
import { exportMeshesTo3mf } from "@/lib/threeMfExport";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";

const fixture = process.env.LAYERLING_OFFSET_EXPORT_DIR;
it.skipIf(!fixture)("records actual STL and precision 3MF encoding integrity of the isolated offset result", () => {
  const started = performance.now();
  const require = createRequire(import.meta.url);
  const { decodeResult } = require("../../desktop/native-geometry-protocol.cjs");
  const bytes = readFileSync(path.join(fixture!, "result.mesh.bin"));
  const decoded = decodeResult(bytes);
  const mesh: StlExportMesh = {
    vertices: Array.from({ length: decoded.positions.length / 3 }, (_, i) => [decoded.positions[i*3], decoded.positions[i*3+1], decoded.positions[i*3+2]] as [number, number, number]),
    faces: Array.from({ length: decoded.indices.length / 3 }, (_, i) => [decoded.indices[i*3], decoded.indices[i*3+1], decoded.indices[i*3+2]] as [number, number, number]),
  };
  const stlAudit = auditManufacturingMesh(mesh, true);
  const threeMfAudit = auditManufacturingMesh(mesh, false);
  const stl = exportMeshesToStl([mesh]);
  const threeMf = exportMeshesTo3mf([{ ...mesh, name: "Isolated OpenVDB cavity experiment" }], { precision: true });
  writeFileSync(path.join(fixture!, "result.stl"), new Uint8Array(stl));
  writeFileSync(path.join(fixture!, "result.3mf"), threeMf);
  writeFileSync(path.join(fixture!, "encoding-integrity.json"), JSON.stringify({
    durationMs: performance.now() - started,
    sourceTriangles: mesh.faces.length, stlTriangles: new DataView(stl).getUint32(80, true),
    stlBytes: stl.byteLength, threeMfBytes: threeMf.byteLength,
    stlCoordinateAudit: stlAudit, threeMfCoordinateAudit: threeMfAudit,
    label: "Experimental artifact; manufacturing readiness requires complete independent reimport/contact checks",
  }, null, 2));
  expect(threeMfAudit.valid).toBe(true);
  expect(stlAudit.valid).toBe(true);
}, 150_000);
