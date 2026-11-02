// Usage: node scripts/benchmark-sparse-volume.mjs --label unique-name [--fixture dense-cone|cone-100k|cone-500k|file.stl] [--exe helper.exe] [--wall 2] [--error 0.1] [--threads 0] [--pitch 0] [--generate-only]
// Named fixtures reproduce benchmark-native-geometry.mjs input coordinates exactly.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CylinderGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
const require = createRequire(import.meta.url);
const { encodeRequest, decodeResult } = require("../desktop/native-geometry-protocol.cjs");
const usage = "--label NAME [--fixture dense-cone|cone-100k|cone-500k|file.stl] [--exe PATH] [--wall MM] [--error MM] [--threads 0..16] [--pitch MM] [--cancel-after-ms N] [--generate-only]";

function parseArgs(args) {
  const options = { fixture: "dense-cone", wall: 2, error: 0.1, threads: 0, pitch: 0, cancelAfterMs: 0, generateOnly: false };
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i].split(/=(.*)/s, 2);
    if (key === "--help" || key === "-h") return { help: true };
    if (key === "--generate-only") { options.generateOnly = true; continue; }
    if (!["--label", "--fixture", "--exe", "--wall", "--error", "--threads", "--pitch", "--cancel-after-ms"].includes(key))
      throw new Error(`Unknown option: ${key}\nUsage: ${usage}`);
    const value = inline ?? args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}\nUsage: ${usage}`);
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[name] = ["wall", "error", "threads", "pitch", "cancel-after-ms"].includes(key.slice(2)) ? Number(value) : value;
  }
  return options;
}

function makeGeometry(fixture) {
  if (["dense-cone", "cone-100k", "cone-500k"].includes(fixture)) {
    const segments = fixture === "dense-cone" ? 1024 : fixture === "cone-100k" ? 100 : 500;
    return new CylinderGeometry(0, 20, 80, 512, segments, false);
  }
  const source = readFileSync(path.resolve(root, fixture));
  const geometry = new STLLoader().parse(
    source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  );
  const positions = geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 2];
    positions[i + 2] = -positions[i + 1];
    positions[i + 1] = y;
  }
  return geometry;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(`Usage: node scripts/benchmark-sparse-volume.mjs ${usage}`); return; }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(options.label || ""))
    throw new Error(`A unique --label is required. Usage: ${usage}`);
  if (!Number.isFinite(options.wall) || options.wall <= 0 || !Number.isFinite(options.error) || options.error < 0.02 || options.error > 0.5 || !Number.isInteger(options.threads) || options.threads < 0 || options.threads > 16 || !Number.isFinite(options.pitch) || options.pitch < 0 || !Number.isFinite(options.cancelAfterMs) || options.cancelAfterMs < 0)
    throw new Error("Invalid wall/error/threads/pitch values; see --help");

  const output = path.resolve(root, ".codex-run", "sparse14", options.label);
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing benchmark directory: ${output}`);
  mkdirSync(output, { recursive: true });
  const geometry = makeGeometry(options.fixture);
  const positions = geometry.attributes.position.array;
  const indices = geometry.index?.array ?? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const input = encodeRequest({ positions, indices, thickness: options.wall, options: { maxErrorMm: options.error } }, options.pitch);
  input.writeUInt32LE(options.threads, 44);
  const inputSha256 = sha256(input);
  const requestPath = path.join(output, "request.mesh.bin");
  writeFileSync(requestPath, input);
  const record = {
    label: options.label,
    fixture: options.fixture,
    settings: { wallMm: options.wall, maxErrorMm: options.error, threads: options.threads, pitchMm: options.pitch },
    inputTriangles: indices.length / 3,
    inputBytes: input.length,
    inputSha256,
    requestPath,
    status: options.generateOnly ? "generated-only" : "pending",
  };
  if (options.fixture === "dense-cone" && options.wall === 2 && options.error === 0.1 && options.threads === 0 && options.pitch === 0 && inputSha256 !== "f86d7b3637b832f14fa151f407b6d16e6ed723910b231d9a41ee97ab813a7fda")
    throw new Error(`Default dense-cone request hash changed: ${inputSha256}`);
  if (options.generateOnly) {
    writeFileSync(path.join(output, "results.json"), JSON.stringify(record, null, 2));
    console.log(JSON.stringify({ output, ...record }));
    geometry.dispose();
    return;
  }

  const executable = path.resolve(root, options.exe || ".codex-run/adaptive10/build/Release/layerling-geometry.exe");
  const resultPath = path.join(output, "output.mesh.bin");
  const statsPath = path.join(output, "stats.json");
  const ownerPid = process.pid;
  let child;
  let cancelled = false;
  const cancel = () => { cancelled = true; child?.kill(); };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const started = performance.now();
  let timeout;
  let cancelTimer;
  try {
    if (!existsSync(executable)) throw new Error(`Native executable not found: ${executable}`);
    const stats = await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child = spawn(executable, [requestPath, resultPath, String(ownerPid)], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { SystemRoot: process.env.SystemRoot, PATH: path.join(process.env.SystemRoot || "C:/Windows", "System32") },
      });
      timeout = setTimeout(() => { timedOut = true; child.kill(); }, 600_000);
      if (options.cancelAfterMs > 0) cancelTimer = setTimeout(cancel, options.cancelAfterMs);
      child.stdout.on("data", (data) => { stdout += data.toString(); if (stdout.length > 16_384) child.kill(); });
      child.stderr.on("data", (data) => {
        stderr = (stderr + data.toString()).slice(-8192);
        writeFileSync(path.join(output, "progress.log"), data, { flag: "a" });
      });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timeout);
        clearTimeout(cancelTimer);
        if (cancelled) return reject(Object.assign(new Error("Benchmark process cancelled"), { code: "CANCELLED" }));
        if (timedOut) return reject(Object.assign(new Error("Benchmark process exceeded 600 seconds"), { code: "TIMEOUT" }));
        if (code !== 0) return reject(new Error(`Benchmark process stopped (${code}): ${stderr.slice(-2048)}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`Benchmark emitted invalid stats JSON: ${stdout.slice(-2048)}`)); }
      });
    });
    if (!["native-cpu", "openvdb14-prototype"].includes(stats.backend)) throw new Error(`Unsupported benchmark backend: ${stats.backend}`);
    const resultBytes = readFileSync(resultPath);
    const decoded = decodeResult(resultBytes, false);
    const resultTriangles = resultBytes.readUInt32LE(12) / 3;
    if (stats.method !== "mesh-sdf" || stats.resultTriangles !== resultTriangles || !Number.isFinite(stats.resultVolumeMm3) || stats.resultVolumeMm3 <= 0 || !Number.isFinite(stats.measuredErrorMm) || stats.maxErrorMm !== options.error || stats.measuredErrorMm > options.error)
      throw new Error("Native result mesh and reported statistics do not match");
    writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    Object.assign(record, {
      status: "completed",
      executable,
      ownerPid,
      durationMs: performance.now() - started,
      backend: stats.backend,
      resultTriangles,
      statsPath,
      stats,
      outputPath: resultPath,
      outputBytes: resultBytes.length,
      outputSha256: sha256(resultBytes),
    });
  } catch (error) {
    if (error?.code === "CANCELLED") {
      record.status = "cancelled";
      try { const fs = await import("node:fs/promises"); await fs.rm(resultPath, { force: true }); } catch {}
    } else record.status = "failed";
    Object.assign(record, { executable, ownerPid, durationMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) });
    writeFileSync(path.join(output, "results.json"), JSON.stringify(record, null, 2));
    if (record.status !== "cancelled") throw error;
  } finally {
    clearTimeout(timeout);
    clearTimeout(cancelTimer);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    geometry.dispose();
  }
  writeFileSync(path.join(output, "results.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ output, ...record }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
