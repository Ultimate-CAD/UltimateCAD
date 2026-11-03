import { useEffect, useState, type InputHTMLAttributes } from "react";
import { parseMeasurementInput } from "@/lib/measurementUnits";

/** Keep incomplete typed measures editable; publish only finite canonical values. */
export function MeasurementInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | string;
  onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input {...props} type="text" inputMode="decimal" value={draft}
    onChange={event => {
      setDraft(event.target.value);
      const parsed = parseMeasurementInput(event.target.value);
      if (Number.isFinite(parsed)) onValueChange(parsed);
    }}
    onBlur={event => {
      setDraft(String(value));
      props.onBlur?.(event);
    }} />;
}
