const base = require('./electron-builder.cjs');
const { brand, publicAsset } = require('./branding.cjs');
module.exports = {
  ...base, appId: 'org.layerling.ultimate', productName: brand.name,
  executableName: 'Layerling Ultimate',
  directories: { app: 'dist/ultimate-stage/app', output: 'dist/ultimate/windows' },
  afterPack: async context => {
    const fs = require('node:fs'), path = require('node:path');
    fs.cpSync(path.resolve('dist/ultimate-stage/runtime'), path.join(context.appOutDir, 'resources/runtime'), { recursive: true });
    fs.cpSync(path.resolve('dist/ultimate-engine'), path.join(context.appOutDir, 'resources/openscad'), { recursive: true });
    const femOut=path.join(context.appOutDir,'resources/fem');
    fs.mkdirSync(femOut,{recursive:true});
    for(const name of ['ccx.exe','libgcc_s_seh-1.dll','libgfortran-3.dll','libgomp-1.dll','libquadmath-0.dll','libstdc++-6.dll','libwinpthread-1.dll','pthreadGC2.dll']){
      const source=path.resolve('dist/ultimate-fem',name);
      if(fs.existsSync(source))fs.copyFileSync(source,path.join(femOut,name));
    }
    fs.cpSync(path.resolve('dist/ultimate-native'), path.join(context.appOutDir, 'resources/geometry'), { recursive: true });
  },
  extraResources: [
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
    { from: publicAsset(brand.icon), to: 'icon.png' },
    { from: 'dist/ultimate/windows/legal', to: 'legal' },
    { from: 'dist/ultimate/windows/sources', to: 'sources' },
  ],
  win: { ...base.win, target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: { ...base.nsis, artifactName: `${brand.artifactStem}-Setup-x64.exe` },
  portable: { artifactName: `${brand.artifactStem}-Portable-x64.exe` },
};
