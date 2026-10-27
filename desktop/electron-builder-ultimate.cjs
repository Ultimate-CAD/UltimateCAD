const base = require('./electron-builder.cjs');
module.exports = {
  ...base, appId: 'org.layerling.ultimate', productName: 'Layerling Ultimate',
  directories: { app: 'dist/ultimate-stage/app', output: 'dist/ultimate/windows' },
  afterPack: async context => {
    const fs = require('node:fs'), path = require('node:path');
    fs.cpSync(path.resolve('dist/ultimate-stage/runtime'), path.join(context.appOutDir, 'resources/runtime'), { recursive: true });
    fs.cpSync(path.resolve('dist/ultimate-engine'), path.join(context.appOutDir, 'resources/openscad'), { recursive: true });
  },
  extraResources: [
    { from: 'apps/web/public/assets/layerling/layerling-icon-512.png', to: 'icon.png' },
    { from: 'dist/ultimate/windows/legal', to: 'legal' },
    { from: 'dist/ultimate/windows/sources', to: 'sources' },
  ],
  win: { ...base.win, target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: { ...base.nsis, artifactName: 'Layerling-Ultimate-OpenSCAD-Setup-x64.exe' },
  portable: { artifactName: 'Layerling-Ultimate-OpenSCAD-Portable-x64.exe' },
};
