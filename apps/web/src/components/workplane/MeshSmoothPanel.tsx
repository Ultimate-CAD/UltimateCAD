"use client";
import {MeasurementInput} from "./MeasurementInput";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { updateSmoothingColors, type SmoothingDisplay } from "@/lib/smoothingDisplay";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";

type MeshView = {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  source: Float64Array;
  display: SmoothingDisplay;
  restore: () => void;
};

type Props = {
  shape: WorkplaneShape;
  onApply: (positions: number[]) => void;
  onCancel: () => void;
};

export function MeshSmoothPanel({ shape, onApply, onCancel }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const worker = useRef<Worker | null>(null);
  const view = useRef<MeshView | null>(null);
  const [radius, setRadius] = useState(5);
  const [strength, setStrength] = useState(0.7);
  const [iterations, setIterations] = useState(20);
  const [subtract, setSubtract] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [preview, setPreview] = useState<Float64Array | null>(null);
  const brush = useRef({ radius, subtract });
  brush.current = { radius, subtract };
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revision = useRef(0);

  useEffect(() => {
    const container = host.current!;
    let disposed = false;
    let frame = 0;
    let painting = false;
    let pending = false;
    let showingPreview = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(document.documentElement.dataset.palette === "midnight" ? "#111111" : "#20252b");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    scene.add(new THREE.HemisphereLight(0xffffff, 0x596275, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 2, 3);
    scene.add(light);

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    const object = new THREE.Mesh(geometry, material);
    scene.add(object);

    const smoothingWorker = new Worker(
      new URL("../../workers/localizedSmoothing.worker.ts", import.meta.url),
      { type: "module", name: "layerling-local-smoothing" },
    );
    worker.current = smoothingWorker;
    const timeout = () => {
      smoothingWorker.terminate();
      worker.current = null;
      setError("Smoothing timed out. Cancel and reopen the tool; source was retained.");
      setBusy(false);
      setPreview(null);
    };
    timer.current = setTimeout(timeout, 120000);

    let needsRender = true;
    const invalidateCamera = () => { needsRender = true; };
    controls.addEventListener("change", invalidateCamera);
    object.raycast = acceleratedRaycast;
    const display = (prepared: SmoothingDisplay) => {
      for (const [name, array] of [["position", prepared.position], ["normal", prepared.normal]] as const) {
        const existing = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (existing) { existing.array = array;existing.needsUpdate = true; }
        else geometry.setAttribute(name, new THREE.BufferAttribute(array, 3));
      }
      if (!geometry.index) geometry.setIndex(new THREE.BufferAttribute(prepared.bvh.index!, 1));
      geometry.boundsTree = MeshBVH.deserialize(prepared.bvh, geometry, { setIndex: false });
      geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...prepared.bounds.slice(0,3)),new THREE.Vector3(...prepared.bounds.slice(3,6)));
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      needsRender = true;
    };

    smoothingWorker.onmessage = ({ data }) => {
      if (disposed) return;
      if ((data.type === "preview" || data.type === "error") && data.revision !== undefined && data.revision !== revision.current) return;
      if (["ready", "preview", "error"].includes(data.type)) {
        clearTimeout(timer.current);
      }
      if (data.type === "error") {
        setError(data.message);
        setBusy(false);
        pending = false;
        return;
      }
      if (data.type === "ready") {
        display(data.display);
        view.current = { geometry, mesh: object, source: data.positions, display: data.display, restore: () => { display(data.display);showingPreview = false; } };
        const bounds = new THREE.Box3().setFromObject(object);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3()).length();
        controls.target.copy(center);
        camera.position
          .copy(center)
          .add(new THREE.Vector3(size, 0.5 * size, size));
        camera.far = Math.max(1000, size * 20);
        camera.updateProjectionMatrix();
        controls.update();
        setBusy(false);
      }
      if (data.weights) {
        let attribute = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (!attribute) {
          attribute = new THREE.BufferAttribute(new Float32Array(data.weights.length * 3),3);
          geometry.setAttribute("color",attribute);
        }
        updateSmoothingColors(attribute,data.indices ?? Uint32Array.from({length:data.weights.length},(_,i)=>i),data.weights);
        needsRender = true;
        pending = false;
      }
      if (data.type === "preview") {
        display(data.display);
        showingPreview = true;
        setPreview(data.positions);
        setStats(data.stats);
        setBusy(false);
      }
    };
    smoothingWorker.onerror = (event) => {
      clearTimeout(timer.current);
      smoothingWorker.terminate();
      worker.current = null;
      setError(event.message || "Smoothing worker failed");
      setBusy(false);
    };

    const source = shape.importedMesh!;
    const scale = [
      shapeWidth(shape) / source.baseWidth,
      shape.height / source.baseHeight,
      shapeDepth(shape) / source.baseDepth,
    ];
    const positions = new Float64Array(source.positions.length);
    for (let i = 0; i < positions.length; i++) positions[i] = source.positions[i] * scale[i % 3];
    smoothingWorker.postMessage({ type: "init", positions }, [positions.buffer]);

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    let lastPaint = 0;
    const paint = (event: PointerEvent) => {
      if (
        busyRef.current ||
        !painting ||
        pending ||
        !view.current ||
        performance.now() - lastPaint < 30
      ) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObject(object)[0];
      if (!hit) return;

      lastPaint = performance.now();
      pending = true;
      setPreview(null);
      setStats(null);
      revision.current++;
      if (showingPreview) {
        display(view.current.display);
        showingPreview = false;
      }
      smoothingWorker.postMessage({
        type: "paint",
        point: hit.point.toArray(),
        ...brush.current,
        subtract: brush.current.subtract || event.shiftKey,
      });
    };
    const down = (event: PointerEvent) => {
      if (event.button === 0) {
        painting = true;
        renderer.domElement.setPointerCapture(event.pointerId);
        paint(event);
      }
    };
    const up = () => {
      painting = false;
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", paint);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);

    const resize = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      needsRender = true;
    });
    resize.observe(container);

    const render = () => {
      if (disposed) return;
      const cameraChanged = controls.update();
      if (cameraChanged || needsRender) { renderer.render(scene, camera);needsRender = false; }
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      clearTimeout(timer.current);
      cancelAnimationFrame(frame);
      resize.disconnect();
      smoothingWorker.terminate();
      worker.current = null;
      view.current = null;
      controls.removeEventListener("change", invalidateCamera);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [shape]);

  const apply = () => {
    if (!preview) return;
    const source = shape.importedMesh!;
    const scale = [
      shapeWidth(shape) / source.baseWidth,
      shape.height / source.baseHeight,
      shapeDepth(shape) / source.baseDepth,
    ];
    const viewState = view.current;
    if (!viewState?.geometry.index) return;
    const indices = viewState.geometry.index.array, positions = new Array<number>(indices.length * 3);
    for (let i = 0; i < indices.length; i++) for (let axis = 0; axis < 3; axis++) {
      const indexed = indices[i] * 3 + axis, raw = i * 3 + axis, value = preview[indexed];
      positions[raw] = value === viewState.source[indexed] ? source.positions[raw] : value / scale[axis];
    }
    onApply(positions);
  };

  return (
    <div
      role="dialog"
      aria-label="Smooth Mesh"
      style={{
        position: "fixed",
        inset: "8% 12%",
        zIndex: 200,
        background: "#252a31",
        color: "white",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        border: "1px solid #758293",
        borderRadius: 10,
      }}
    >
      <strong>Smooth Mesh - {shape.name}</strong>
      <p>
        Left drag: paint · Shift: subtract · Right drag: rotate · Middle drag: pan ·
        Wheel: zoom. Orange marks the weighted region. Open boundaries stay fixed.
        Preview validates source and result surfaces before Apply is enabled.
      </p>
      <div ref={host} style={{ flex: 1, minHeight: 240 }} />
      <fieldset disabled={busy} style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label>
          Brush radius (mm) {" "}
          <MeasurementInput
            aria-label="Brush radius"
            min="0.1"
            max="1000"
            value={radius}
            onValueChange={(value) =>
              setRadius(Math.max(0.1, Math.min(1000, value)))
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={subtract}
            onChange={(event) => setSubtract(event.target.checked)}
          />
          {" "}Subtract selection
        </label>
        <label>
          Strength {" "}
          <input
            aria-label="Smoothing strength"
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={strength}
            onChange={(event) => {
              setStrength(Number(event.target.value));
              revision.current++;
              setPreview(null);
              setStats(null);
            }}
          />
        </label>
        <label>
          Iterations {" "}
          <MeasurementInput
            aria-label="Smoothing iterations"
            min="1"
            max="100"
            value={iterations}
            onValueChange={(value) => {
              setIterations(
                Math.max(1, Math.min(100, Math.round(value))),
              );revision.current++;setPreview(null);setStats(null);
            }}
          />
        </label>
      </fieldset>
      {stats && (
        <p>
          Max displacement: {stats.maxDisplacementMm.toFixed(5)} mm · RMS:{" "}
          {stats.rmsDisplacementMm.toFixed(5)} mm · Volume change:{" "}
          {(stats.resultVolumeMm3 - stats.sourceVolumeMm3).toFixed(4)} mm3. Sampled
          surface checking is not a manufacturing certificate.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          disabled={busy || !worker.current || !view.current}
          onClick={() => {
            setBusy(true);
            setError("");
            setPreview(null);
            timer.current = setTimeout(() => {
              worker.current?.terminate();
              worker.current = null;
              setBusy(false);
              setError("Preview timed out; source retained. Cancel and reopen the tool.");
            }, 120000);
            const requestRevision = ++revision.current;
            worker.current?.postMessage({ type: "preview", strength, iterations, revision: requestRevision });
          }}
        >
          Preview
        </button>
        <button disabled={busy || !preview} onClick={apply}>
          Apply smoothing
        </button>
        <button onClick={onCancel}>Cancel</button>
        <button
          disabled={busy}
          onClick={() => {
            worker.current?.postMessage({ type: "clear" });
            revision.current++;
            setPreview(null);
            setStats(null);
            view.current?.restore();
          }}
        >
          Clear selection
        </button>
        {busy && <span>Processing… Cancel stops the worker.</span>}
      </div>
    </div>
  );
}
