import definition from "@/config/productBranding.json";

/** Display identity only. Never use this for project, storage or protocol IDs. */
export const PRODUCT_BRANDING = Object.freeze(definition);
export const PRIVATE_DESKTOP = PRODUCT_BRANDING.privateDesktop;

/** Translate display templates before inserting user filenames or project data.
 * Legal notices, URL values and stored identifiers are deliberately excluded. */
export function brandInterfaceTemplate(text: string, key: string): string {
  if (!PRIVATE_DESKTOP || key === "footer.trademark" || /(?:https?:\/\/|mailto:)/i.test(text) || /url$/i.test(key)) return text;
  return text.replace(/\blayerling\b/gi, () => PRODUCT_BRANDING.name);
}
