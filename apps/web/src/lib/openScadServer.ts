import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan } from "./openscad/vendor/scadParser.cjs";

export type OpenScadInput = {
  source: string;
  fileName?: string;
  parameters?: Record<string, unknown>;
  expressions?: Record<string, string>;
  files?: Record<string, { encoding: "utf8" | "base64"; data: string }>;
  libraryPaths?: string[];
  sourceDirectory?: string;
  timeoutMs?: number;
};

export type OpenScadResult = {
  stlBase64: string;
  key: string;
  cached: boolean;
  durationMs: number;
  engineVersion: string;
  dependencies: Array<{ path: string; sha256: string }>;
  files: Record<string, { encoding: "utf8" | "base64"; data: string }>;
  diagnostics: string;
};

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const HASH = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const IS_WINDOWS = process.platform === "win32";

type CacheEntry = OpenScadResult & { dependencyFiles: Array<{ path: string; absolutePath?: string; sha256: string }> };
const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;
let active = 0;
type QueueWaiter = { resolve: (release: () => void) => void; reject: (error: Error) => void; signal?: AbortSignal; onAbort: () => void };
const waiters: QueueWaiter[] = [];

function abortError() {
  const error = new Error("OpenSCAD render cancelled");
  error.name = "AbortError";
  return error;
}

function cleanRelative(value: string, what: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`${what} must be a safe relative path`);
  }
  return normalized;
}

