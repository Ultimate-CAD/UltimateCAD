"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { WorkplaneShape } from "@/types/layerling";
import type { HollowCut } from "@/lib/hollowFinishing";
import { finishingSourcePositions } from "@/lib/hollowFinishingShape";
import {
  BUILD_ID,
  buildsDiffer,
  isBuildMessage,
  reportWorkerBuild,
} from "@/lib/buildStamp";

type Props = {
  shape: WorkplaneShape;
  onApply: (positions: Float64Array) => void;
  onCancel: () => void;
};
type Result = {
  positions: Float64Array;
  stats: Record<string, number | boolean>;
  audit: { dimensionsMm: number[] };
  surface: { notes: string[] };
  encodedSurface: { notes: string[] };
};
type View = {
  cut: (cut: HollowCut) => void;
  result: (
    positions: Float64Array,
    rimTriangles: number,
    cacheHit: boolean,
  ) => void;
  restore: () => void;
};

const noUiTrace = () => {};
function startUiTrace(name: string) {
  if (
    !(window as Window & { __layerlingGeometryDiagnostics?: boolean })
      .__layerlingGeometryDiagnostics
  )
    return noUiTrace;
  const start = performance.now();
  return () =>
    performance.measure(`layerling.finishing.${name}`, {
      start,
      end: performance.now(),
    });
}

