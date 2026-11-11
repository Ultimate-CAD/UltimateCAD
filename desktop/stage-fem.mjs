import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,cpSync,unlinkSync} from "node:fs";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import path from "node:path";
const root=path.resolve(import.meta.dirname,".."),cache=path.join(root,".codex-run/fem19/deps"),out=path.join(root,"dist/ultimate-fem");
mkdirSync(cache,{recursive:true});mkdirSync(out,{recursive:true});
const pins=[
 ["calculix_2.23_4win.zip","https://www.dhondt.de/calculix_2.23_4win.zip","87fc4e1721df37370ec67d0a244bb14f9bf804b0a95df49e2ae7369d30ec72e8"],
 ["ccx_2.23.src.tar.bz2","https://www.dhondt.de/ccx_2.23.src.tar.bz2","9c88385c10fb04f5dc6c4e98027a51bebdd8aee3920e05190d6c1dd08357d6e7"],
];
for(const [name,url,hash] of pins){
 const file=path.join(cache,name);
 if(!existsSync(file)){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error("Download failed "+url);writeFileSync(file,Buffer.from(await r.arrayBuffer()));}
 if(createHash("sha256").update(readFileSync(file)).digest("hex")!==hash)throw Error("Dependency checksum mismatch "+name);
}
function extract(archive,destination){
 mkdirSync(destination,{recursive:true});
 const r=spawnSync("tar",["-xf",path.join(cache,archive),"-C",destination],{windowsHide:true,encoding:"utf8"});
 if(r.status!==0)throw Error(r.stderr);
}
const ccx=path.join(cache,"ccx"),src=path.join(cache,"source");
extract(pins[0][0],ccx);extract(pins[1][0],src);
copyFileSync(path.join(ccx,"calculix_2.23_4win/ccx_static.exe"),path.join(out,"ccx.exe"));
const legal=path.join(root,"dist/ultimate/windows/legal/fem"),sources=path.join(root,"dist/ultimate/windows/sources");
mkdirSync(legal,{recursive:true});mkdirSync(sources,{recursive:true});
for(const file of [path.join(out,"gmsh.exe"),path.join(sources,"gmsh-4.15.2-Windows64.zip")])if(existsSync(file))unlinkSync(file);
copyFileSync(path.join(src,"CalculiX/ccx_2.23/src/gpl-2.0.txt"),path.join(legal,"CalculiX-GPL-2.0.txt"));
copyFileSync(path.join(ccx,"calculix_2.23_4win/README_Install"),path.join(legal,"CalculiX-Windows-README.txt"));
for(const [name] of pins)copyFileSync(path.join(cache,name),path.join(sources,name));
writeFileSync(path.join(legal,"FEM-NOTICE.txt"),"CalculiX 2.23 by Guido Dhondt and contributors; upstream Windows static executable. Gmsh 4.15.2 is an optional external user-installed CLI tool, not bundled. CalculiX licenses and source accompany this build. Upstreams https://www.dhondt.de/ and https://gmsh.info/.\n");
writeFileSync(path.join(out,"manifest.json"),JSON.stringify({dependencies:pins.map(([name,url,sha256])=>({name,url,sha256})),units:"SI: m, N, Pa",runtimeNetwork:false},null,2));
console.log("Pinned offline FEM runtimes staged");
