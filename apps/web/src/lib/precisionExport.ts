import type { ManifoldToplevel, Manifold } from "manifold-3d";
import type { WorkplaneShape } from "@/types/layerling";
import type { StlExportMesh } from "@/lib/stlExport";
import { exportMeshesToStl } from "@/lib/stlExport";
import { exportMeshesTo3mf } from "@/lib/threemfExport";
import {
  combineSurfaceVerdicts,
  contactVerdict,
  type VerificationVerdict,
} from "@/lib/manufacturingVerdict";
import {
  auditManufacturingMesh,
  type ManufacturingAudit,
} from "@/lib/manufacturingMesh";
import { repairManufacturingMesh } from "@/lib/meshManufacturingRepair";
import {
  DEFAULT_PRECISION,
  validatePrecisionSettings,
  meshTriangleMetrics,
  subdivideManufacturingMesh,
  improvePlanarAspect,
  type PrecisionSettings,
} from "@/lib/precisionMesh";
import {
  sampledMeshDeviation,
  smoothManufacturingMesh,
  manufacturingSurfaceChecks,
} from "@/lib/meshManufacturingQa";
import { meshForShape } from "@/lib/editorMeshCore";
import { analyticMeshForExport } from "@/lib/stepExport";
import {
  assertKnownPrecisionSourceBudget,
  BoundedLruCache,
  retainedMeshBytes,
  precisionWorkingBytes,
} from "@/lib/precisionResource";
import { isNonSolidShape } from "@/lib/workplaneShapes";

export type PrecisionFormat = "stl" | "3mf";
type ExportMesh = StlExportMesh & { name: string; color?: string };
export type PrecisionBodyReport = {
  name: string;
  representation: "analytic" | "mesh";
  sourceTriangles: number;
  triangles: number;
  audit: ManufacturingAudit;
  encoding: {
    coordinates: "float32" | "float64";
    maxVertexDisplacementMm: number;
    topologyBeforeEncoding: ManufacturingAudit | null;
    introducedTopologyDefects: boolean;
  };
  metrics: ReturnType<typeof meshTriangleMetrics>;
  analyticDeviationMm: number | null;
  analyticNormalDeviationDeg: number | null;
  sourceNormalDeviationDeg: number;
  sourceDeviationMm: number;
  totalDeviationBudgetMm: number;
  deviationSamples: number;
  analyticSamples: number;
  repair: null | {
    sampledDeviationMm: number;
    maxDeviationMm: number;
    separatedVertices: number;
  };
  surface: ReturnType<typeof manufacturingSurfaceChecks>;
  warnings: string[];
};
export type PrecisionReport = {
  version: 1;
  units: "mm";
  settings: PrecisionSettings;
  format: PrecisionFormat;
  triangles: number;
  fileBytes: number;
  estimatedWorkingMiB: number;
  durationMs: number;
  cacheHits: number;
  ready: boolean;
  /** Does not certify sampled thickness or global surface approximation. */
  verification: VerificationVerdict;
  bodies: PrecisionBodyReport[];
  warnings: string[];
  limitations: string[];
};
export type PrecisionResult = {
  report: PrecisionReport;
  bytes: Uint8Array | null;
  preview: { before: Float32Array; after: Float32Array };
};

