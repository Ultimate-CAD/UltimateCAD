import type { ScadSchema, ScadValue } from "../../openScadTypes";
export function parseCustomizer(source: string): ScadSchema;
export function scan(source: string): Array<{kind: string; code?: string; file?: string; name?: string; start: number; end?: number; line: number}>;
export function parseValue(source: string): {type: string; value: ScadValue} | null;
