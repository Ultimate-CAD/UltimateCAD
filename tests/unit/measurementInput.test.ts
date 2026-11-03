// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost"}
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { MeasurementInput } from "@/components/workplane/MeasurementInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("retains incomplete measures and parses locale decimals and arithmetic without publishing NaN", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const values: number[] = [];
  act(() => root.render(createElement(MeasurementInput, { value: 10, onValueChange: value => values.push(value) })));
  const input = host.querySelector("input")!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const type = (value: string) => act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  type("-");
  expect(input.value).toBe("-");
  expect(values).toEqual([]);
  type("1,25");
  type("(2+3)/2");
  type("bad");
  expect(values).toEqual([1.25, 2.5]);
  act(() => root.unmount());
  host.remove();
});
