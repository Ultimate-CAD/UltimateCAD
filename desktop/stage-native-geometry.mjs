import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const run=(file,args,quiet=false)=>{const r=spawnSync(file,args,{encoding:'utf8',windowsHide:true,stdio:quiet?'pipe':'inherit'});if(r.error||r.status!==0)throw new Error(r.error?.message||`${file} failed: ${r.stderr||r.stdout}`);return r.stdout?.trim();};
const build=path.resolve('.codex-run/adaptive10/build'),cache=path.resolve('.codex-run/adaptive10');
const deps=[['manifold','ce50d78021d64507f89e8c9fc2c2e51018117857','LICENSE'],['libigl','40e7900ccbd767f1f360e0eb10f0f1a6432e0993','LICENSE.MPL2'],['eigen','3147391d946bb4b6c68edd901f2add6ac1f31f8c','COPYING.MPL2'],['tbb','f1862f38f83568d96e814e469ab61f88336cc595','LICENSE.txt']];
const args=['-S','native/geometry','-B',build,'-A','x64'];
for(const [name,revision] of deps){const p=path.join(cache,name);if(existsSync(path.join(p,'.git'))){if(run('git',['-C',p,'rev-parse','HEAD'],true)!==revision)throw new Error(`Native source pin differs: ${name}`);args.push(`-DFETCHCONTENT_SOURCE_DIR_${name.toUpperCase()}=${p}`);}}
run('cmake',args);run('cmake',['--build',build,'--config','Release','--target','layerling-geometry','--parallel','8']);
const output=path.resolve('dist/ultimate-native'),release=path.resolve(process.env.LAYERLING_RELEASE_DIR||'dist/ultimate/windows');mkdirSync(output,{recursive:true});mkdirSync(path.join(release,'legal/native-geometry'),{recursive:true});mkdirSync(path.join(release,'sources'),{recursive:true});
cpSync(path.join(build,'Release/layerling-geometry.exe'),path.join(output,'layerling-geometry.exe'));
for(const [name,revision,license] of deps){let source=path.join(cache,name);if(!existsSync(path.join(source,'.git')))source=path.join(build,'_deps',`${name}-src`);if(run('git',['-C',source,'rev-parse','HEAD'],true)!==revision)throw new Error(`Native fetched pin differs: ${name}`);cpSync(path.join(source,license),path.join(release,'legal/native-geometry',`${name}-LICENSE.txt`));run('git',['-C',source,'archive','--format=zip',`--prefix=${name}/`,`--output=${path.join(release,'sources',`Native-${name}-Source.zip`)}`,revision]);}
const compiler=readFileSync(path.join(build,'CMakeCache.txt'),'utf8').split(/\r?\n/).filter(s=>/^CMAKE_(CXX_COMPILER|GENERATOR|GENERATOR_PLATFORM):/.test(s));
writeFileSync(path.join(output,'manifest.json'),JSON.stringify({protocol:1,architecture:'windows-x64',defaultThreads:8,memoryLimitGiB:8,dependencies:deps.map(([name,revision])=>({name,revision})),compiler,sha256:createHash('sha256').update(readFileSync(path.join(output,'layerling-geometry.exe'))).digest('hex')},null,2));
cpSync('native/geometry/README.md',path.join(release,'legal/native-geometry/BUILD-AND-LICENSES.md'));
console.log('Native geometry helper, notices and corresponding sources staged.');
