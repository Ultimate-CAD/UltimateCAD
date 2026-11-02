import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { unzipSync, strFromU8 } from "fflate";
import { auditManufacturingMesh } from "../../apps/web/src/lib/manufacturingMesh";

export function independentlyReimport(bytes: Uint8Array, format: "stl" | "3mf") {
  let vertices: [number, number, number][],
    faces: [number, number, number][];
  if (format === "stl") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      count = view.getUint32(80, true);
    if (bytes.length !== 84 + count * 50)
      throw new Error("Invalid binary STL byte count");
    const geometry = new STLLoader().parse(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
      p = geometry.attributes.position.array;
    vertices = Array.from({ length: p.length / 3 }, (_, i) => [
      p[i * 3],
      p[i * 3 + 2],
      -p[i * 3 + 1],
    ]);
    faces = Array.from({ length: p.length / 9 }, (_, i) => [
      i * 3,
      i * 3 + 1,
      i * 3 + 2,
    ]);
    geometry.dispose();
  } else {
    const xml = strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);
    if (!/unit="millimeter"/.test(xml))
      throw new Error("Incorrect 3MF units");
    vertices = [
      ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g),
    ].map((match) => [+match[1], +match[3], -match[2]]);
    faces = [
      ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
    ].map((match) => [+match[1], +match[2], +match[3]]);
  }
  return {
    audit: auditManufacturingMesh({ vertices, faces }),
    mesh: { vertices, faces },
  };
}
