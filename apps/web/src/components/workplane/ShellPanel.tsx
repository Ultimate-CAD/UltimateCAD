"use client";

import { GuideHelpLink } from "@/components/GuideHelpLink";
import { MovableToolPanel } from "@/components/workplane/MovableToolPanel";
import { Check, LoaderCircle, X } from "lucide-react";
import { EdgeFeatureHistory, EdgeModifierSlider, type EdgeHistoryOption } from "@/components/workplane/EdgeModifierPanel";
import { cadModifierUserErrorMessage } from "@/lib/cadModifierRuntime";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/lib/useLanguage";
import { MIN_SHELL_WALL, SHELL_SIDES, shellOpeningsFor, shellOpenSides } from "@/lib/shellLimits";
import type { ShellEdges, ShellOpenings, ShellOptions, WorkplaneWorkspaceSettings } from "@/types/layerling";

const SHELL_EDGES: readonly ShellEdges[] = ["round", "sharp"];
const MIN_WALL = MIN_SHELL_WALL;
const WALL_STEP = 0.1;

/** The panel's error in words; a wall that is too thick on a box with rounded top and bottom edges says why (#401). */
function shellErrorMessage(error: string, roundedEdgesHint?: boolean) {
  const message = cadModifierUserErrorMessage(error);
  if (roundedEdgesHint && message === t("shell.errorTooThick")) return `${message} ${t("shell.errorRoundedEdges")}`;
  return message;
}

/**
 * Hollowing a body: one wall thickness and which side stays open. The walls
 * grow inward, so the outside of the body does not move.
 */
