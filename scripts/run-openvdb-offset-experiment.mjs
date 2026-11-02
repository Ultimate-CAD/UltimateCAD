// Usage: node scripts/run-openvdb-offset-experiment.mjs --label NAME --method offset|dilate --pitch MM [--timeout-ms N] [--request PATH] [--origin X,Y,Z]
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const usage = "--label NAME --method offset|dilate --pitch 0.02..0.10 [--timeout-ms N] [--request PATH] [--origin X,Y,Z]";
const expectedSha256 = "f86d7b3637b832f14fa151f407b6d16e6ed723910b231d9a41ee97ab813a7fda";

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i].split(/=(.*)/s, 2);
    if (key === "--help" || key === "-h") return { help: true };
    if (!["--label", "--method", "--pitch", "--timeout-ms", "--request", "--origin"].includes(key))
      throw new Error(`Unknown option: ${key}\nUsage: ${usage}`);
    const value = inline ?? args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}\nUsage: ${usage}`);
    options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!options.label || !/^[a-z0-9][a-z0-9-]*$/i.test(options.label)) throw new Error(`A unique --label is required. Usage: ${usage}`);
  if (!["offset", "dilate"].includes(options.method)) throw new Error(`--method must be offset or dilate. Usage: ${usage}`);
  options.pitch = Number(options.pitch);
  if (!Number.isFinite(options.pitch) || options.pitch < 0.02 || options.pitch > 0.1) throw new Error("--pitch must be between 0.02 and 0.10");
  options.timeoutMs = Number(options.timeoutMs ?? 180000);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error("--timeout-ms must be a positive integer");
  options.origin = (options.origin ?? "0,0,0").split(",").map(Number);
  if (options.origin.length !== 3 || !options.origin.every(Number.isFinite)) throw new Error("--origin must contain three comma-separated finite numbers");
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage);
  process.exit(0);
}

const output = path.resolve(root, ".codex-run/sparse14-offset", options.label);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
const requestPath = path.resolve(root, options.request ?? ".codex-run/sparse14/dense-cone-verify/request.mesh.bin");
if (!existsSync(requestPath)) throw new Error(`Request file not found: ${requestPath}`);
const requestHash = createHash("sha256").update(readFileSync(requestPath)).digest("hex");
if (!options.request && requestHash !== expectedSha256) throw new Error(`Default request hash mismatch: ${requestHash}`);

mkdirSync(output, { recursive: false });
const executable = path.resolve(root, ".codex-run/sparse14/prototype-build/Release/ultimate-openvdb-offset.exe");
const statsPath = path.join(output, "stats.json");
const stdoutPath = path.join(output, "stdout.log");
const stderrPath = path.join(output, "stderr.log");
const startedAt = new Date().toISOString();
const started = performance.now();
const record = {
  label: options.label,
  method: options.method,
  pitch: options.pitch,
  timeoutMs: options.timeoutMs,
  requestPath,
  requestSha256: requestHash,
  requestOverride: Boolean(options.request),
  origin: options.origin,
  executable,
  output,
  startedAt,
};
let child;
let timedOut = false;
let cancelled = false;
let timeout;
function captureMemoryBeforeTermination() {
  if (!child?.pid) return;
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$p=Get-Process -Id ${Number(child.pid)} -ErrorAction Stop; [pscustomobject]@{peakRssBytes=$p.PeakWorkingSet64;rssBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;cpuSeconds=$p.CPU}|ConvertTo-Json -Compress`], { windowsHide: true, encoding: "utf8", timeout: 3000 });
  try { record.memoryBeforeTermination = JSON.parse(probe.stdout); }
  catch { record.memoryBeforeTerminationUnavailable = true; }
}
const cancel = () => {
  cancelled = true;
  captureMemoryBeforeTermination();
  child?.kill();
};
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

try {
  if (!existsSync(executable)) throw new Error(`Native executable not found: ${executable}`);
  record.executableSha256 = createHash("sha256").update(readFileSync(executable)).digest("hex");
  const stdout = createWriteStream(stdoutPath, { flags: "wx" });
  const stderr = createWriteStream(stderrPath, { flags: "wx" });
  const stdoutFinished = finished(stdout);
  const stderrFinished = finished(stderr);
  const childArgs = [requestPath, output, options.method, String(options.pitch), ...options.origin.map(String)];
  const windowsRoot = process.env.SystemRoot || "C:/Windows";
  const system32 = path.join(windowsRoot, "System32");
  const childResult = await new Promise((resolve, reject) => {
    child = spawn(executable, childArgs, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { SystemRoot: windowsRoot, PATH: system32, LAYERLING_BENCH_OWNER_PID: String(process.pid) },
    });
    timeout = setTimeout(() => {
      timedOut = true;
      captureMemoryBeforeTermination();
      child.kill();
    }, options.timeoutMs);
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
  });
  await Promise.all([stdoutFinished, stderrFinished]);
  record.status = timedOut ? "timed-out" : cancelled ? "cancelled" : childResult.code === 0 ? "completed" : "failed";
  record.exitCode = childResult.code;
  record.signal = childResult.signal;
} catch (error) {
  record.status = cancelled ? "cancelled" : "failed";
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  clearTimeout(timeout);
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  record.durationMs = performance.now() - started;
  record.finishedAt = new Date().toISOString();
  record.statsPath = existsSync(statsPath) ? statsPath : null;
  record.stdoutPath = existsSync(stdoutPath) ? stdoutPath : null;
  record.stderrPath = existsSync(stderrPath) ? stderrPath : null;
  if (record.statsPath) {
    try { record.stats = JSON.parse(readFileSync(statsPath, "utf8")); }
    catch (error) { record.statsReadError = error instanceof Error ? error.message : String(error); }
  }
  for (const name of ["source.mesh.bin", "cavity.mesh.bin", "result.mesh.bin"]) {
    const file = path.join(output, name);
    if (existsSync(file)) record[name] = { path: file, bytes: readFileSync(file).length };
  }
  writeFileSync(path.join(output, "results.json"), JSON.stringify(record, null, 2));
}

console.log(JSON.stringify(record));
if (!["completed", "timed-out", "cancelled"].includes(record.status)) process.exitCode = 1;
