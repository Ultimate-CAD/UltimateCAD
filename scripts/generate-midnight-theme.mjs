import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphiteThemeCss, readGraphiteSources } from './generate-graphite-theme.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Reuse the established neutral-dark conversion without changing Graphite itself.
const neutral = graphiteThemeCss(readGraphiteSources(root)).replaceAll('data-palette="graphite"', 'data-palette="midnight"');
writeFileSync(path.join(root, 'apps/web/public/assets/theme/midnight-theme.css'), neutral + '\n' + readFileSync(path.join(root, 'apps/web/src/app/midnightTheme.css'), 'utf8'));
