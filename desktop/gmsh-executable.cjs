const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
// Extracted from the checksum-pinned official Windows 4.15.2 distribution.
const SHA256='317c43391e5b1fab3a1dd80dc5245dad6e2d087910f4b8ebc234bd6d4b8f41a1';
async function verifyGmsh(executable){
 if(typeof executable!=='string'||!path.isAbsolute(executable)||path.basename(executable).toLowerCase()!=='gmsh.exe')throw Error('Select the official Gmsh 4.15.2 gmsh.exe');
 const actual=await fs.promises.realpath(executable),stat=await fs.promises.stat(actual);
 if(!stat.isFile()||stat.size>200e6)throw Error('Invalid Gmsh executable');
 const hash=crypto.createHash('sha256').update(await fs.promises.readFile(actual)).digest('hex');
 if(hash!==SHA256)throw Error('Gmsh executable does not match the verified official Windows 4.15.2 build');
 const {stdout,stderr}=await promisify(execFile)(actual,['-info'],{cwd:path.dirname(actual),windowsHide:true,timeout:12000,maxBuffer:65536,encoding:'utf8',env:{SystemRoot:process.env.SystemRoot,PATH:path.join(process.env.SystemRoot,'System32')}});
 if(!/^\s*Version\s*:\s*4\.15\.2\s*$/im.test(stdout+'\n'+stderr))throw Error('Expected Gmsh 4.15.2');
 return {path:actual,version:'4.15.2',sha256:hash};
}
module.exports={verifyGmsh,SHA256};