export function ShellPanel({
  targetName,
  thickness,
  maxThickness,
  openings,
  edges,
  workspace,
  busy,
  error,
  roundedEdgesHint,
  appliedFeatureCount,
  reversibleFeatureCount,
  historyOptions,
  onRemoveFeature,
  onEditFeature,
  onThicknessChange,
  onOpeningsChange,
  onEdgesChange,
  onApply,
  onCancel,
  options = {},
  onOptionsChange,
  meshSource = false,
}: {
  targetName: string;
  thickness: number;
  maxThickness: number;
  openings: ShellOpenings;
  edges: ShellEdges;
  workspace: WorkplaneWorkspaceSettings;
  busy: boolean;
  error: string | null;
  /** A rounded box with rounded top and bottom edges: a wall that is too thick has that as its reason (#401). */
  roundedEdgesHint?: boolean;
  /** The treatments the body already has, to revert or edit (#237). */
  appliedFeatureCount: number;
  reversibleFeatureCount: number;
  historyOptions: EdgeHistoryOption[];
  onRemoveFeature: (id: string) => void;
  onEditFeature?: (id: string) => void;
  onThicknessChange: (value: number) => void;
  onOpeningsChange: (value: ShellOpenings) => void;
  onEdgesChange: (value: ShellEdges) => void;
  onApply: () => void;
  onCancel: () => void;
  options?: ShellOptions;
  onOptionsChange?: (value: ShellOptions) => void;
  meshSource?: boolean;
}) {
  useLanguage();
  const openSides = shellOpenSides(openings);
  const title = t("shell.title");
  return (
    <MovableToolPanel className="edge-modifier-panel shell-panel" ariaLabel={title}>
      {(handleProps) => (<>
      <div className="edge-modifier-header movable" title={t("panel.moveHint")} {...handleProps}>
        <div>
          <strong>{title}</strong>
          <span>{t("shell.subtitle")}</span>
        </div>
        <div className="panel-header-actions">
          <GuideHelpLink section="hollowing" />
          <button type="button" aria-label={t("shell.cancel")} onClick={onCancel}><X size={20} /></button>
        </div>
      </div>

      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>{t("shell.help")}</span>
      </div>

      <EdgeFeatureHistory
        appliedFeatureCount={appliedFeatureCount}
        reversibleFeatureCount={reversibleFeatureCount}
        historyOptions={historyOptions}
        onRemoveFeature={onRemoveFeature}
        onEditFeature={onEditFeature}
      />

      <EdgeModifierSlider
        label={t("shell.wall")}
        value={thickness}
        min={MIN_WALL}
        max={Math.max(MIN_WALL, maxThickness)}
        step={WALL_STEP}
        workspace={workspace}
        length
        disabled={busy}
        onChange={onThicknessChange}
      />

      <div className="edge-modifier-field">
        <label>Wall direction <select aria-label="Shell wall direction" disabled={busy} value={options.direction ?? "inward"}
          onChange={event => onOptionsChange?.({ ...options, direction: event.target.value as "inward" | "outward" })}>
          <option value="inward">Inward — keep outside dimensions</option>
          <option value="outward">Outward — keep cavity dimensions</option>
        </select></label>
        <label>Reconstruction tolerance <select aria-label="Shell reconstruction tolerance" disabled={busy} value={options.tolerance ?? 1e-6}
          onChange={event => onOptionsChange?.({ ...options, tolerance: Number(event.target.value) })}>
          <option value={1e-6}>0.000001 mm — precise</option>
          <option value={1e-4}>0.0001 mm</option>
          <option value={1e-3}>0.001 mm — tolerant</option>
        </select></label>
        <span className="shell-openings-summary">{meshSource
          ? "Faceted mesh source. Planar fitting allowance: 0.002 mm; curved detail remains limited to the original facets."
          : "Native CAD surfaces are retained when available."} Offset tolerance is a reconstruction setting, not a guarantee of minimum wall clearance.</span>
      </div>

      <div className="edge-modifier-field shell-openings" role="group" aria-label={t("shell.openings")}>
        <span>{t("shell.openings")}</span>
        {/* Any set of sides; none at all seals the cavity. */}
        <div className="shell-opening-options shell-side-options">
          {SHELL_SIDES.map((side) => {
            const open = openSides.includes(side);
            return (
              <button
                key={side}
                type="button"
                aria-pressed={open}
                className={open ? "active" : ""}
                disabled={busy}
                onClick={() => onOpeningsChange(shellOpeningsFor(open ? openSides.filter((other) => other !== side) : [...openSides, side]))}
              >
                {t(`shell.side.${side}`)}
              </button>
            );
          })}
        </div>
        {/* No side open, in one click: the cavity sealed inside (#658). */}
        <div className="shell-opening-options shell-closed-option">
          <button
            type="button"
            aria-pressed={openSides.length === 0}
            className={openSides.length === 0 ? "active" : ""}
            disabled={busy}
            onClick={() => onOpeningsChange(shellOpeningsFor([]))}
          >
            {t("shell.side.closed")}
          </button>
        </div>
        <span className="shell-openings-summary">{openSides.length === 0 ? t("shell.sidesNone") : t("shell.sidesHint")}</span>
      </div>

      <div className="edge-modifier-field shell-openings" role="radiogroup" aria-label={t("shell.edges")}>
        <span>{t("shell.edges")}</span>
        <div className="shell-opening-options">
          {SHELL_EDGES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={edges === option}
              className={edges === option ? "active" : ""}
              disabled={busy}
              onClick={() => onEdgesChange(option)}
            >
              {t(`shell.edges.${option}`)}
            </button>
          ))}
        </div>
        <span className="shell-openings-summary">{t("shell.edgesHint")}</span>
      </div>

      {error ? <div className="edge-modifier-error" role="alert">{shellErrorMessage(error, roundedEdgesHint)}</div> : null}
      <div className="edge-modifier-footer">
        <button type="button" className="secondary" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="button" className="primary" disabled={busy} onClick={onApply}>
          {busy ? <LoaderCircle className="edge-modifier-spinner" size={17} /> : <Check size={17} />}
          {busy ? t("shell.working") : t("shell.apply")}
        </button>
      </div>
      </>)}
    </MovableToolPanel>
  );
}