function scadLiteral(value: unknown): string {
  if (value === null || value === undefined) throw new Error("OpenSCAD parameters must be non-null primitive values or arrays");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("OpenSCAD parameter numbers must be finite");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(scadLiteral).join(",")}]`;
  throw new Error("OpenSCAD parameters must be primitive values or arrays");
}

function sourceWithOverrides(source: string, parameters: Record<string, unknown>, expressions: Record<string, string>): string {
  const overrides = new Map<string, string>();
  for (const [name, value] of Object.entries(parameters)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw new Error(`Invalid OpenSCAD parameter name '${name}'`);
    overrides.set(name, scadLiteral(value));
  }
  for (const [name, expression] of Object.entries(expressions)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw new Error(`Invalid OpenSCAD expression name '${name}'`);
    if (typeof expression !== "string" || expression.length > 16_384) throw new Error(`Invalid OpenSCAD expression for '${name}'`);
    if (expression.trim()) overrides.set(name, expression);
  }
  // OpenSCAD evaluates dependent variables in declaration order.
  // Lower references to later-defined parameters in the temporary
  // evaluation source; never modify the persisted user source.
  const forwardDeclarations = new Map<string, { position: number; rhs: string }>();

  for (const item of scan(source)) {
    if (item.kind !== "statement" || item.end === undefined) continue;

    const match = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?:;\s*|$)/.exec(item.code ?? "");
    if (!match || forwardDeclarations.has(match[1])) continue;

    forwardDeclarations.set(match[1], {
      position: item.start,
      rhs: match[2].trim(),
    });
  }

  function resolveForwardReferences(
    expression: string,
    ownerPosition: number,
    visiting: Set<string>,
  ): string {
    return expression.replace(
      /"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|[A-Za-z_$][A-Za-z0-9_$]*/g,
      (token, offset: number) => {
        if (token.startsWith('"') || token.startsWith("/")) return token;
        if (offset > 0 && /[0-9.]/.test(expression[offset - 1])) return token;

        const dependency = forwardDeclarations.get(token);
        if (!dependency || dependency.position <= ownerPosition) return token;

        if (visiting.has(token)) {
          throw new Error(`Circular OpenSCAD parameter dependency: ${[...visiting, token].join(" -> ")}`);
        }

        const value = overrides.get(token) ?? dependency.rhs;
        const resolved = resolveForwardReferences(
          value,
          ownerPosition,
          new Set([...visiting, token]),
        );
        return `(${resolved})`;
      },
    );
  }

  for (const [name, expression] of Object.entries(expressions)) {
    const declaration = forwardDeclarations.get(name);
    if (!declaration || !expression.trim()) continue;

    overrides.set(
      name,
      resolveForwardReferences(
        expression,
        declaration.position,
        new Set([name]),
      ),
    );
  }

  if (!overrides.size) return source;

  const edits: Array<{ start: number; end: number; name: string }> = [];
  for (const item of scan(source)) {
    if (item.kind !== "statement" || item.end === undefined) continue;
    const assignment = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*=/.exec(item.code ?? "");
    if (assignment && overrides.has(assignment[1])) edits.push({ start: item.start, end: item.end, name: assignment[1] });
  }
  const replaced = new Set(edits.map((edit) => edit.name));
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    const original = result.slice(edit.start, edit.end);
    const lineBreaks = original.match(/\r\n|\r|\n/g) ?? [];
    result = result.slice(0, edit.start) + `${edit.name}=(${overrides.get(edit.name)});${lineBreaks.join("")}` + result.slice(edit.end);
  }
  const declarations = [...overrides].filter(([name]) => !replaced.has(name)).map(([name, value]) => `${name}=(${value});`);
  if (declarations.length) result += `${result.endsWith("\n") || result.endsWith("\r") ? "" : "\n"}${declarations.join("\n")}\n`;
  return result;
}

function parseDependencies(makefile: string): string[] {
  const flattened = makefile.replace(/\\\r?\n/g, " ");
  let colon = -1;
  for (let index = 0; index < flattened.length; index++) {
    if (flattened[index] === ":" && /\s/.test(flattened[index + 1] ?? "")) { colon = index; break; }
  }
  if (colon < 0) return [];
  const words: string[] = [];
  const body = flattened.slice(colon + 1);
  let word = "";
  let escaped = false;
  for (const char of body) {
    if (escaped) { word += char; escaped = false; }
    else if (char === "\\") escaped = true;
    else if (/\s/.test(char)) { if (word) words.push(word); word = ""; }
    else word += char;
  }
  if (word) words.push(word);
  return words;
}

function termination(pid: number | undefined): Promise<void> {
  if (!pid) return Promise.resolve();
  if (IS_WINDOWS) {
    const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    return new Promise((resolve) => {
      let done = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      let killer;
      try { killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
      catch { finish(); return; }
      timer = setTimeout(() => { try { killer.kill("SIGKILL"); } catch {} finish(); }, 2_000);
      killer.on("error", finish);
      killer.on("close", finish);
    });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
    return Promise.resolve();
  }
}

async function run(executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal; maxBytes?: number }) {
  if (options.signal?.aborted) throw abortError();
  return await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, { cwd: options.cwd, env: options.env, windowsHide: true, detached: !IS_WINDOWS, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) { reject(error); return; }
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let closed = false;
    let failure: Error | null = null;
    let fallbackTimer: NodeJS.Timeout | undefined;
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); };
    const fail = (error: Error) => {
      if (settled || failure) return;
      failure = error;
      clearTimeout(timer);
      void termination(child.pid);
      fallbackTimer = setTimeout(() => { if (!closed) { try { child.kill("SIGKILL"); } catch {} } }, 2_500);
    };
    const onAbort = () => fail(abortError());
    const timer = setTimeout(() => fail(new Error(`OpenSCAD timed out after ${options.timeoutMs} ms`)), options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > (options.maxBytes ?? MAX_OUTPUT_BYTES)) { fail(new Error("OpenSCAD output exceeded the size limit")); return; }
      if (target === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", (error) => fail(new Error(`Could not start OpenSCAD: ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      closed = true;
      settled = true; cleanup(); clearTimeout(fallbackTimer);
      if (failure) { reject(failure); return; }
      resolve({ stdout, stderr, code });
    });
  });
}

async function acquire(signal?: AbortSignal) {
  const release = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiters.shift();
      if (next) {
        next.signal?.removeEventListener("abort", next.onAbort);
        next.resolve(release());
      } else active--;
    };
  };
  if (signal?.aborted) throw abortError();
  if (active < MAX_CONCURRENCY) { active++; return release(); }
  return await new Promise<() => void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        signal?.removeEventListener("abort", waiter.onAbort);
        reject(abortError());
      },
    };
    waiters.push(waiter);
    signal?.addEventListener("abort", waiter.onAbort, { once: true });
  });
}