/** Worker-owned cache: exact export tessellation only. Never caches or reruns a hollow operation. */
export class PrecisionExportEngine {
  private cache = new BoundedLruCache<
    NonNullable<Awaited<ReturnType<typeof analyticMeshForExport>>>
  >(256 * 1024 ** 2, 12, (value) => retainedMeshBytes(value.mesh));
  private last: { key: string; result: PrecisionResult } | null = null;
  constructor(private runtime: ManifoldToplevel) {}
  async run(
    shapes: readonly WorkplaneShape[],
    format: PrecisionFormat,
    settings: PrecisionSettings = DEFAULT_PRECISION,
    onProgress: (s: string) => void = () => {},
  ): Promise<PrecisionResult> {
    validatePrecisionSettings(settings);
    assertKnownPrecisionSourceBudget(shapes, settings.triangleBudget);
    const started = performance.now();
    let cacheHits = 0;
    const jobKey = JSON.stringify([shapes, format, settings]);
    if (this.last?.key === jobKey) {
      onProgress("Reusing unchanged export preview and checks");
      const result = structuredClone(this.last.result);
      result.report.cacheHits++;
      result.report.durationMs = performance.now() - started;
      return result;
    }
    // A different job cannot reuse the prior file cache; release it before allocating new geometry.
    this.last = null;
    const visible = shapes.filter((s) => !s.hidden && !isNonSolidShape(s));
    const sources: {
      shape: WorkplaneShape;
      mesh: ExportMesh;
      analytic: Awaited<ReturnType<typeof analyticMeshForExport>>;
    }[] = [];
    let sourceTriangles = 0;
    for (const shape of visible) {
      if (sourceTriangles >= settings.triangleBudget)
        throw new Error(
          "Combined source/cutter geometry exhausted the selected triangle working budget before further tessellation",
        );
      onProgress(`Preparing ${shape.name}`);
      const cacheable =
        shape.kind !== "mesh" ||
        shape.cadBrep ||
        shape.importedMesh?.brepStep ||
        shape.groupedShapes?.length;
      const key = cacheable
        ? JSON.stringify([shape, settings.deviationMm, settings.angleDeg])
        : "";
      let analytic: Awaited<ReturnType<typeof analyticMeshForExport>>;
      const cached = cacheable ? this.cache.get(key) : undefined;
      if (cached) {
        analytic = cached;
        cacheHits++;
      } else {
        analytic = await analyticMeshForExport(
          shape,
          settings.deviationMm,
          settings.angleDeg,
          onProgress,
          settings.triangleBudget - sourceTriangles,
        );
        if (cacheable && analytic) this.cache.set(key, analytic);
      }
      const mesh = {
        ...(analytic?.mesh ?? meshForShape(shape)),
        name: shape.name,
        color: shape.color,
      };
      sourceTriangles += mesh.faces.length;
      if (sourceTriangles > settings.triangleBudget)
        throw new Error(
          `Combined source/cutter geometry exceeds the selected ${settings.triangleBudget.toLocaleString()} triangle working budget`,
        );
      sources.push({ shape, mesh, analytic });
    }
    const solids = sources.filter((s) => !s.shape.hole),
      holes = sources.filter((s) => s.shape.hole);
    if (!solids.length)
      throw new Error("Select at least one solid body for precision export");
    for (const hole of holes) {
      onProgress(`Validating cutter ${hole.shape.name}`);
      const audit = auditManufacturingMesh(hole.mesh, format === "stl");
      if (!audit.valid)
        throw new Error(
          `Cutter "${hole.shape.name}" is not a closed, consistently oriented manifold solid. Repair the cutter explicitly before subtraction; missing cutter geometry will not be inferred.`,
        );
      const surface = manufacturingSurfaceChecks(
        hole.mesh,
        true,
        0,
        audit.shellSeeds,
      );
      if (
        surface.selfIntersections.found ||
        !surface.selfIntersections.complete ||
        surface.shellOrientationConcerns
      )
        throw new Error(
          `Cutter "${hole.shape.name}" has intersecting or unverified surfaces and cannot be safely subtracted`,
        );
    }
    const bodies: PrecisionBodyReport[] = [],
      meshes: ExportMesh[] = [];
    for (const source of solids) {
      onProgress(`Checking ${source.shape.name}`);
      let mesh: StlExportMesh = source.mesh;
      const warnings: string[] = [];
      let repair: PrecisionBodyReport["repair"] = null;
      if (source.analytic?.numericalFacetsRemoved)
        warnings.push(
          `Analytic tessellation stitched ${source.analytic.numericalFacetsRemoved} numerical pole/seam facets; maximum vertex movement ${source.analytic.numericalStitchMm} mm, included in its reported deviation. The exact B-rep is unchanged.`,
        );
      const inputAudit = auditManufacturingMesh(mesh, format === "stl");
      if (!inputAudit.valid && settings.repair) {
        onProgress(`Previewing bounded repair: ${source.shape.name}`);
        const fixed = repairManufacturingMesh(
          this.runtime,
          mesh,
          settings.repairDeviationMm,
        );
        mesh = fixed.mesh;
        repair = {
          sampledDeviationMm: fixed.sampledDeviationMm,
          maxDeviationMm: fixed.maxDeviationMm,
          separatedVertices: fixed.separatedVertices,
        };
      }
      if (holes.length && auditManufacturingMesh(mesh).valid) {
        onProgress(`Cutting explicit hole bodies: ${source.shape.name}`);
        const owned: Manifold[] = [];
        try {
          const make = (m: StlExportMesh) => {
            const input = new this.runtime.Mesh({
              numProp: 3,
              vertProperties: Float32Array.from(m.vertices.flat()),
              triVerts: Uint32Array.from(m.faces.flat()),
              tolerance: 1e-6,
            });
            input.merge();
            const solid = this.runtime.Manifold.ofMesh(input);
            owned.push(solid);
            if (solid.status() !== "NoError" || solid.isEmpty())
              throw new Error(
                "A Boolean operand could not be represented as a closed solid at the engine's coordinate precision",
              );
            return solid;
          };
          const body = make(mesh),
            tools = holes.map((h) => make(h.mesh)),
            cut = body.subtract(
              tools.length === 1
                ? tools[0]
                : (() => {
                    const u = this.runtime.Manifold.union(tools);
                    owned.push(u);
                    return u;
                  })(),
            );
          owned.push(cut);
          if (cut.status() !== "NoError" || cut.isEmpty())
            throw new Error(
              "Hole subtraction failed or removed the whole body",
            );
          const out = cut.getMesh();
          mesh = {
            vertices: Array.from({ length: out.numVert }, (_, i) => [
              out.vertProperties[i * out.numProp],
              out.vertProperties[i * out.numProp + 1],
              out.vertProperties[i * out.numProp + 2],
            ]),
            faces: Array.from(
              { length: out.numTri },
              (_, i) =>
                Array.from(out.triVerts.subarray(i * 3, i * 3 + 3)) as [
                  number,
                  number,
                  number,
                ],
            ),
          };
        } finally {
          owned.forEach((s) => s.delete());
        }
      } else if (holes.length)
        warnings.push(
          "Hole subtraction was blocked by invalid source topology.",
        );
      const reference = mesh;
      if (auditManufacturingMesh(mesh).valid) {
        if (settings.smoothing && source.analytic)
          warnings.push(
            "Mesh smoothing was skipped for this analytic body; the exact reference takes priority.",
          );
        mesh = smoothManufacturingMesh(
          mesh,
          source.analytic ? 0 : settings.smoothing,
          settings.sharpAngleDeg,
          settings.deviationMm,
        );
        mesh = improvePlanarAspect(mesh, settings.aspectTarget).mesh;
        mesh = subdivideManufacturingMesh(
          mesh,
          settings.maxEdgeMm,
          settings.triangleBudget,
        );
      }
      // Validate actual encoding coordinates: 3MF uses full-precision decimals;
      // binary STL uses float32.
      let encodingMaxSquared = 0;
      const encodedMesh = {
        vertices: mesh.vertices.map((p) => {
          const x = format === "stl" ? Math.fround(p[0]) : p[0];
          const y = format === "stl" ? Math.fround(p[1]) : p[1];
          const z = format === "stl" ? Math.fround(p[2]) : p[2];
          encodingMaxSquared = Math.max(
            encodingMaxSquared,
            (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2,
          );
          return [x, y, z] as [number, number, number];
        }),
        faces: mesh.faces,
      };
      const audit = auditManufacturingMesh(encodedMesh);
      const metrics = meshTriangleMetrics(encodedMesh);
      // Diagnose a lossy encoding without moving/rebasing or silently repairing.
      // The extra raw audit is only needed for an invalid float32 result.
      const topologyBeforeEncoding =
        format === "stl" && !audit.valid ? auditManufacturingMesh(mesh) : null;
      const introducedTopologyDefects = Boolean(
        topologyBeforeEncoding?.valid && !audit.valid,
      );
      const encodingMaxDisplacementMm = Math.sqrt(encodingMaxSquared);
      if (introducedTopologyDefects) {
        warnings.push(
          `Binary STL float32 encoding changed topology at this placement: ${topologyBeforeEncoding!.vertices - audit.vertices} unique vertices merged; ${audit.degenerateFaces} degenerate faces. The STL copy is blocked. Try full-precision 3MF or change placement and validate again.`,
        );
      }
      if (
        meshes.reduce((n, m) => n + m.faces.length, 0) + mesh.faces.length >
        settings.triangleBudget
      )
        throw new Error(
          "Combined output exceeds the selected triangle resource budget",
        );
      onProgress(`Validating surfaces and thickness: ${source.shape.name}`);
      const surface = manufacturingSurfaceChecks(
        encodedMesh,
        settings.selfIntersections,
        settings.minWallMm,
        audit.valid ? audit.shellSeeds : [],
      );
      warnings.push(...surface.notes);
      if (audit.shells > 1)
        warnings.push(
          `${audit.shells} closed surface shells detected; inspect components and cavities in the preview.`,
        );
      if (metrics.maxAspectRatio > settings.aspectTarget)
        warnings.push(
          `Aspect target ${settings.aspectTarget} not achieved (maximum ${metrics.maxAspectRatio.toFixed(2)}); sharp features and source surface take priority.`,
        );
      const needsMeasurement = settings.smoothing > 0 || format === "stl";
      const forward = needsMeasurement
          ? sampledMeshDeviation(reference, encodedMesh)
          : { mm: 0, samples: 0, normalDeg: 0 },
        reverse = needsMeasurement
          ? sampledMeshDeviation(encodedMesh, reference)
          : { mm: 0, samples: 0, normalDeg: 0 };
      const sourceDeviationMm = Math.max(
        forward.mm,
        reverse.mm,
        encodingMaxDisplacementMm,
      );
      const sourceNormalDeviationDeg = settings.smoothing
        ? Math.max(forward.normalDeg, reverse.normalDeg)
        : 0;
      const analyticDeviation = source.analytic
        ? Math.max(
            source.analytic.sampledDeviationMm,
            ...holes.map((h) => h.analytic?.sampledDeviationMm ?? 0),
          )
        : null;
      const analyticAngle = source.analytic
        ? Math.max(
            source.analytic.sampledNormalDeviationDeg,
            ...holes.map((h) => h.analytic?.sampledNormalDeviationDeg ?? 0),
          )
        : null;
      const totalDeviationBudgetMm =
        (analyticDeviation ?? 0) +
        sourceDeviationMm +
        (repair?.maxDeviationMm ?? 0);
      if (sourceDeviationMm > settings.deviationMm)
        warnings.push(
          "Measured mesh deviation exceeds the requested surface tolerance.",
        );
      if (analyticAngle !== null && analyticAngle > settings.angleDeg)
        warnings.push(
          `Requested normal limit ${settings.angleDeg} degrees was not achieved; measured ${analyticAngle.toFixed(5)} degrees. OCCT refinement stalled; no extra triangles were added solely to inflate density.`,
        );
      if (source.analytic && holes.some((h) => !h.analytic))
        warnings.push(
          "A mesh cutter has no analytic reference; fidelity of that cut is limited to its stored facets.",
        );
      if (sourceNormalDeviationDeg > settings.angleDeg)
        warnings.push(
          "Smoothing exceeded the requested sampled normal change from the source mesh.",
        );
      if (totalDeviationBudgetMm > settings.deviationMm)
        warnings.push(
          "Combined analytic, repair and encoding deviation budget exceeds the requested surface deviation.",
        );
      bodies.push({
        name: source.shape.name,
        representation: source.analytic ? "analytic" : "mesh",
        sourceTriangles: source.mesh.faces.length,
        triangles: mesh.faces.length,
        audit,
        encoding: {
          coordinates: format === "stl" ? "float32" : "float64",
          maxVertexDisplacementMm: encodingMaxDisplacementMm,
          topologyBeforeEncoding,
          introducedTopologyDefects,
        },
        metrics,
        analyticDeviationMm: analyticDeviation,
        analyticNormalDeviationDeg: analyticAngle,
        sourceNormalDeviationDeg,
        sourceDeviationMm,
        totalDeviationBudgetMm,
        deviationSamples: forward.samples + reverse.samples,
        analyticSamples:
          (source.analytic?.samples ?? 0) +
          holes.reduce((n, h) => n + (h.analytic?.samples ?? 0), 0),
        repair,
        surface,
        warnings,
      });
      meshes.push({
        ...encodedMesh,
        name: source.shape.name,
        color: source.shape.color,
      });
    }
    onProgress("Checking separate bodies");
    let crossBodyVerification: VerificationVerdict | null = null;
    // Cross-body overlap/contact is checked together; STL does not carry object identity.
    if (meshes.length > 1) {
      const combined = combineMeshes(meshes);
      const surface = manufacturingSurfaceChecks(
        combined,
        settings.selfIntersections,
        0,
      );
      crossBodyVerification = surface.selfIntersections.verification;
      if (
        surface.selfIntersections.found ||
        !surface.selfIntersections.complete
      ) {
        bodies[0].warnings.push(
          "Separate bodies overlap or cross-body intersection checking was incomplete; combine or separate them explicitly before export",
        );
      }
      if (surface.selfIntersections.found) {
        bodies[0].surface.selfIntersections.found +=
          surface.selfIntersections.found;
      }
      if (!surface.selfIntersections.complete) {
        bodies[0].surface.selfIntersections.complete = false;
      }
      bodies[0].surface.selfIntersections.verification = contactVerdict(
        bodies[0].surface.selfIntersections.found,
        bodies[0].surface.selfIntersections.complete,
        "Cross-body contact search incomplete",
      );
    }
    const fileTopologyValid =
      format !== "stl" || auditManufacturingMesh(combineMeshes(meshes)).valid;
    if (!fileTopologyValid)
      bodies[0].warnings.push(
        "Combined STL topology is not manifold; separate touching bodies or combine them explicitly.",
      );
    const integrityPassed =
      fileTopologyValid &&
      bodies.every(
        (b) =>
          b.audit.valid &&
          !b.surface.selfIntersections.found &&
          b.totalDeviationBudgetMm <= settings.deviationMm &&
          b.sourceNormalDeviationDeg <= settings.angleDeg &&
          (b.analyticNormalDeviationDeg === null ||
            b.analyticNormalDeviationDeg <= settings.angleDeg),
      ) &&
      !(
        holes.length &&
        bodies.some((b) =>
          b.warnings.some((w) => w.startsWith("Hole subtraction")),
        )
      );
    const ready =
      integrityPassed &&
      bodies.every(
        (b) =>
          b.surface.selfIntersections.complete &&
          !b.surface.wallConcern &&
          !b.surface.shellOrientationConcerns &&
          b.audit.solidComponents === 1,
      );
    onProgress(
      ready
        ? "Encoding validated manufacturing mesh"
        : "Preview contains manufacturing concerns",
    );
    const bytes = integrityPassed
      ? format === "stl"
        ? new Uint8Array(exportMeshesToStl(meshes))
        : exportMeshesTo3mf(meshes, { precision: true })
      : null;
    const triangles = meshes.reduce((n, m) => n + m.faces.length, 0);
    const result: PrecisionResult = {
      bytes,
      preview: {
        before: previewPositions(solids.map((s) => s.mesh)),
        after: previewPositions(meshes),
      },
      report: {
        version: 1,
        units: "mm",
        settings: { ...settings },
        format,
        triangles,
        fileBytes:
          bytes?.byteLength ??
          (format === "stl" ? 84 + triangles * 50 : triangles * 40),
        estimatedWorkingMiB: Math.ceil(
          precisionWorkingBytes(triangles) / 1024 ** 2,
        ),
        durationMs: performance.now() - started,
        cacheHits,
        ready,
        verification: combineSurfaceVerdicts(
          fileTopologyValid && bodies.every((b) => b.audit.valid),
          [
            ...bodies.map((b) => b.surface.selfIntersections.verification),
            ...(crossBodyVerification ? [crossBodyVerification] : []),
          ],
        ),
        bodies,
        warnings: bodies.flatMap((b) => b.warnings),
        limitations: [
          "Deviation is sampled at vertices, edge midpoints and centroids; it is not a global Hausdorff certificate.",
          "Analytic normal angles are sampled from closest-surface centroid displacement where it exceeds 0.00001 mm numerical noise; these do not certify a global maximum. Requested angular deflection is also supplied to OCCT.",
          "Mesh subdivision preserves the existing faceted surface and cannot recover an unavailable original surface.",
          "The surface verdict covers topology and bounded adaptive exact-sign contact tests on encoded coordinates. Incomplete checks remain inconclusive; wall thickness, containment and fidelity requirements are reported separately.",
          "Thickness is sampled using inward normal rays, not a global minimum-wall certificate. Acute edges can produce conservative warnings.",
          "Repair is an explicit preview that changes export geometry only; the project and exact B-reps remain unchanged.",
        ],
      },
    };
    // Keep at most one encoded result and at most 256 MiB of file cache in this studio.
    // Clone before transfer so worker ownership cannot detach the cached buffers.
    const retainedResultBytes =
      (bytes?.byteLength ?? 0) +
      jobKey.length * 2 +
      result.preview.before.byteLength +
      result.preview.after.byteLength +
      JSON.stringify(result.report).length * 2;
    this.last =
      retainedResultBytes <= 256 * 1024 ** 2
        ? { key: jobKey, result: structuredClone(result) }
        : null;
    return result;
  }
}
function previewPositions(meshes: readonly StlExportMesh[]) {
  const positions: number[] = [];
  for (const mesh of meshes) {
    const stride = Math.max(1, Math.ceil(mesh.faces.length / 2000));
    for (let i = 0; i < mesh.faces.length; i += stride)
      for (const j of mesh.faces[i]) positions.push(...mesh.vertices[j]);
  }
  return Float32Array.from(positions);
}
function combineMeshes(meshes: readonly StlExportMesh[]): StlExportMesh {
  const vertices: [number, number, number][] = [],
    faces: [number, number, number][] = [];
  for (const mesh of meshes) {
    const offset = vertices.length;
    for (const p of mesh.vertices) vertices.push([...p]);
    for (const f of mesh.faces)
      faces.push(f.map((i) => i + offset) as [number, number, number]);
  }
  return { vertices, faces };
}
