export type StlQuality = {
  preset: "standard" | "high" | "ultra" | "custom";
  deviationMm: number;
  angleDeg: number;
};
export const STL_QUALITY_PRESETS = {
  standard: { deviationMm: 0.1, angleDeg: 15 },
  high: { deviationMm: 0.025, angleDeg: 8 },
  ultra: { deviationMm: 0.005, angleDeg: 7.5 },
};
export const DEFAULT_STL_QUALITY: StlQuality = { preset: "standard", ...STL_QUALITY_PRESETS.standard };
export function stlQualitySettings(value: StlQuality = DEFAULT_STL_QUALITY): StlQuality {
  if (!value || typeof value !== "object") throw new Error("Invalid STL quality options");
  if (!Object.hasOwn(STL_QUALITY_PRESETS, value.preset) && value.preset !== "custom") throw new Error("Unknown STL quality");
  const settings = value.preset === "custom" ? value : { preset: value.preset, ...STL_QUALITY_PRESETS[value.preset] };
  if (!Number.isFinite(settings.deviationMm) || settings.deviationMm <= 0 || !Number.isFinite(settings.angleDeg) || settings.angleDeg <= 0 || settings.angleDeg > 90)
    throw new Error("STL tessellation requires a positive deviation and an angle between 0 and 90 degrees");
  return settings;
}
