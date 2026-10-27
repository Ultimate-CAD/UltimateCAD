"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkplaneShape } from "@/types/layerling";
import { newOpenScadDocument, type OpenScadDocument, type ScadParameter, type ScadRenderResult, type ScadValue } from "@/lib/openScadTypes";
import { parseCustomizer } from "@/lib/openscad/vendor/scadParser.cjs";
import "./OpenScadWorkbench.css";

type Applied = { shape: WorkplaneShape; result: ScadRenderResult };
export function OpenScadWorkbench({ shape, onApply, onKeepSource, onClose }: {
  shape: WorkplaneShape | null;
  onApply: (document: OpenScadDocument, targetId: string | null, signal: AbortSignal) => Promise<Applied>;
  onKeepSource: (document: OpenScadDocument, targetId: string) => void;
  onClose: () => void;
}) {
  const target = shape?.openScad ? shape : null;
  const [document, setDocument] = useState<OpenScadDocument>(() => target?.openScad ?? newOpenScadDocument());
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState("");
  const [stats, setStats] = useState<ScadRenderResult | null>(null);
  const [presetName, setPresetName] = useState("");
  const controller = useRef<AbortController | null>(null);
  const pendingInput = useRef<string | null>(null);
  const pendingCore = useRef<string | null>(null);
  const coreKey = (doc: OpenScadDocument) => JSON.stringify([doc.source, doc.parameters, doc.expressions, doc.fileName]);
  const editKey = (doc: OpenScadDocument) => JSON.stringify([doc.source, doc.parameters, doc.expressions, doc.files, doc.libraryPaths, doc.sourceDirectory]);
  const lastApplied = useRef(target?.openScad ? editKey(target.openScad) : "");
  const previousTarget = useRef(target?.id ?? null);
  const persisted = useRef(target?.openScad);
  const applyRef = useRef(onApply); applyRef.current = onApply;
  const targetId = target?.id ?? null;
  const documentRef = useRef(document); documentRef.current = document;
  const schema = useMemo(() => parseCustomizer(document.source), [document.source]);
  const key = editKey(document);

  useLayoutEffect(() => {
    if (previousTarget.current === targetId) return;
    previousTarget.current = targetId;
    if (target?.openScad && pendingCore.current === coreKey(target.openScad)) { persisted.current = target.openScad; return; }
    controller.current?.abort();
    persisted.current = target?.openScad;
    const next = target?.openScad ?? newOpenScadDocument();
    setDocument(next); setStats(null); setDiagnostics("");
    // An imported/reopened document already has its saved mesh. Editing triggers regeneration.
    lastApplied.current = target?.openScad ? editKey(next) : "";
  }, [targetId]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (target?.openScad && target.openScad !== persisted.current) {
      if (pendingCore.current === coreKey(target.openScad)) { persisted.current = target.openScad; return; }
      controller.current?.abort(); persisted.current = target.openScad;
      setDocument(target.openScad); lastApplied.current = editKey(target.openScad);
    }
  }, [target?.openScad]);
  useEffect(() => () => controller.current?.abort(), []);

  const regenerate = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(true); setDiagnostics("");
    const draft = documentRef.current;
    pendingInput.current = editKey(draft); pendingCore.current = coreKey(draft);
    try {
      const applied = await applyRef.current(draft, targetId, active.signal);
      if (active.signal.aborted) return;
      const next = applied.shape.openScad!;
      persisted.current = next; lastApplied.current = editKey(next);
      pendingInput.current = null; pendingCore.current = null;
      setDocument(next); setStats(applied.result); setDiagnostics(applied.result.diagnostics);
    } catch (error) {
      if (active.signal.aborted || (error instanceof Error && error.name === "AbortError")) setDiagnostics("Render canceled. The previous mesh is unchanged.");
      else setDiagnostics(error instanceof Error ? error.message : String(error));
    } finally { if (controller.current === active) { pendingInput.current = null; pendingCore.current = null; setBusy(false); } }
  }, [targetId]);
  useEffect(() => {
    if (!live || key === lastApplied.current) return;
    // A blank, new workbench waits for an explicit first Generate.
    if (!targetId && key === editKey(newOpenScadDocument())) return;
    const timer = window.setTimeout(() => void regenerate(), 700);
    return () => window.clearTimeout(timer);
  }, [key, live, regenerate, targetId]);
  useEffect(() => { if (pendingInput.current && pendingInput.current !== key) controller.current?.abort(); }, [key]);

  const parameterValue = (parameter: ScadParameter) => document.parameters[parameter.name] ?? parameter.default;
  const setParameter = (name: string, value: ScadValue) => setDocument(doc => ({ ...doc, parameters: { ...doc.parameters, [name]: value } }));
  const control = (parameter: ScadParameter) => {
    const value = parameterValue(parameter);
    const disabled = Boolean(document.expressions[parameter.name]);
    const label = `SCAD ${parameter.name}`;
    if (parameter.options?.length) return <select aria-label={label} value={JSON.stringify(value)} disabled={disabled} onChange={event => setParameter(parameter.name, JSON.parse(event.target.value))}>
      {parameter.options.map(option => <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>{option.label}</option>)}
    </select>;
    if (parameter.type === "boolean") return <input aria-label={label} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={event => setParameter(parameter.name, event.target.checked)} />;
    if (parameter.type === "number") return <input aria-label={label} type="text" inputMode="decimal" value={value as number} disabled={disabled} onChange={event => { const n = Number(event.target.value.replace(",", ".")); if (event.target.value.trim() !== "" && Number.isFinite(n)) setParameter(parameter.name, n); }} />;
    return <input aria-label={label} value={Array.isArray(value) ? JSON.stringify(value) : String(value)} disabled={disabled} onChange={event => {
      if (parameter.type !== "vector") setParameter(parameter.name, event.target.value);
      else { try { const next = JSON.parse(event.target.value); if (Array.isArray(next) && next.every(Number.isFinite)) setParameter(parameter.name, next); } catch { /* keep last valid vector */ } }
    }} />;
  };

  return <aside className="openscad-workbench" aria-label="OpenSCAD workbench">
    <header><strong>OpenSCAD workbench</strong><button type="button" onClick={onClose} aria-label="Close OpenSCAD workbench">×</button></header>
    <p className="scad-representation">{target ? `${target.name} · ` : "New object · "}Script-driven triangle mesh · {document.engineVersion ? `OpenSCAD ${document.engineVersion}` : "Native local engine"}</p>
    <div className="scad-actions">
      <button type="button" onClick={() => void regenerate()}>Regenerate</button>
      <button type="button" disabled={!busy} onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancel render</button>
      <label><input type="checkbox" checked={live} onChange={event => setLive(event.target.checked)} /> Live preview</label>
      <button type="button" disabled={!targetId} onClick={() => { if (targetId) { onKeepSource(document, targetId); persisted.current = document; } }}>Keep source in project</button>
    </div>
    <p role="status" data-testid="scad-status">{busy ? "Rendering…" : document.needsRegeneration ? "Source saved; mesh needs regeneration" : stats ? `${stats.cached ? "Cache hit" : "Rendered"} · ${stats.durationMs} ms · ${stats.dependencies.length} dependencies` : target ? "Saved mesh ready" : "Generate to add a SCAD object"}</p>
    <details open><summary>Parameters</summary>
      {schema.groups.map(group => <fieldset key={group}><legend>{group}</legend>{schema.parameters.filter(parameter => parameter.group === group).map(parameter => <div className="scad-parameter" key={parameter.name}>
        <label><span>{parameter.name}</span>{control(parameter)}</label>
        {parameter.description ? <small>{parameter.description}</small> : null}
        <input aria-label={`SCAD ${parameter.name} expression`} placeholder="Equation override, e.g. width/2" value={document.expressions[parameter.name] ?? ""} onChange={event => setDocument(doc => ({ ...doc, expressions: { ...doc.expressions, [parameter.name]: event.target.value } }))} />
      </div>)}</fieldset>)}
      {!schema.parameters.length ? <p>No literal Customizer variables found. Edit the source or use the expression overrides below.</p> : null}
    </details>
    <details><summary>Named configurations</summary>
      <label>Preset name <input aria-label="SCAD preset name" value={presetName} onChange={event => setPresetName(event.target.value)} /></label>
      <button type="button" disabled={!presetName.trim()} onClick={() => {
        const next = { ...document, presets: { ...document.presets, [presetName.trim()]: { parameters: { ...document.parameters }, expressions: { ...document.expressions } } } };
        setDocument(next); if (targetId) { onKeepSource(next, targetId); persisted.current = next; }
      }}>Save preset</button>
      <select aria-label="SCAD named configuration" value="" onChange={event => {
        const preset = document.presets[event.target.value];
        if (preset) setDocument(doc => ({ ...doc, parameters: { ...preset.parameters }, expressions: { ...preset.expressions } }));
      }}><option value="">Apply configuration…</option>{Object.keys(document.presets).map(name => <option key={name}>{name}</option>)}</select>
    </details>
    <details open><summary>SCAD source</summary>
      <label>File name <input aria-label="SCAD file name" value={document.fileName} onChange={event => setDocument(doc => ({ ...doc, fileName: event.target.value }))} /></label>
      <textarea aria-label="SCAD source" spellCheck={false} value={document.source} onChange={event => setDocument(doc => ({ ...doc, source: event.target.value }))} />
      <small>Successful regeneration saves source and parameters in one undoable edit. Keep source stores a draft with the last valid mesh.</small>
    </details>
    <details><summary>Libraries and dependency files</summary>
      <p>include/use paths are resolved from the original file folder, library folders below, bundled libraries and files saved in the project.</p>
      <textarea aria-label="SCAD library folders" rows={3} value={document.libraryPaths.join("\n")} onChange={event => setDocument(doc => ({ ...doc, libraryPaths: event.target.value.split(/\r?\n/).map(path => path.trim()).filter(Boolean) }))} />
      <label>Add library or asset files <input type="file" multiple aria-label="SCAD dependency files" onChange={async event => {
        const files = [...(event.target.files ?? [])];
        const updates: OpenScadDocument["files"] = {};
        for (const file of files) {
          if (/\.(scad|json|txt|dat|csv)$/i.test(file.name)) updates[file.webkitRelativePath || file.name] = { encoding: "utf8", data: await file.text() };
          else { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let n = 0; n < bytes.length; n += 8192) binary += String.fromCharCode(...bytes.subarray(n, n + 8192)); updates[file.webkitRelativePath || file.name] = { encoding: "base64", data: btoa(binary) }; }
        }
        setDocument(doc => ({ ...doc, files: { ...doc.files, ...updates } }));
      }} /></label>
      <ul>{Object.keys(document.files).map(name => <li key={name}>{name}</li>)}</ul>
    </details>
    <details open={Boolean(diagnostics)}><summary>Engine diagnostics</summary><pre role="log">{diagnostics || "No errors."}</pre></details>
  </aside>;
}
