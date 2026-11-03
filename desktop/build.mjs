import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import configuration from './branding.cjs';
import { stageLocalDocs } from './stage-local-docs.mjs';
const { brand } = configuration;
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const run = (file, args, env = {}) => {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
run('desktop/stage-branding.mjs', []);
const brandStamp = path.join(root, 'apps/web/.next/product-branding.json');
if (process.argv.includes('--stage-only')) {
  if (!existsSync(brandStamp) || readFileSync(brandStamp, 'utf8') !== JSON.stringify(brand)) throw Error('Branding changed: run a full desktop build before staging.');
} else {
  run('scripts/generate-midnight-theme.mjs', []);
  run('scripts/copy-occt-wasm.mjs', []);
  run('scripts/build-japanese-typeface.mjs', []);
  run('scripts/build-guide.mjs', [], { LAYERLING_DESKTOP_BUILD: 'true' });
  run('node_modules/next/dist/bin/next', ['build', 'apps/web'], { LAYERLING_DESKTOP_BUILD: 'true' });
  writeFileSync(brandStamp, JSON.stringify(brand));
}
const ultimate = process.env.LAYERLING_ULTIMATE_BUILD === '1';
const stage = path.join(root, ultimate ? 'dist/ultimate-stage' : 'dist/desktop-stage');
// Only delete our generated staging directory, never user data or the release directory.
if (existsSync(stage)) rmSync(stage, { recursive: true });
mkdirSync(path.join(stage, 'app/mcp'), { recursive: true });
cpSync('apps/web/.next/standalone', path.join(stage, 'runtime'), { recursive: true });
// Next traces its optional image optimizer even though images.unoptimized is true
// and Layerling has no next/image use. No native image codec is needed at runtime.
for (const relative of ['runtime/node_modules/sharp', 'runtime/node_modules/@img']) {
  const target = path.join(stage, relative);
  if (existsSync(target)) rmSync(target, { recursive: true });
}
const web = path.join(stage, 'runtime/apps/web');
cpSync('apps/web/.next/static', path.join(web, '.next/static'), { recursive: true });
cpSync('apps/web/public', path.join(web, 'public'), { recursive: true });
// The runner lives beside the app but Next resolves from its traced web directory.
for (const name of ['main.cjs', 'server.cjs', 'preload.cjs', 'fem-jobs.cjs', 'fem-deck.cjs', 'mcp-client.mjs', 'native-geometry.cjs', 'native-geometry-protocol.cjs']) cpSync(`desktop/${name}`, path.join(stage, 'app', name));
writeFileSync(path.join(stage, 'app/branding.json'), JSON.stringify(brand, null, 2));
for (const name of ['layerling-mcp-server.mjs', 'layerling-mcp-tools.mjs', 'layerling-mcp-open.mjs']) cpSync(`scripts/${name}`, path.join(stage, 'app/mcp', name));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(path.join(stage, 'app/package.json'), JSON.stringify({ name: ultimate ? 'layerling-ultimate' : 'layerling-desktop', productName: brand.name, version: brand.version, main: 'main.cjs', description: brand.description, author: pkg.author, license: pkg.license }, null, 2));
run('desktop/licenses.mjs', []);
const legalRoot = process.env.LAYERLING_RELEASE_DIR ? path.join(process.env.LAYERLING_RELEASE_DIR, 'legal') : path.join(root, 'dist/windows/legal');
await stageLocalDocs({ brand, legalRoot, publicRoot: path.join(web, 'public') });
writeFileSync(path.join(web, 'public/desktop/manifest.webmanifest'), JSON.stringify({
  id: '/', name: brand.name, short_name: brand.name, description: brand.description,
  start_url: '/', scope: '/', display: 'standalone', background_color: brand.backgroundColor,
  theme_color: brand.backgroundColor, icons: [{ src: brand.icon, sizes: '512x512', type: 'image/png' }],
  file_handlers: [{ action: '/', accept: { 'application/vnd.layerling.project+zip': ['.lyl'] } }],
}, null, 2));
console.log('Desktop runtime staged:', stage);