async function executableAndVersion() {
  const fallback = IS_WINDOWS ? path.join(process.env.ProgramFiles || "C:\\Program Files", "OpenSCAD", "openscad.com") : "openscad";
  if (!process.env.LAYERLING_OPENSCAD_EXECUTABLE && process.env.NODE_ENV !== "test") throw new Error("LAYERLING_OPENSCAD_EXECUTABLE must point to the OpenSCAD executable");
  const executable = process.env.LAYERLING_OPENSCAD_EXECUTABLE || fallback;
  const result = await run(executable, ["--version"], { cwd: process.cwd(), env: process.env, timeoutMs: 30_000, maxBytes: 16_384 });
  const version = `${result.stdout}\n${result.stderr}`.match(/OpenSCAD version\s+([^\s]+)/i)?.[1];
  if (result.code !== 0 || !version) throw new Error(`OpenSCAD executable did not report a version: ${executable}`);
  const executablePath = await fs.realpath(executable);
  const executableStat = await fs.stat(executablePath);
  return { executable, executablePath, executableMtimeMs: executableStat.mtimeMs, executableSize: executableStat.size, version };
}

function makeOutputFiles(dependencies: Array<{ path: string; absolutePath?: string; sha256: string }>, embedded: Record<string, { encoding: "utf8" | "base64"; data: string }>): Record<string, { encoding: "utf8" | "base64"; data: string }> {
  const result = { ...embedded };
  for (const dependency of dependencies) {
    if (!dependency.absolutePath) continue;
    const bytes = requireBuffer(dependency.absolutePath);
    const text = bytes.toString("utf8");
    if (Buffer.from(text, "utf8").equals(bytes)) result[dependency.path] = { encoding: "utf8", data: text };
    else result[dependency.path] = { encoding: "base64", data: bytes.toString("base64") };
  }
  return result;
}

function cacheEntryBytes(entry: CacheEntry) {
  return entry.stlBase64.length + Object.values(entry.files).reduce((sum, file) => sum + (file.encoding === "utf8" ? Buffer.byteLength(file.data) : Math.floor(file.data.length * 3 / 4)), 0);
}

function deleteCacheEntry(key: string) {
  const entry = cache.get(key);
  if (entry) cacheBytes -= cacheEntryBytes(entry);
  cache.delete(key);
}

// Keep this synchronous read isolated from the async filesystem module above.
function requireBuffer(filePath: string): Buffer {
  return readFileSync(filePath);
}

