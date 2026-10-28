import { useEffect, useRef, useState } from "react";
import type { WorkplaneShape } from "@/types/layerling";
import {
  DEFAULT_PRECISION,
  PRECISION_PRESETS,
  type PrecisionSettings,
} from "@/lib/precisionMesh";
import { PrecisionExportSession } from "@/lib/precisionExportWorker";
import type { PrecisionResult, PrecisionFormat } from "@/lib/precisionExport";
import { projectExportFileName } from "@/lib/exportNames";
import { precisionWorkingBytes } from "@/lib/precisionResource";
import "./PrecisionMeshStudio.css";

type Props = {
  shapes: readonly WorkplaneShape[];
  format: PrecisionFormat;
  name: string;
  onDeliver: (name: string, bytes: Uint8Array, type: string) => Promise<void>;
};
export function PrecisionMeshStudio({
  shapes,
  format,
  name,
  onDeliver,
}: Props) {
  const [settings, setSettings] = useState<PrecisionSettings>({
    ...DEFAULT_PRECISION,
  });
  const [result, setResult] = useState<PrecisionResult | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const session = useRef<PrecisionExportSession | null>(null),
    controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const update = (patch: Partial<PrecisionSettings>) =>
    setSettings((s) => ({ ...s, ...patch, preset: "custom" }));
  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setResult(null);
    setAcknowledged(false);
    setError("");
    setProgress("");
  }, [settings, shapes, format]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
      session.current?.dispose();
    },
    [],
  );
  const run = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const current = ++generation.current;
    session.current ??= new PrecisionExportSession();
    setBusy(true);
    setError("");
    setResult(null);
    setProgress("Starting isolated export worker");
    try {
      const next = await session.current.run(
        shapes,
        format,
        settings,
        abort.signal,
        (text) => {
          if (current === generation.current) setProgress(text);
        },
      );
      if (current === generation.current) {
        setResult(next);
        setProgress(
          next.report.ready
            ? "Manufacturing checks passed"
            : "Preview has concerns; review the report",
        );
      }
    } catch (e) {
      if (current === generation.current) {
        setError(e instanceof Error ? e.message : String(e));
        setProgress("");
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const deliver = async (reportOnly = false) => {
    if (!result) return;
    try {
      await onDeliver(
        reportOnly
          ? projectExportFileName(name, "stl").replace(
              /\.stl$/i,
              ".mesh-report.json",
            )
          : projectExportFileName(name, format),
        reportOnly
          ? new TextEncoder().encode(JSON.stringify(result.report, null, 2))
          : result.bytes!,
        reportOnly
          ? "application/json"
          : format === "stl"
            ? "model/stl"
            : "model/3mf",
      );
      setProgress(
        reportOnly ? "Manufacturing report saved" : "Validated mesh exported",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const field = (
    key: keyof PrecisionSettings,
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="precision-field" key={key}>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={settings[key] as number}
        onChange={(e) => update({ [key]: e.target.valueAsNumber })}
      />
    </label>
  );
  return (
    <section className="precision-studio" aria-label="Precision Mesh Studio">
      <div>
        <strong>Precision Mesh Studio</strong>
        <p>
          Local manufacturing export · millimeters · independent of viewport
          detail
        </p>
      </div>
      <label className="precision-field">
        Quality preset
        <select
          aria-label="Mesh quality preset"
          value={settings.preset}
          onChange={(e) => {
            const preset = e.target.value as PrecisionSettings["preset"];
            setSettings((s) => ({
              ...s,
              ...(preset === "custom" ? {} : PRECISION_PRESETS[preset]),
              preset,
            }));
          }}
        >
          <option value="standard">Standard</option>
          <option value="high">High</option>
          <option value="ultra">Ultra</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <div className="precision-grid">
        {field(
          "deviationMm",
          "Maximum surface deviation (mm)",
          0.00001,
          10,
          0.001,
        )}
        {field("angleDeg", "Maximum normal deviation (degrees)", 0.1, 90, 0.5)}
        {field(
          "maxEdgeMm",
          "Maximum edge length (mm; 0 = unrestricted)",
          0,
          10000,
          0.1,
        )}
        {field(
          "aspectTarget",
          "Aspect ratio target (planar optimization)",
          1,
          1000,
          1,
        )}
        {field(
          "smoothing",
          "Mesh smoothing strength (0 = preserve)",
          0,
          0.5,
          0.05,
        )}
        {field(
          "sharpAngleDeg",
          "Preserve features sharper than (degrees)",
          1,
          179,
          1,
        )}
        {field(
          "triangleBudget",
          "Triangle resource budget",
          1000,
          12000000,
          100000,
        )}
        {field("minWallMm", "Minimum wall concern threshold (mm)", 0, 100, 0.1)}
      </div>
      <p>
        Exact bodies use adaptive OCCT tessellation. Mesh subdivision retains
        the source facets; extra triangles cannot recover an unknown original
        surface. Smoothing changes the export surface and preserves detected
        sharp edges.
      </p>
      <label className="precision-check">
        <input
          type="checkbox"
          checked={settings.repair}
          onChange={(e) => update({ repair: e.target.checked })}
        />{" "}
        Preview bounded mesh repair (export copy only)
      </label>
      {settings.repair
        ? field(
            "repairDeviationMm",
            "Repair deviation budget (mm)",
            0.000001,
            0.1,
            0.00001,
          )
        : null}
      <label className="precision-check">
        <input
          type="checkbox"
          checked={settings.selfIntersections}
          onChange={(e) => update({ selfIntersections: e.target.checked })}
        />{" "}
        Check self-intersections (bounded BVH search)
      </label>
      <p>
        Resource estimate: about{" "}
        {Math.ceil(
          (precisionWorkingBytes(settings.triangleBudget) / 1024 ** 3) * 10,
        ) / 10}{" "}
        GiB working memory at the selected budget, including kernel overhead.
        The resource budget covers prepared source bodies, cutters and final output.
        Binary STL uses 50 bytes per triangle plus 84 bytes. Processing and
        compression run in a cancelable worker.
      </p>
      <div className="precision-buttons">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !shapes.length}
        >
          Generate export preview
        </button>
        {busy ? (
          <button type="button" onClick={() => controller.current?.abort()}>
            Cancel export
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite">
        {progress}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <div
          className="precision-results"
          data-ready={String(result.report.ready)}
        >
          <strong>
            {result.report.ready
              ? "Manufacturing checks passed"
              : result.bytes
                ? "Topological checks passed; manufacturing review required"
                : "Manufacturing concerns — export blocked"}
          </strong>
          <p>
            {result.report.triangles.toLocaleString()} triangles ·{" "}
            {(result.report.fileBytes / 1024 ** 2).toFixed(2)} MiB{" "}
            {result.bytes ? "encoded" : "predicted"} ·{" "}
            {(result.report.durationMs / 1000).toFixed(2)} s ·{" "}
            {result.report.cacheHits} cached sources reused
          </p>
          <PrecisionPreview preview={result.preview} />
          {result.report.bodies.map((body, i) => (
            <details key={i} open>
              <summary>
                {body.name} ·{" "}
                {body.representation === "analytic"
                  ? "analytic B-rep reference"
                  : "source mesh reference"}
              </summary>
              <p>
                {body.audit.dimensionsMm.map((x) => x.toFixed(4)).join(" × ")}{" "}
                mm (X/Y/Z editor axes), {body.audit.signedVolumeMm3.toFixed(3)}{" "}
                mm³, {body.audit.solidComponents} positive solid components and{" "}
                {body.audit.cavityShells} cavity shells
              </p>
              <p>
                Boundary edges {body.audit.boundaryEdges}; non-manifold edges{" "}
                {body.audit.nonManifoldEdges}; non-manifold vertices{" "}
                {body.audit.nonManifoldVertices}; winding errors{" "}
                {body.audit.windingMismatches}; zero-area faces{" "}
                {body.audit.degenerateFaces}; duplicate faces{" "}
                {body.audit.duplicateFaces}; tiny nonzero faces{" "}
                {body.audit.smallFaces - body.audit.degenerateFaces}.
              </p>
              <p>
                Maximum edge {body.metrics.maxEdgeMm.toPrecision(5)} mm; maximum
                aspect {body.metrics.maxAspectRatio.toPrecision(4)}.{" "}
                {body.analyticDeviationMm !== null
                  ? `Sampled analytic deviation ${body.analyticDeviationMm.toPrecision(5)} mm; normal deviation ${body.analyticNormalDeviationDeg?.toPrecision(4)}°.`
                  : "Analytic fidelity is unavailable for this mesh."}{" "}
                Sampled processing/encoding deviation{" "}
                {body.sourceDeviationMm.toPrecision(5)} mm.
              </p>
              {body.repair ? (
                <p>
                  Explicit repair preview: sampled source deviation{" "}
                  {body.repair.sampledDeviationMm.toPrecision(5)} mm (budget{" "}
                  {body.repair.maxDeviationMm} mm);{" "}
                  {body.repair.separatedVertices} singular vertices separated.
                </p>
              ) : null}
              <p>
                Self-intersections:{" "}
                {body.surface.selfIntersections.found
                  ? "detected"
                  : body.surface.selfIntersections.complete
                    ? "none found in completed search"
                    : "unverified"}
                . Sampled normal-ray wall:{" "}
                {body.surface.minSampledThicknessMm?.toPrecision(5) ??
                  "unavailable"}{" "}
                mm.
              </p>
            </details>
          ))}
          {result.report.warnings.length ? (
            <ul>
              {result.report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary>Measurement limits</summary>
            <ul>
              {result.report.limitations.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
          {!result.report.ready && result.bytes ? (
            <label className="precision-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />{" "}
              I reviewed the manufacturing concerns. Export this copy without
              marking it print-ready.
            </label>
          ) : null}
          <div className="precision-buttons">
            <button
              type="button"
              disabled={
                !result.bytes || busy || (!result.report.ready && !acknowledged)
              }
              onClick={() => void deliver()}
            >
              {result.report.ready ? "Export validated" : "Export reviewed"}{" "}
              {format === "stl" ? "Binary STL" : "3MF"}
            </button>
            <button type="button" onClick={() => void deliver(true)}>
              Save manufacturing report
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PrecisionPreview({
  preview,
}: {
  preview: PrecisionResult["preview"];
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [angle, setAngle] = useState(0.6),
    [before, setBefore] = useState(false);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const p = before ? preview.before : preview.after;
    const points: [number, number][] = [];
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * Math.cos(angle) - p[i + 2] * Math.sin(angle),
        y =
          -p[i + 1] +
          (p[i] * Math.sin(angle) + p[i + 2] * Math.cos(angle)) * 0.25;
      points.push([x, y]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const scale = Math.min(
      (c.width - 24) / (maxX - minX || 1),
      (c.height - 24) / (maxY - minY || 1),
    );
    ctx.fillStyle = "#141b22";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = before ? "#aab2bb" : "#44cce5";
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < points.length; i += 3) {
      ctx.beginPath();
      for (let j = 0; j < 3; j++) {
        const p = points[i + j],
          x = (p[0] - (minX + maxX) / 2) * scale + c.width / 2,
          y = (p[1] - (minY + maxY) / 2) * scale + c.height / 2;
        if (j) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [preview, angle, before]);
  return (
    <figure className="precision-preview">
      <canvas
        ref={canvas}
        width={460}
        height={220}
        aria-label="Lightweight export mesh preview"
      />
      <figcaption>
        Sampled wireframe preview; use the full mesh report to inspect
        integrity.
      </figcaption>
      <label>
        Rotate preview
        <input
          aria-label="Rotate export preview"
          type="range"
          min={-3.14}
          max={3.14}
          step={0.05}
          value={angle}
          onChange={(e) => setAngle(+e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={before}
          onChange={(e) => setBefore(e.target.checked)}
        />{" "}
        Show source before processing
      </label>
    </figure>
  );
}
