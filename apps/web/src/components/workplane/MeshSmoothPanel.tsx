"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { StlExportMesh } from "@/lib/stlExport";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";

type MeshView = {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  source: StlExportMesh;
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
  const [preview, setPreview] = useState<StlExportMesh | null>(null);
  const brush = useRef({ radius, subtract });
  brush.current = { radius, subtract };
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    scene.background = new THREE.Color("#20252b");
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
      setError("Smoothing timed out. Cancel and reopen the tool; source was retained.");
      setBusy(false);
      setPreview(null);
    };
    timer.current = setTimeout(timeout, 120000);

    const display = (mesh: StlExportMesh) => {
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3),
      );
      geometry.setIndex(mesh.faces.flat());
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    };

    smoothingWorker.onmessage = ({ data }) => {
      if (disposed) return;
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
        display(data.mesh);
        view.current = { geometry, mesh: object, source: data.mesh };
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
        const colors = new Float32Array(data.weights.length * 3);
        for (let i = 0; i < data.weights.length; i += 1) {
          const weight = data.weights[i];
          colors.set(
            [0.1 + 0.9 * weight, 0.65 - 0.25 * weight, 0.85 - 0.75 * weight],
            i * 3,
          );
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        pending = false;
      }
      if (data.type === "preview") {
        display(data.mesh);
        showingPreview = true;
        setPreview(data.mesh);
        setStats(data.stats);
        setBusy(false);
      }
    };
    smoothingWorker.onerror = (event) => {
      clearTimeout(timer.current);
      smoothingWorker.terminate();
      setError(event.message || "Smoothing worker failed");
      setBusy(false);
    };

    const source = shape.importedMesh!;
    const scale = [
      shapeWidth(shape) / source.baseWidth,
      shape.height / source.baseHeight,
      shapeDepth(shape) / source.baseDepth,
    ];
    smoothingWorker.postMessage({
      type: "init",
      positions: source.positions.map((value, index) => value * scale[index % 3]),
    });

    const raycaster = new THREE.Raycaster();
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
      if (showingPreview) {
        display(view.current.source);
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
    });
    resize.observe(container);

    const render = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
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
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
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
    onApply(
      preview.faces.flatMap((face, faceIndex) =>
        face.flatMap((index, corner) =>
          preview.vertices[index].map((value, axis) =>
            value === view.current?.source.vertices[index][axis]
              ? source.positions[faceIndex * 9 + corner * 3 + axis]
              : value / scale[axis],
          ),
        ),
      ),
    );
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
      </p>
      <div ref={host} style={{ flex: 1, minHeight: 240 }} />
      <fieldset disabled={busy} style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label>
          Brush radius (mm) {" "}
          <input
            aria-label="Brush radius"
            type="number"
            min="0.1"
            max="1000"
            value={radius}
            onChange={(event) =>
              setRadius(Math.max(0.1, Math.min(1000, Number(event.target.value) || 0.1)))
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
              setPreview(null);
            }}
          />
        </label>
        <label>
          Iterations {" "}
          <input
            aria-label="Smoothing iterations"
            type="number"
            min="1"
            max="100"
            value={iterations}
            onChange={(event) =>
              setIterations(
                Math.max(1, Math.min(100, Math.round(Number(event.target.value) || 1))),
              )
            }
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
          disabled={busy || !worker.current}
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
            worker.current?.postMessage({ type: "preview", strength, iterations });
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
            setPreview(null);
            setStats(null);
            if (view.current) {
              const { source, geometry } = view.current;
              geometry.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(source.vertices.flat(), 3),
              );
              geometry.computeVertexNormals();
            }
          }}
        >
          Clear selection
        </button>
        {busy && <span>Processing… Cancel stops the worker.</span>}
      </div>
    </div>
  );
}
