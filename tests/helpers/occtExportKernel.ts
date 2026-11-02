import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function occtExportTestKernel(diagnostics?: { body: any }) {
  const brep = await import("brepjs"),
    { OcctKernel } = await import("occt-wasm");
  const kernel = await OcctKernel.init({
    wasm: join(
      dirname(fileURLToPath(import.meta.resolve("occt-wasm"))),
      "occt-wasm.wasm",
    ),
  });
  brep.registerKernel("occt-wasm", brep.OcctWasmAdapter.fromKernel(kernel));
  const proxy = diagnostics
    ? new Proxy(kernel, {
        get(target, key) {
          if (key === "tessellate")
            return (body: any, options: any) => {
              const mesh = target.tessellate(body, options),
                faces = target.getSubShapes(body, "face");
              try {
                if (faces.length > 1) {
                  const grouped = target.meshShape(body, options);
                  if (
                    grouped.indices.length !== mesh.indices.length ||
                    grouped.indices.some((value, i) => value !== mesh.indices[i])
                  )
                    throw new Error(
                      "Diagnostic face-group tessellation changed triangle ordering",
                    );
                  const relations = faces.map((face) => {
                    const neighbors = target.adjacentFaces(body, face);
                    try {
                      return {
                        face: target.hashCode(face, 2147483647),
                        kind: target.surfaceType(face),
                        neighbors: neighbors.map((neighbor) =>
                          target.hashCode(neighbor, 2147483647),
                        ),
                      };
                    } finally {
                      neighbors.forEach((neighbor) => target.release(neighbor));
                    }
                  });
                  diagnostics.body = {
                    valid: target.isValid(body),
                    volume: target.getVolume(body),
                    brep: target.toBREP(body),
                    relations,
                    positions: mesh.positions,
                    indices: mesh.indices,
                    groups: grouped.faceGroups,
                  };
                }
              } finally {
                faces.forEach((face) => target.release(face));
              }
              return mesh;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : kernel;
  return {
    loadBrepWithOcct: async () => brep,
    occtKernel: () => proxy,
  };
}
