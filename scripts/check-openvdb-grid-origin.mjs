// Standalone regression: off-origin box, both methods, zero/translated grids.
import { BoxGeometry } from "three";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
const { encodeRequest } = createRequire(import.meta.url)("../desktop/native-geometry-protocol.cjs");
const id = `origin-check-${Date.now()}`, folder = path.resolve(".codex-run/sparse14-offset", id);
mkdirSync(folder, { recursive: true });
const box = new BoxGeometry(10, 10, 10); box.translate(17.25, -8.5, 3.75);
const request = path.join(folder, "box.request");
writeFileSync(request, encodeRequest({ positions: box.attributes.position.array, indices: box.index.array, thickness: 2, options: { maxErrorMm: .1 } }));
box.dispose();
const cases = [];
for (const method of ["offset", "dilate"]) for (const origin of ["0,0,0", "1.25,-2.5,3.75"]) {
  const label = `${id}-${method}-${cases.length}`;
  const run = spawnSync(process.execPath, ["scripts/run-openvdb-offset-experiment.mjs", "--label", label, "--method", method, "--pitch", ".1", "--request", request, "--origin", origin], { windowsHide: true, encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || "Origin regression process failed");
  const dir = path.resolve(".codex-run/sparse14-offset", label), b = readFileSync(path.join(dir, "cavity-raw.mesh.bin"));
  const n = b.readUInt32LE(8), low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  let error = 0;
  for (let i = 0; i < n; i += 3) {
    let insideDistance = Infinity;
    for (let j = 0; j < 3; j++) {
      const p = b.readDoubleLE(16 + (i+j)*8);
      low[j] = Math.min(low[j], p); high[j] = Math.max(high[j], p);
      insideDistance = Math.min(insideDistance, 5 - Math.abs(p - [17.25, -8.5, 3.75][j]));
    }
    error = Math.max(error, Math.abs(insideDistance - 2));
  }
  const stats = JSON.parse(readFileSync(path.join(dir, "stats.json"), "utf8"));
  if (error > .1 || !stats.accuracyPass || low.some((p, j) => Math.abs((p+high[j])/2 - [17.25, -8.5, 3.75][j]) > .1)) throw new Error("World/index conversion regression");
  cases.push({ method, origin, low, high, independentVertexOffsetErrorMm: error });
}
writeFileSync(path.join(folder, "results.json"), JSON.stringify({ pass: true, cases }, null, 2));
console.log(`PASS four world/index coordinate checks: ${folder}`);
