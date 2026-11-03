const { brand, publicAsset } = require('./branding.cjs');
module.exports = {
  appId: 'org.layerling.desktop', productName: brand.name,
  executableName: 'Layerling Desktop',
  directories: { app: 'dist/desktop-stage/app', output: 'dist/windows' },
  files: ['main.cjs', 'server.cjs', 'preload.cjs', 'fem-*.cjs', 'branding.json', 'mcp-client.mjs', 'native-geometry*.cjs', 'mcp/**/*', 'package.json', '!node_modules/**/*'], asar: true, npmRebuild: false,
  // Builder's dependency collector omits node_modules inside extraResources. Copy the
  // complete Next traced tree verbatim after packing, including its runtime dependencies.
  afterPack: async context => {
    require('node:fs').cpSync(require('node:path').resolve('dist/desktop-stage/runtime'),
      require('node:path').join(context.appOutDir, 'resources/runtime'), { recursive: true });
  },
  extraResources: [
    { from: publicAsset(brand.icon), to: 'icon.png' },
    { from: 'dist/windows/legal', to: 'legal' },
    { from: 'dist/windows/sources', to: 'sources' },
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
    icon: publicAsset(brand.icon),
    signExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowElevation: false,
    allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
    createStartMenuShortcut: true, deleteAppDataOnUninstall: false,
    shortcutName: brand.name,
    artifactName: `${brand.artifactStem}-Setup-x64.exe` },
  portable: { artifactName: `${brand.artifactStem}-Portable-x64.exe` },
};
