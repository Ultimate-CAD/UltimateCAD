const path = require('node:path');
const definition = require('../apps/web/src/config/productBranding.json');
const publicRoot = path.resolve(__dirname, '../apps/web/public');

// Display configuration cannot change storage paths, app IDs or MCP protocols.
function publicAsset(url) {
  if (
    typeof url !== 'string' ||
    !url.startsWith('/') ||
    url.startsWith('//') ||
    /[?#]/.test(url) ||
    url.includes('..') ||
    url.includes('\\')
  ) {
    throw Error('Brand asset must be a local public path');
  }
  const resolved = path.resolve(publicRoot, '.' + url);
  if (!resolved.startsWith(publicRoot + path.sep)) {
    throw Error('Brand asset escapes public directory');
  }
  return resolved;
}
if (typeof definition.privateDesktop !== 'boolean') throw Error('privateDesktop must be a boolean');
if (!definition.name?.trim() || /[\r\n]/.test(definition.name)) {
  throw Error('A single-line product name is required');
}
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(definition.version)) {
  throw Error('Brand version must be a release version');
}
if (!/^[a-zA-Z0-9-]+$/.test(definition.artifactStem)) {
  throw Error('Invalid installer artifact stem');
}
for (const field of ['logo', 'favicon', 'icon', 'splash', 'helpPath']) {
  publicAsset(definition[field]);
}
for (const field of ['accentColor', 'backgroundColor', 'foregroundColor']) {
  if (!/^#[0-9a-f]{6}$/i.test(definition[field])) {
    throw Error(`Invalid brand color: ${field}`);
  }
}
module.exports = { brand: Object.freeze(definition), publicAsset };
