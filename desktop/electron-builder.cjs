module.exports = {
  appId: 'org.layerling.desktop', productName: 'Layerling Desktop',
  directories: { app: 'dist/desktop-stage/app', output: 'dist/windows' },
  files: ['main.cjs', 'server.cjs', 'mcp-client.mjs', 'mcp/**/*', 'package.json', '!node_modules/**/*'], asar: true, npmRebuild: false,
  // Builder's dependency collector omits node_modules inside extraResources. Copy the
  // complete Next traced tree verbatim after packing, including its runtime dependencies.
  afterPack: async context => {
    require('node:fs').cpSync(require('node:path').resolve('dist/desktop-stage/runtime'),
      require('node:path').join(context.appOutDir, 'resources/runtime'), { recursive: true });
  },
  extraResources: [
    { from: 'apps/web/public/assets/layerling/layerling-icon-512.png', to: 'icon.png' },
    { from: 'dist/windows/legal', to: 'legal' },
    { from: 'dist/windows/sources', to: 'sources' },
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
    icon: 'apps/web/public/assets/layerling/layerling-icon-512.png',
    signExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowElevation: false,
    allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
    createStartMenuShortcut: true, deleteAppDataOnUninstall: false,
    artifactName: 'Layerling-Desktop-Setup-x64.exe' },
  portable: { artifactName: 'Layerling-Desktop-Portable-x64.exe' },
};