export function HollowFinishingPanel({ shape, onApply, onCancel }: Props) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<View | null>(null),
    worker = useRef<Worker | null>(null);
  const revision = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cut, setCut] = useState<HollowCut>({
    axis: 1,
    position: shape.height * 0.15,
    keepPositive: true,
  });
  const currentCut = useRef(cut);
  currentCut.current = cut;
  const [bounds, setBounds] = useState<number[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Initializing closed mesh"),
    [error, setError] = useState(""),
    [result, setResult] = useState<Result | null>(null);

  const stop = () => {
    revision.current++;
    clearTimeout(timer.current);
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    setReady(false);
    setResult(null);
  };
  const startWorker = () => {
    worker.current?.terminate();
    clearTimeout(timer.current);
    const request = ++revision.current;
    setReady(false);
    setBusy(false);
    setStatus("Initializing closed mesh");
    setError("");
    let instance: Worker;
    try {
      instance = new Worker(
        new URL("../../workers/hollowFinishing.worker.ts", import.meta.url),
        { type: "module", name: "layerling-hollow-finishing" },
      );
    } catch (e) {
      setError(String(e));
      return;
    }
    worker.current = instance;
    const fail = (message: string) => {
      if (worker.current !== instance) return;
      instance.terminate();
      worker.current = null;
      clearTimeout(timer.current);
      setReady(false);
      setBusy(false);
      setResult(null);
      setError(message);
      setStatus("Source retained");
    };
    timer.current = setTimeout(
      () =>
        fail(
          "Finishing worker timed out after 180 seconds. Source retained; retry or Cancel.",
        ),
      180000,
    );
    instance.onerror = (event) =>
      fail(event.message || "Finishing worker failed; source retained");
    instance.onmessage = ({ data }) => {
      if (worker.current !== instance) return;
      if (isBuildMessage(data)) {
        reportWorkerBuild(data);
        if (buildsDiffer(BUILD_ID, data.build))
          fail("Worker build differs from editor. Reload before finishing.");
        return;
      }
      if (data.revision !== revision.current) return;
      if (data.type === "progress") {
        setStatus(data.message);
        return;
      }
      clearTimeout(timer.current);
      if (data.type === "error") {
        if (data.revision === request) {
          fail(data.message);
          return;
        }
        setBusy(false);
        setError(data.message);
        setStatus("Preview refused — source retained");
        setResult(null);
        view.current?.restore();
        return;
      }
      if (data.type === "ready") {
        setReady(true);
        setStatus(
          "Ready — visual plane only; Preview is required before Apply",
        );
        return;
      }
      if (data.type === "preview") {
        setBusy(false);
        setResult(data);
        setStatus("Validated preview — Apply to keep this result");
        const endInstall = startUiTrace("installPreview");
        view.current?.result(
          data.positions,
          data.stats.rimTriangles,
          data.stats.cacheHit,
        );
        endInstall();
      }
    };
    const endInput = startUiTrace("packInput");
    const positions = finishingSourcePositions(shape);
    endInput();
    const {
      x,
      z,
      elevation,
      height,
      width,
      depth,
      size,
      rotation,
      rotationX,
      rotationZ,
      mirrorX,
      mirrorY,
      mirrorZ,
    } = shape;
    instance.postMessage(
      {
        type: "init",
        revision: request,
        assetBase: new URL(".", window.location.href).href,
        positions,
        shape: {
          id: shape.id,
          name: shape.name,
          kind: "mesh",
          x,
          z,
          elevation,
          height,
          width,
          depth,
          size,
          rotation,
          rotationX,
          rotationZ,
          mirrorX,
          mirrorY,
          mirrorZ,
        },
      },
      [positions.buffer],
    );
  };

  useEffect(() => {
    if (shape.importedMesh!.positions.length / 9 > 2_000_000) {
      setError(
        "Open Hollow Base supports up to 2 million input triangles in its isolated worker. Source retained.",
      );
      setStatus("Source retained");
      return;
    }
    const container = host.current!,
      scene = new THREE.Scene();
    scene.background = new THREE.Color("#20252b");
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000),
      controls = new OrbitControls(camera, renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x596275, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 2, 3);
    scene.add(light);
    const endSourceDisplay = startUiTrace("sourceDisplay");
    const sourceGeometry = new THREE.BufferGeometry(),
      raw = finishingSourcePositions(shape);
    sourceGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(Float32Array.from(raw), 3),
    );
    sourceGeometry.computeVertexNormals();
    sourceGeometry.computeBoundingBox();
    endSourceDisplay();
    const box = sourceGeometry.boundingBox!,
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    setBounds([...box.min.toArray(), ...box.max.toArray()]);
    const plane = new THREE.Plane(),
      removedPlane = new THREE.Plane();
    const keptMaterial = new THREE.MeshStandardMaterial({
      color: "#48b5bd",
      roughness: 0.7,
      side: THREE.DoubleSide,
      clippingPlanes: [plane],
    });
    const removedMaterial = new THREE.MeshStandardMaterial({
      color: "#ed8a4c",
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes: [removedPlane],
    });
    const kept = new THREE.Mesh(sourceGeometry, keptMaterial),
      removed = new THREE.Mesh(sourceGeometry, removedMaterial);
    scene.add(kept, removed);
    const planeGeometry = new THREE.PlaneGeometry(
        size.length() * 1.2,
        size.length() * 1.2,
      ),
      planeMaterial = new THREE.MeshBasicMaterial({
        color: "#d7efff",
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    const planeObject = new THREE.Mesh(planeGeometry, planeMaterial);
    scene.add(planeObject);
    let resultGeometry: THREE.BufferGeometry | undefined,
      rimGeometry: THREE.BufferGeometry | undefined;
    const resultMaterial = new THREE.MeshStandardMaterial({
      color: "#48b5bd",
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: "#ffd06b",
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    let resultObject: THREE.Mesh | undefined, rimObject: THREE.Mesh | undefined;
    let dirty = true,
      disposed = false,
      frame = 0;
    const invalidate = () => {
      dirty = true;
    };
    controls.addEventListener("change", invalidate);
    let cachedGeometryKey = "";
    const clearResult = () => {
      cachedGeometryKey = "";
      if (resultObject) scene.remove(resultObject);
      if (rimObject) scene.remove(rimObject);
      resultGeometry?.dispose();
      rimGeometry?.dispose();
      resultGeometry = rimGeometry = undefined;
      resultObject = rimObject = undefined;
    };
    const restore = () => {
      if (resultObject) resultObject.visible = false;
      if (rimObject) rimObject.visible = false;
      kept.visible = removed.visible = planeObject.visible = true;
      dirty = true;
    };
    view.current = {
      restore,
      cut: (next) => {
        restore();
        const normal = new THREE.Vector3().setComponent(
          next.axis,
          next.keepPositive ? 1 : -1,
        );
        plane.set(normal, -next.position * (next.keepPositive ? 1 : -1));
        removedPlane.copy(plane).negate();
        planeObject.position
          .copy(center)
          .setComponent(next.axis, next.position);
        planeObject.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          normal,
        );
        dirty = true;
      },
      result: (positions, rimTriangles, cacheHit) => {
        const key = JSON.stringify(currentCut.current);
        if (
          cacheHit &&
          cachedGeometryKey === key &&
          resultObject &&
          rimObject
        ) {
          kept.visible = removed.visible = planeObject.visible = false;
          resultObject.visible = rimObject.visible = true;
          dirty = true;
          return;
        }
        clearResult();
        cachedGeometryKey = key;
        kept.visible = removed.visible = planeObject.visible = false;
        const split = positions.length - rimTriangles * 9;
        resultGeometry = new THREE.BufferGeometry();
        resultGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(
            Float32Array.from(positions.subarray(0, split)),
            3,
          ),
        );
        resultGeometry.computeVertexNormals();
        rimGeometry = new THREE.BufferGeometry();
        rimGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(
            Float32Array.from(positions.subarray(split)),
            3,
          ),
        );
        rimGeometry.computeVertexNormals();
        resultObject = new THREE.Mesh(resultGeometry, resultMaterial);
        rimObject = new THREE.Mesh(rimGeometry, rimMaterial);
        scene.add(resultObject, rimObject);
        // A bottom cut is hidden from the initial above-body inspection view.
        // Face the removed side on explicit Preview so its cavity and rim are visible.
        const resultCenter = new THREE.Box3()
          .setFromObject(resultObject)
          .getCenter(new THREE.Vector3());
        const openingView = new THREE.Vector3(0.6, 0.6, 0.6)
          .setComponent(
            currentCut.current.axis,
            currentCut.current.keepPositive ? -1 : 1,
          )
          .multiplyScalar(size.length());
        controls.target.copy(resultCenter);
        camera.position.copy(resultCenter).add(openingView);
        controls.update();
        dirty = true;
      },
    };
    view.current.cut(currentCut.current);
    controls.target.copy(center);
    camera.position
      .copy(center)
      .add(
        new THREE.Vector3(size.length(), size.length() * 0.4, size.length()),
      );
    camera.far = Math.max(1000, size.length() * 20);
    camera.updateProjectionMatrix();
    controls.update();
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth,
        height = container.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
    });
    resize.observe(container);
    const render = () => {
      if (disposed) return;
      const changed = controls.update();
      if (dirty || changed) {
        const endRender = startUiTrace("render");
        renderer.render(scene, camera);
        endRender();
        dirty = false;
      }
      frame = requestAnimationFrame(render);
    };
    render();
    startWorker();
    return () => {
      disposed = true;
      revision.current++;
      clearTimeout(timer.current);
      worker.current?.terminate();
      worker.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      clearResult();
      sourceGeometry.dispose();
      planeGeometry.dispose();
      keptMaterial.dispose();
      removedMaterial.dispose();
      planeMaterial.dispose();
      resultMaterial.dispose();
      rimMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      view.current = null;
    };
    // A session intentionally belongs to this exact immutable source object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  const change = (next: HollowCut) => {
    revision.current++;
    setCut(next);
    setResult(null);
    setError("");
    setStatus(
      ready
        ? "Ready — visual plane only; Preview is required before Apply"
        : "Source retained",
    );
    if (Number.isFinite(next.position)) view.current?.cut(next);
    else view.current?.restore();
  };
  const preview = () => {
    if (!worker.current || !ready || busy) return;
    const request = ++revision.current;
    setBusy(true);
    setResult(null);
    setError("");
    setStatus("Constructing validated preview");
    view.current?.restore();
    timer.current = setTimeout(() => {
      if (request !== revision.current) return;
      stop();
      setError(
        "Preview timed out after 180 seconds. Source retained; retry or Cancel.",
      );
      setStatus("Source retained");
    }, 180000);
    worker.current.postMessage({ type: "preview", revision: request, cut });
  };
  const cancelPreview = () => {
    stop();
    view.current?.restore();
    setStatus("Preview canceled — source retained");
    setError("");
    startWorker();
  };
  return (
    <div
      role="dialog"
      aria-label="Open Hollow Base"
      style={{
        position: "fixed",
        inset: "5% 10%",
        zIndex: 200,
        padding: 16,
        border: "1px solid #758293",
        borderRadius: 10,
        background: "#252a31",
        color: "white",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <strong>Open Hollow Base — {shape.name}</strong>
      <p style={{ margin: 0 }}>
        Adjust the plane in local millimeters. Orange is removed; cyan is
        retained. Preview shows the real cut with its new rim in gold. Drag to
        orbit, wheel to zoom.
      </p>
      <div ref={host} style={{ flex: 1, minHeight: 220 }} />
      <fieldset
        disabled={busy || !ready}
        style={{ display: "flex", gap: 16, flexWrap: "wrap" }}
      >
        <label>
          Cutting axis{" "}
          <select
            aria-label="Cutting axis"
            value={cut.axis}
            onChange={(e) => {
              const axis = Number(e.target.value) as HollowCut["axis"];
              change({
                ...cut,
                axis,
                position: bounds.length
                  ? bounds[axis] + (bounds[axis + 3] - bounds[axis]) * 0.15
                  : 0,
              });
            }}
          >
            <option value="0">Local X</option>
            <option value="1">Local Y (height)</option>
            <option value="2">Local Z</option>
          </select>
        </label>
        <label>
          Retained side{" "}
          <select
            aria-label="Retained side"
            value={cut.keepPositive ? "positive" : "negative"}
            onChange={(e) =>
              change({ ...cut, keepPositive: e.target.value === "positive" })
            }
          >
            <option value="positive">Above / positive</option>
            <option value="negative">Below / negative</option>
          </select>
        </label>
        <label>
          Cut position (mm){" "}
          <input
            aria-label="Cut position (mm)"
            type="number"
            step="0.1"
            value={Number.isFinite(cut.position) ? cut.position : ""}
            onChange={(e) =>
              change({
                ...cut,
                position: e.target.value === "" ? NaN : Number(e.target.value),
              })
            }
          />
        </label>
        {bounds.length ? (
          <input
            aria-label="Plane position slider"
            type="range"
            min={bounds[cut.axis]}
            max={bounds[cut.axis + 3]}
            step={(bounds[cut.axis + 3] - bounds[cut.axis]) / 1000}
            value={
              Number.isFinite(cut.position) ? cut.position : bounds[cut.axis]
            }
            onChange={(e) =>
              change({ ...cut, position: Number(e.target.value) })
            }
          />
        ) : null}
      </fieldset>
      <div role="status">{status}</div>
      {error ? (
        <div role="alert" style={{ color: "#ffb2a2" }}>
          {error}
        </div>
      ) : null}
      {result ? (
        <div data-testid="finishing-statistics" style={{ fontSize: 13 }}>
          {result.stats.resultTriangles.toLocaleString()} triangles ·{" "}
          {result.stats.rimTriangles.toLocaleString()} rim triangles ·{" "}
          {result.stats.openings} opening(s) ·{" "}
          {result.audit.dimensionsMm.map((x) => x.toFixed(3)).join(" × ")} mm ·
          cut {Number(result.stats.geometryMs).toFixed(0)} ms · validation{" "}
          {Number(result.stats.validationMs).toFixed(0)} ms
          {result.stats.cacheHit ? " (cached)" : ""}
          <br />
          Retained local geometry displacement: 0 mm (all unchanged triangles).
          Max final manufacturing vertex rounding:{" "}
          {Number(
            result.stats.maxManufacturingEncodingDisplacementMm,
          ).toPrecision(3)}{" "}
          mm. Source and result surface checks complete.
          {[
            ...new Set([
              ...result.surface.notes,
              ...result.encodedSurface.notes,
            ]),
          ].map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={preview}
          disabled={!ready || busy || !Number.isFinite(cut.position)}
        >
          Preview
        </button>
        {busy ? <button onClick={cancelPreview}>Cancel preview</button> : null}
        {!worker.current && !busy ? (
          <button onClick={startWorker}>Retry worker</button>
        ) : null}
        <button
          disabled={!result || busy}
          onClick={() => result && onApply(result.positions)}
        >
          Apply
        </button>
        <button
          onClick={() => {
            stop();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
