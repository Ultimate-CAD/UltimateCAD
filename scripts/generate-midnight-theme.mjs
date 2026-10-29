import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphiteThemeCss, readGraphiteSources } from './generate-graphite-theme.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Reuse the established neutral-dark conversion without changing Graphite itself.
const neutral = graphiteThemeCss(readGraphiteSources(root)).replaceAll('data-palette="graphite"', 'data-palette="midnight"')
  // Next can place route CSS after <head>. Give every generated selector one
  // equal specificity step so neutral overrides survive either load order.
  .replaceAll(':where(html[data-theme="dark"][data-palette="midnight"])', ':where(html[data-theme="dark"])[data-palette="midnight"]')
  .replaceAll('html[data-theme="dark"]:where([data-palette="midnight"])', 'html[data-theme="dark"][data-palette="midnight"]');
const personal = readFileSync(path.join(root, 'apps/web/src/app/midnightTheme.css'), 'utf8')
  .replaceAll('html[data-palette="midnight"]', 'html[data-theme="dark"][data-palette="midnight"]');
writeFileSync(path.join(root, 'apps/web/public/assets/theme/midnight-theme.css'), neutral + '\n' + personal);
