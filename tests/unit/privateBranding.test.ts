// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AppFooter } from "@/components/AppFooter";
import { PRODUCT_BRANDING, brandInterfaceTemplate } from "@/lib/productBranding";
import { isInterfaceSentence, translate } from "@/lib/i18n";

vi.mock("@/lib/useLanguage", () => ({ useLanguage: () => "en" }));
vi.mock("@/lib/useSimpleMode", () => ({ useSimpleMode: () => false }));
afterEach(() => vi.unstubAllGlobals());

it("rebrands interface templates without modifying filenames, URLs or attribution", () => {
  expect(translate("en", "brand.home")).toContain(PRODUCT_BRANDING.name);
  expect(
    translate("en", "notice.openedLocalProject", {
      name: "Layerling.original.lyl",
    }),
  ).toBe("Opened Layerling.original.lyl as a new local design");
  expect(brandInterfaceTemplate("Layerling contributors", "footer.trademark")).toBe("Layerling contributors");
  expect(
    brandInterfaceTemplate("https://github.com/henmedia/layerling", "link.url"),
  ).toBe("https://github.com/henmedia/layerling");
  expect(isInterfaceSentence(translate("en", "brand.home"), "en")).toBe(true);
});

it("renders only local footer navigation and never starts the upstream update fetch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AppFooter, { version: "1.114.0" })));
    expect(host.textContent).toContain(PRODUCT_BRANDING.version);
    expect([...host.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"))).toEqual([
      "/guide/index.html",
      "/desktop/about.html",
    ]);
    expect(host.textContent).not.toMatch(/GitHub|donat|sponsor|release notes|discussions/i);
    window.dispatchEvent(new Event("online"));
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
