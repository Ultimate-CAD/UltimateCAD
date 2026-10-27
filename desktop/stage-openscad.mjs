import { cpSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.env.LAYERLING_OPENSCAD_SOURCE || 'C:/Program Files/OpenSCAD');
const destination = path.join(root, 'dist/ultimate-engine');
if (!existsSync(path.join(source, 'openscad.com')) || !existsSync(path.join(source, 'openscad.exe'))) throw new Error('Set LAYERLING_OPENSCAD_SOURCE to an extracted native Windows OpenSCAD distribution.');
mkdirSync(destination, { recursive: true });
for (const entry of readdirSync(source)) {
  if (/^uninstall/i.test(entry)) continue;
  cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true });
}
const probe = spawnSync(path.join(destination, 'openscad.com'), ['--version'], { windowsHide: true, encoding: 'utf8', env: { ...process.env, PATH: process.env.SystemRoot + '/System32' } });
if (probe.status !== 0 || !`${probe.stdout}${probe.stderr}`.includes('OpenSCAD version')) throw new Error(`Bundled OpenSCAD failed: ${probe.stdout}${probe.stderr}`);
const version = `${probe.stdout}${probe.stderr}`.trim();
const manifest = { version, executable: 'openscad.com', engineSha256: createHash('sha256').update(readFileSync(path.join(destination, 'openscad.exe'))).digest('hex'), source: 'https://github.com/openscad/openscad', privateWorkstationOnly: true };
writeFileSync(path.join(destination, 'engine-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Bundled native engine verified with System32-only PATH:', version);