export async function renderOpenScad(input: OpenScadInput, signal?: AbortSignal): Promise<OpenScadResult> {
  if (Buffer.byteLength(input.source, "utf8") > MAX_SOURCE_BYTES) throw new Error("OpenSCAD source exceeds the 2 MiB limit");
  if (signal?.aborted) throw abortError();
  const embedded = input.files ?? {};
  if (Object.keys(embedded).length > MAX_FILES) throw new Error(`OpenSCAD accepts at most ${MAX_FILES} embedded files`);
  let totalBytes = Buffer.byteLength(input.source, "utf8");
  for (const [name, file] of Object.entries(embedded)) {
    cleanRelative(name, "Embedded file path");
    if (file.encoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw new Error(`Embedded file '${name}' has invalid base64 data`);
    const size = file.encoding === "utf8" ? Buffer.byteLength(file.data) : Buffer.from(file.data, "base64").length;
    if (size > MAX_FILE_BYTES) throw new Error(`Embedded file '${name}' exceeds the 32 MiB limit`);
    totalBytes += size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("OpenSCAD source and files exceed the 128 MiB limit");
  const fileName = cleanRelative(input.fileName || "model.scad", "OpenSCAD file name");
  if (!fileName.toLowerCase().endsWith(".scad")) throw new Error("OpenSCAD source file name must end in .scad");
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const release = await acquire(signal);
  const started = Date.now();
  let tempDir = "";
  try {
    const { executable, executablePath, executableMtimeMs, executableSize, version } = await executableAndVersion();
    const safeParams = input.parameters ?? {};
    const safeExpressions = input.expressions ?? {};
    const evaluationSource = sourceWithOverrides(input.source, safeParams, safeExpressions);
    const liveRoots = [input.sourceDirectory, ...(input.libraryPaths ?? []), process.env.OPENSCADPATH]
      .filter((part): part is string => Boolean(part)).flatMap((part) => part.split(path.delimiter)).map((part) => path.resolve(part));
    const canonical = JSON.stringify({ executablePath, executableMtimeMs, executableSize, version, source: input.source, fileName, parameters: safeParams, expressions: safeExpressions, files: embedded, libraryPaths: liveRoots });
    const baseKey = HASH(canonical);
    const tempRoot = path.join(process.env.LAYERLING_DESKTOP_DATA || os.tmpdir(), "scad");
    await fs.mkdir(tempRoot, { recursive: true });

    const cached = cache.get(baseKey);
    if (cached) {
      let unchanged = true;
      for (const dependency of cached.dependencyFiles) {
        if (!dependency.absolutePath) continue;
        try { if (HASH(await fs.readFile(dependency.absolutePath)) !== dependency.sha256) { unchanged = false; break; } }
        catch { unchanged = false; break; }
      }
      if (unchanged) {
        cache.delete(baseKey); cache.set(baseKey, cached);
        return { stlBase64: cached.stlBase64, key: cached.key, cached: true, durationMs: Date.now() - started, engineVersion: version, dependencies: cached.dependencies, files: cached.files, diagnostics: cached.diagnostics };
      }
    }

    tempDir = await fs.mkdtemp(path.join(tempRoot, "render-"));
    const mainPath = path.join(tempDir, ...fileName.split("/"));
    await fs.mkdir(path.dirname(mainPath), { recursive: true });
    await fs.writeFile(mainPath, evaluationSource, "utf8");
    const outPath = path.join(tempDir, "result.stl");
    const depPath = path.join(tempDir, "deps.mk");
    const stagedImports = new Map<string, { originalPath: string; portablePath: string }>();
    for (const [name, file] of Object.entries(embedded)) {
      const embeddedPath = path.join(tempDir, "embeddedfiles", ...name.split("/"));
      await fs.mkdir(path.dirname(embeddedPath), { recursive: true });
      const content = file.encoding === "utf8" ? file.data : Buffer.from(file.data, "base64");
      await fs.writeFile(embeddedPath, content);
      const portablePath = name.startsWith("project/") ? name.slice("project/".length) : /^library-\d+\//.test(name) ? null : name;
      if (portablePath) {
        const relativePath = cleanRelative(portablePath, "Embedded source path");
        const materializedPath = path.join(tempDir, ...relativePath.split("/"));
        if (materializedPath === mainPath || materializedPath === outPath || materializedPath === depPath) throw new Error(`Embedded path '${name}' collides with an OpenSCAD working file`);
        await fs.mkdir(path.dirname(materializedPath), { recursive: true });
        await fs.writeFile(materializedPath, content);
      }
    }
    const sourceBase = path.join(input.sourceDirectory ? path.resolve(input.sourceDirectory) : tempDir, path.dirname(fileName));
    const importReferences = [...input.source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
    for (const reference of importReferences) {
      let relative: string;
      try { relative = cleanRelative(reference, "OpenSCAD import path"); } catch { continue; }
      const candidates = [sourceBase, ...liveRoots.slice(input.sourceDirectory ? 1 : 0)].map((root) => path.resolve(root, ...relative.split("/")));
      let found: string | undefined;
      for (const candidate of candidates) {
        try { if ((await fs.stat(candidate)).isFile()) { found = candidate; break; } } catch {}
      }
      if (!found || found.startsWith(`${tempDir}${path.sep}`)) continue;
      const stagedPath = path.resolve(tempDir, ...relative.split("/"));
      if (stagedPath === mainPath || stagedPath === outPath || stagedPath === depPath) throw new Error(`OpenSCAD import path '${reference}' collides with a working file`);
      await fs.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.copyFile(found, stagedPath);
      const rootIndex = liveRoots.findIndex((root) => found === root || found!.startsWith(`${root}${path.sep}`));
      const portablePath = rootIndex >= 0
        ? `${rootIndex === 0 && input.sourceDirectory ? "project" : `library-${rootIndex}`}/${path.relative(liveRoots[rootIndex], found).split(path.sep).join("/")}`
        : `project/${path.relative(sourceBase, found).split(path.sep).join("/")}`;
      stagedImports.set(stagedPath, { originalPath: found, portablePath });
    }
    let cwd = tempDir;
    if (input.sourceDirectory) {
      try { if ((await fs.stat(input.sourceDirectory)).isDirectory()) cwd = path.resolve(input.sourceDirectory); }
      catch { /* A stale project directory falls back to the isolated render directory. */ }
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    const embeddedRoot = path.join(tempDir, "embeddedfiles");
    const snapshotRoots = Object.keys(embedded).map((key) => key.split("/")[0])
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => value === "project" || /^library-\d+$/.test(value))
      .map((value) => path.join(embeddedRoot, value));
    const searchRoots = [...liveRoots, embeddedRoot, ...snapshotRoots];
    if (searchRoots.length) env.OPENSCADPATH = [...new Set(searchRoots)].join(path.delimiter);
    const result = await run(executable, [mainPath, "-o", outPath, "--export-format", "binstl", "-d", depPath, "--hardwarnings", "-D", "$preview=false"], { cwd, env, timeoutMs, signal });
    const diagnostics = `${result.stdout}\n${result.stderr}`.trim().slice(0, MAX_OUTPUT_BYTES);
    if (result.code !== 0) throw new Error(`OpenSCAD failed (exit ${result.code}): ${diagnostics || "no diagnostic output"}`);
    const stlStat = await fs.stat(outPath).catch(() => null);
    if (stlStat && stlStat.size > 64 * 1024 * 1024) throw new Error("OpenSCAD STL output exceeded the 64 MiB limit");
    const stl = stlStat ? await fs.readFile(outPath) : null;
    if (!stl?.length) throw new Error(`OpenSCAD produced no STL: ${diagnostics || "empty output"}`);
    const reported = await fs.readFile(depPath, "utf8").then(parseDependencies).catch(() => []);
    const dependencyFiles: Array<{ path: string; absolutePath?: string; sha256: string }> = [];
    let dependencyBytes = 0;
    for (const item of reported) {
      const absolutePath = path.resolve(tempDir, item);
      if (absolutePath === mainPath || absolutePath === outPath || absolutePath === depPath) continue;
      let bytes: Buffer;
      try { bytes = await fs.readFile(absolutePath); } catch { continue; }
      dependencyBytes += bytes.length;
      if (dependencyFiles.length >= MAX_FILES || dependencyBytes > MAX_TOTAL_BYTES) throw new Error("OpenSCAD resolved dependencies exceed the file count or byte limit");
      const staged = stagedImports.get(absolutePath);
      if (absolutePath.startsWith(`${tempDir}${path.sep}`) && !staged) {
        const relative = path.relative(tempDir, absolutePath).split(path.sep).join("/");
        const snapshotKey = embedded[`project/${relative}`] ? `project/${relative}` : embedded[relative] ? relative : undefined;
        if (!snapshotKey) continue;
        dependencyFiles.push({ path: snapshotKey, sha256: HASH(bytes) });
        continue;
      }
      const diskPath = staged?.originalPath ?? absolutePath;
      const rootIndex = liveRoots.findIndex((candidate) => diskPath === candidate || diskPath.startsWith(`${candidate}${path.sep}`));
      const root = rootIndex < 0 ? undefined : liveRoots[rootIndex];
      const relative = root ? path.relative(root, diskPath).split(path.sep).join("/") : path.basename(diskPath);
      const portable = staged?.portablePath ?? (root ? `${rootIndex === 0 && input.sourceDirectory ? "project" : `library-${rootIndex}`}/${relative}` : `dependencies/${relative}`);
      dependencyFiles.push({ path: portable, absolutePath: diskPath, sha256: HASH(bytes) });
    }
    const dependencies = dependencyFiles.map(({ path: dependencyPath, sha256 }) => ({ path: dependencyPath, sha256 }));
    const files = makeOutputFiles(dependencyFiles, embedded);
    const key = HASH(`${baseKey}:${dependencyFiles.map(({ path: p, sha256 }) => `${p}:${sha256}`).sort().join("|")}`);
    const entry: CacheEntry = { stlBase64: stl.toString("base64"), key, cached: false, durationMs: Date.now() - started, engineVersion: version, dependencies, files, diagnostics, dependencyFiles };
    deleteCacheEntry(baseKey);
    cache.set(baseKey, entry);
    cacheBytes += cacheEntryBytes(entry);
    while (cache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) deleteCacheEntry(cache.keys().next().value!);
    return { stlBase64: entry.stlBase64, key, cached: false, durationMs: entry.durationMs, engineVersion: version, dependencies, files, diagnostics };
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    release();
  }
}

