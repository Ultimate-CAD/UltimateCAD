import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const run = (file, args, env = {}) => {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
if (!process.argv.includes('--stage-only')) {
  run('scripts/generate-midnight-theme.mjs', []);
  run('scripts/copy-occt-wasm.mjs', []);
  run('scripts/build-japanese-typeface.mjs', []);
  run('scripts/build-guide.mjs', []);
  run('node_modules/next/dist/bin/next', ['build', 'apps/web'], { LAYERLING_DESKTOP_BUILD: 'true' });
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
for (const name of ['main.cjs', 'server.cjs', 'preload.cjs', 'mcp-client.mjs']) cpSync(`desktop/${name}`, path.join(stage, 'app', name));
for (const name of ['layerling-mcp-server.mjs', 'layerling-mcp-tools.mjs', 'layerling-mcp-open.mjs']) cpSync(`scripts/${name}`, path.join(stage, 'app/mcp', name));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(path.join(stage, 'app/package.json'), JSON.stringify({ name: ultimate ? 'layerling-ultimate' : 'layerling-desktop', productName: ultimate ? 'Layerling Ultimate' : 'Layerling Desktop', version: ultimate ? `${pkg.version}-ultimate.9.1` : pkg.version, main: 'main.cjs', description: pkg.description, author: pkg.author, license: pkg.license }, null, 2));
run('desktop/licenses.mjs', []);
console.log('Desktop runtime staged:', stage);
