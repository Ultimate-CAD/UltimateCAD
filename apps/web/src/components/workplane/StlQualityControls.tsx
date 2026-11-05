import { t } from "@/lib/i18n";
import { STL_QUALITY_PRESETS, type StlQuality } from "@/lib/stlQuality";
import { MeasurementInput } from "./MeasurementInput";

export function StlQualityControls({ value, onChange }: { value: StlQuality; onChange: (quality: StlQuality) => void }) {
  return <div>
    <p>{t("export.stlUnverified")}</p>
    <details>
      <summary>{t("export.stlQuality")}: {t(`export.stlQuality.${value.preset}`)}</summary>
      <label>{t("export.stlQuality")}
        <select aria-label={t("export.stlQuality")} value={value.preset} onChange={event => {
          const preset = event.target.value as StlQuality["preset"];
          onChange(preset === "custom" ? { ...value, preset } : { preset, ...STL_QUALITY_PRESETS[preset] });
        }}>
          {(["standard", "high", "ultra", "custom"] as const).map(preset => <option key={preset} value={preset}>{t(`export.stlQuality.${preset}`)}</option>)}
        </select>
      </label>
      {value.preset === "custom" ? <>
        <label>{t("export.stlDeviation")}<MeasurementInput aria-label={t("export.stlDeviation")} value={value.deviationMm} onValueChange={deviationMm => onChange({ ...value, deviationMm })}/></label>
        <label>{t("export.stlAngle")}<MeasurementInput aria-label={t("export.stlAngle")} value={value.angleDeg} onValueChange={angleDeg => onChange({ ...value, angleDeg })}/></label>
      </> : null}
      <p>{t("export.stlQualityHint")}</p>
    </details>
  </div>;
}
