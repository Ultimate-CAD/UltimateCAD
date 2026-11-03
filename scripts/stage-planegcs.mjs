import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = path.join(root, 'node_modules/@salusoft89/planegcs');
const pkgJsonPath = path.join(pkgRoot, 'package.json');
const depsRoot = path.join(root, '.codex-run/sketch16/deps');
const tgzPath = path.join(depsRoot, 'salusoft89-planegcs-1.3.0.tgz');
const sourceZipPath = path.join(depsRoot, 'planegcs-source.zip');
const targetRoot = path.join(root, 'apps/web/public/assets/planegcs/1.3.0');
const releaseMode = process.argv.slice(2).includes('--release');

const expected = {
  version: '1.3.0',
  gitHead: '9d26baef0b240fe0eef4186d4e5e5e66ec3620b7',
  sourceSha256: 'cf7d4e27fd13fd169956cfecd60e10df2551b545921e4fa654f3d51b26fc0363',
  npmIntegrity: 'sha512-ugIkFCPnKRK1Yed+5297S/RmmfgEhIp5Xxx8PYhgfbcS+AxYV3chZ8LMGlEbEqrkbK6fwmNVLtEpLFq5KDl2lw==',
  wasmSha256: 'af9d1874fc895726bd267703a698a86c82d35b7415a02fe5184ebf65ddbc04af',
};

function fail(message) {
  throw new Error(`[stage-planegcs] ${message}`);
}

function hashFile(file, algorithm) {
  return createHash(algorithm).update(readFileSync(file)).digest('hex');
}

async function fetchPinned(url, destination, algorithm, expectedHash) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) fail(`download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash(algorithm).update(bytes).digest('hex');
  if (actualHash !== expectedHash) fail(`download hash mismatch for ${path.basename(destination)}: ${actualHash}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: 'wx' });
}

const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
if (pkg.version !== expected.version) fail(`expected installed ${expected.version}, found ${pkg.version ?? 'unknown'}`);
if (pkg.name !== '@salusoft89/planegcs') fail(`unexpected installed package name: ${pkg.name}`);
if (hashFile(path.join(pkgRoot, 'dist/planegcs_dist/planegcs.wasm'), 'sha256') !== expected.wasmSha256) fail('installed PlaneGCS WASM differs from the pinned runtime');

const published = { 'dist.integrity': expected.npmIntegrity, 'dist.tarball': 'https://registry.npmjs.org/@salusoft89/planegcs/-/planegcs-1.3.0.tgz' };
if (!published?.['dist.integrity']?.startsWith('sha512-')) fail('pinned npm integrity is missing from npm-metadata.json');
const expectedTgzHash = Buffer.from(published['dist.integrity'].slice('sha512-'.length), 'base64').toString('hex');
if (!existsSync(tgzPath)) {
  await fetchPinned(published['dist.tarball'], tgzPath, 'sha512', expectedTgzHash);
}
if (hashFile(tgzPath, 'sha512') !== expectedTgzHash) fail('cached npm tarball does not match npm integrity metadata');

if (!existsSync(sourceZipPath)) {
  await fetchPinned(
    `https://codeload.github.com/Salusoft89/planegcs/zip/${expected.gitHead}`,
    sourceZipPath,
    'sha256',
    expected.sourceSha256,
  );
}
if (hashFile(sourceZipPath, 'sha256') !== expected.sourceSha256) fail('pinned source archive SHA-256 mismatch');

const licensePath = path.join(pkgRoot, 'LICENSE');
if (!existsSync(licensePath)) fail('installed package LICENSE file is missing');
const installedLicense = readFileSync(licensePath, 'utf8');
if (!installedLicense.includes('GNU LESSER GENERAL PUBLIC LICENSE') || !installedLicense.includes('Version 2.1')) {
  fail('installed package LICENSE is not the expected LGPL 2.1 text');
}

mkdirSync(targetRoot, { recursive: true });
cpSync(path.join(pkgRoot, 'dist'), targetRoot, { recursive: true, force: true });
copyFileSync(licensePath, path.join(targetRoot, 'LICENSE'));
const sourceInfo = {
  package: pkg.name,
  version: pkg.version,
  npmIntegrity: published['dist.integrity'],
  upstream: pkg.repository,
  gitHead: expected.gitHead,
  sourceArchive: 'planegcs-source.zip',
  sourceArchiveSha256: expected.sourceSha256,
  packageLicenseMetadata: pkg.license,
  distributedLicenseFile: 'LICENSE (GNU LGPL 2.1)',
};
writeFileSync(path.join(targetRoot, 'SOURCE.json'), `${JSON.stringify(sourceInfo, null, 2)}\n`);

if (releaseMode) {
  const releaseRoot = path.resolve(process.env.LAYERLING_RELEASE_DIR || path.join(root, 'dist/ultimate/windows'));
  const legalRoot = path.join(releaseRoot, 'legal/sketcher');
  const sourcesRoot = path.join(releaseRoot, 'sources');
  mkdirSync(legalRoot, { recursive: true });
  mkdirSync(sourcesRoot, { recursive: true });
  copyFileSync(licensePath, path.join(legalRoot, 'PlaneGCS-LICENSE.txt'));
  writeFileSync(path.join(legalRoot, 'PlaneGCS-NOTICE.txt'), [
    '@salusoft89/planegcs 1.3.0 bundles the FreeCAD PlaneGCS 2D geometric constraint solver.',
    'Original upstream copyright belongs to the FreeCAD contributors and the package author, Miroslav Sery (Salusoft89).',
    'The npm package metadata declares LGPL-2.0-or-later; the preserved LICENSE file distributed in the package is GNU LGPL 2.1.',
    'This notice records both upstream declarations without changing or replacing the license text.',
    `Upstream repository: ${pkg.repository}`,
    `Pinned source commit: ${expected.gitHead}`,
    `npm integrity: ${published['dist.integrity']}`,
    `Source archive SHA-256: ${expected.sourceSha256}`,
  ].join('\n') + '\n');
  copyFileSync(sourceZipPath, path.join(sourcesRoot, 'PlaneGCS-Source.zip'));
  copyFileSync(tgzPath, path.join(sourcesRoot, 'salusoft89-planegcs-1.3.0.tgz'));
  writeFileSync(path.join(sourcesRoot, 'PlaneGCS-SOURCE.json'), `${JSON.stringify(sourceInfo, null, 2)}\n`);
}

console.log(`PlaneGCS ${expected.version} staged at ${path.relative(root, targetRoot)}${releaseMode ? ' with release notices and source archives' : ''}.`);
