import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { SphereGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

it.skipIf(!process.env.LAYERLING_PICK_BENCH)("compares the current smoothing picker with indexed acceleration", () => {
  const measurements = [];
  for (const width of [320, 708, 1414]) {
    const geometry = new SphereGeometry(10, width, width / 2), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld();
    const ray = new Raycaster(), probes = Array.from({ length: 20 }, (_, i) => new Vector3((i - 10) * .08, .1, 30));
    const index = geometry.index!.array.slice();
    const started = performance.now();
    const baseline = probes.map(p => { ray.set(p, new Vector3(0, 0, -1)); return ray.intersectObject(mesh)[0]; });
    const baselineMs = performance.now() - started, build = performance.now();
    geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
    const buildMs = performance.now() - build;
    mesh.raycast = acceleratedRaycast;ray.firstHitOnly = true;
    const query = performance.now();
    const accelerated = probes.map(p => { ray.set(p, new Vector3(0, 0, -1)); return ray.intersectObject(mesh)[0]; });
    const acceleratedMs = performance.now() - query;
    accelerated.forEach((hit, i) => { expect(hit.faceIndex).toBe(baseline[i].faceIndex);expect(hit.point.distanceTo(baseline[i].point)).toBeLessThan(1e-10); });
    expect(geometry.index!.array).toEqual(index);
    measurements.push({ triangles: index.length / 3, baselineMs, acceleratedMs, buildMs, probes: probes.length });
    geometry.dispose();material.dispose();
  }
  writeFileSync(process.env.LAYERLING_PICK_BENCH!, JSON.stringify(measurements, null, 2));
}, 60000);
