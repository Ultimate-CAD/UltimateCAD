export type GeometrySpan = {
  name: string;
  startMs: number;
  durationMs: number;
  depth: number;
};
let sink: ((span: GeometrySpan) => void) | undefined;
let depth = 0;
const noop = () => {};

/** Opt-in diagnostics, local to the current JS/worker realm. No per-triangle events. */
export function observeGeometryTiming(observer?: (span: GeometrySpan) => void) {
  sink = observer;
  depth = 0;
}
export function startGeometryTiming(name: string): () => void {
  const observer = sink;
  if (!observer) return noop;
  const startMs = performance.now(),
    level = depth++;
  return () => {
    depth--;
    observer({
      name,
      startMs,
      durationMs: performance.now() - startMs,
      depth: level,
    });
  };
}
export function withGeometryTiming<T>(name: string, action: () => T): T {
  if (!sink) return action();
  const end = startGeometryTiming(name);
  try {
    return action();
  } finally {
    end();
  }
}
