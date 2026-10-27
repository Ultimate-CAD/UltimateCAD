import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const run = (file, args) => {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
const dirty = git(['status', '--porcelain']);
if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('Commit release sources before packaging: corresponding-source archive must match the implementation.');
const revision = git(['rev-parse', 'HEAD']).stdout.trim();
run(process.execPath, ['desktop/build.mjs', ...(process.argv.includes('--stage-only') ? ['--stage-only'] : [])]);
run(process.execPath, ['desktop/geometry-sources.mjs']);
mkdirSync('dist/windows/sources', { recursive: true });
run('git', ['archive', '--format=zip', '--prefix=layerling-desktop/', '--output=dist/windows/sources/Layerling-Desktop-Source.zip', revision]);
writeFileSync('dist/windows/release-metadata.json', JSON.stringify({ version: JSON.parse(readFileSync('package.json')).version,
  upstream: 'b211101dd0650a7461318a3ef73253cf9f0a801b', sourceCommit: revision, unsigned: true,
  architecture: 'Electron + managed authenticated Next standalone production server' }, null, 2));
run(process.execPath, ['node_modules/electron-builder/cli.js', '--config', 'desktop/electron-builder.cjs', ...(process.argv.includes('--nsis-only') ? ['--win', 'nsis'] : [])]);
const artifacts = readdirSync('dist/windows').filter(name => /\.(exe|json|blockmap)$/.test(name));
const checksums = artifacts.map(name => `${createHash('sha256').update(readFileSync(path.join('dist/windows', name))).digest('hex')}  ${name}`);
for (const name of readdirSync('dist/windows/sources').filter(name => name.endsWith('.zip'))) {
  checksums.push(`${createHash('sha256').update(readFileSync(path.join('dist/windows/sources', name))).digest('hex')}  sources/${name}`);
}
writeFileSync('dist/windows/SHA256SUMS.txt', checksums.join('\n') + '\n');
console.log('Windows release artifacts and checksums: dist/windows');
