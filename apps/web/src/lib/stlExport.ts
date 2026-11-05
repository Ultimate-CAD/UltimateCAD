import { layerlingToZUp, type MeshPoint } from "@/lib/meshCoordinates";

export type StlExportMesh = {
  vertices: readonly MeshPoint[];
  faces: readonly (readonly [number, number, number])[];
};

const STL_HEADER_BYTES = 80;
const STL_TRIANGLE_COUNT_BYTES = 4;
const STL_TRIANGLE_BYTES = 50;
const STL_PREFIX_BYTES = STL_HEADER_BYTES + STL_TRIANGLE_COUNT_BYTES;

function normalFor(a: MeshPoint, b: MeshPoint, c: MeshPoint): [number, number, number] {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function writePoint(view: DataView, offset: number, point: MeshPoint) {
  view.setFloat32(offset, point[0], true);
  view.setFloat32(offset + 4, point[1], true);
  view.setFloat32(offset + 8, point[2], true);
  return offset + 12;
}

export function exportMeshesToStl(meshes: readonly StlExportMesh[], options: { preserveFacets?: boolean; unverified?: boolean } = {}): ArrayBuffer {
  // OCCT can emit collapsed seam facets. Also a nonzero double-precision
  // triangle can collapse when encoded as STL float32. Such facets add zero
  // material but make an otherwise closed surface look non-manifold.
  const printable = meshes.map(mesh => ({ ...mesh, faces: mesh.faces.filter(([ai, bi, ci]) => {
    if (![ai,bi,ci].every(i => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length)) throw new Error("STL export contains invalid face indices");
    const [a,b,c] = [ai,bi,ci].map(index => mesh.vertices[index].map(Math.fround));
    if (![...a,...b,...c].every(Number.isFinite)) throw new Error("STL export contains non-finite coordinates");
    if (options.preserveFacets) return true;
    const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
    const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
    return uy*vz-uz*vy !== 0 || uz*vx-ux*vz !== 0 || ux*vy-uy*vx !== 0;
  }) }));
  const triangleCount = printable.reduce((count, mesh) => count + mesh.faces.length, 0);
  if (triangleCount > 0xffff_ffff) {
    throw new Error("STL export exceeds the binary format's triangle limit");
  }

  const buffer = new ArrayBuffer(STL_PREFIX_BYTES + triangleCount * STL_TRIANGLE_BYTES);
  const bytes = new Uint8Array(buffer);
  const header = new TextEncoder().encode(options.unverified ? "Binary STL - UNVERIFIED (Z-up coordinates, millimeters)" : "Binary STL (Z-up coordinates)");
  bytes.set(header.subarray(0, STL_HEADER_BYTES));

  const view = new DataView(buffer);
  view.setUint32(STL_HEADER_BYTES, triangleCount, true);
  let offset = STL_PREFIX_BYTES;

  printable.forEach((mesh) => {
    mesh.faces.forEach(([ai, bi, ci]) => {
      const a = layerlingToZUp(mesh.vertices[ai]);
      const b = layerlingToZUp(mesh.vertices[bi]);
      const c = layerlingToZUp(mesh.vertices[ci]);
      const n = normalFor(a, b, c);
      offset = writePoint(view, offset, n);
      offset = writePoint(view, offset, a);
      offset = writePoint(view, offset, b);
      offset = writePoint(view, offset, c);
      view.setUint16(offset, 0, true);
      offset += 2;
    });
  });

  return buffer;
}
