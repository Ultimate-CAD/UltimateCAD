const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {parseMesh,prepareDeck,parseResults}=require('./fem-deck.cjs');
class FemJobs {
 constructor(runtime,root){this.runtime=runtime;this.root=root;this.jobs=new Map();}
 cancel(id){const job=this.jobs.get(id);if(job){job.cancelled=true;job.child?.kill();}}
 cancelAll(){for(const id of this.jobs.keys())this.cancel(id);}
 async run(id,request,progress=()=>{}){
  if(this.jobs.size)throw Error('An analysis is already running');
  if(typeof id!=='string'||id.length>160||!request||typeof request.step!=='string'||request.step.length>100e6||!request.step.trimStart().startsWith('ISO-10303-21;'))throw Error('Invalid analysis input');
  const s=request.settings;
  if(!s||![0,1,2].includes(s.axis)||typeof s.supportMax!=='boolean'||
    ![s.young,s.poisson,s.meshSizeM,...(s.force??[])].every(Number.isFinite)||s.force.length!==3||
    !(s.young>0&&s.young<1e14&&s.poisson>=0&&s.poisson<.49&&s.meshSizeM>1e-7&&s.meshSizeM<1e4)||
    !(Math.hypot(...s.force)>0&&Math.hypot(...s.force)<1e12))throw Error('Invalid material, load or mesh size');
  const job={cancelled:false,child:null};this.jobs.set(id,job);let dir;
  const run=(exe,args)=>new Promise((resolve,reject)=>{
    if(job.cancelled)return reject(Error('Analysis cancelled'));
    let log='';
    const child=spawn(path.join(this.runtime,exe),args,{cwd:dir,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,PATH:path.join(process.env.SystemRoot,'System32'),OMP_NUM_THREADS:'4'}});
    job.child=child;
    const timer=setTimeout(()=>{job.cancelled=true;child.kill();},600000);
    const data=b=>{const text=b.toString();log=(log+text).slice(-200000);progress(text.slice(-2000));};
    child.stdout.on('data',data);child.stderr.on('data',data);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);job.child=null;
      if(job.cancelled)reject(Error('Analysis cancelled or exceeded ten-minute deadline'));
      else if(code!==0)reject(Error('Analysis tool failed ('+code+'): '+log.slice(-4000)));
      else resolve(log);
    });
  });
  try{
    await fs.promises.mkdir(this.root,{recursive:true});
    dir=await fs.promises.mkdtemp(path.join(this.root,'study-'));
    await fs.promises.writeFile(path.join(dir,'model.step'),request.step);
    // CAD model coordinates are millimeters. All analysis coordinates use SI meters.
    const geo=['SetFactory("OpenCASCADE");','Merge "model.step";','Dilate {{0,0,0},0.001} {Volume{:};}',
      'Mesh.CharacteristicLengthMin='+s.meshSizeM+';','Mesh.CharacteristicLengthMax='+s.meshSizeM+';','Mesh.ElementOrder=2;','Mesh.SaveAll=1;'].join('\n');
    await fs.promises.writeFile(path.join(dir,'model.geo'),geo);
    progress('Meshing exact CAD volume');
    await run('gmsh.exe',['model.geo','-3','-order','2','-format','inp','-o','mesh.inp','-nopopup','-v','2']);
    const meshPath=path.join(dir,'mesh.inp');
    if((await fs.promises.stat(meshPath)).size>100e6)throw Error('Mesh exceeds 100 MB resource budget; choose a coarser resolution');
    const mesh=parseMesh(await fs.promises.readFile(meshPath,'utf8')),deck=prepareDeck(mesh,s);
    await fs.promises.writeFile(path.join(dir,'study.inp'),deck.deck);
    progress('Solving quadratic tetrahedral linear elasticity');
    const log=await run('ccx.exe',['-i','study']);
    if(!log.includes('Job finished') || /\*ERROR/i.test(log))throw Error('Solver failed: '+log.slice(-4000));
    progress('Checking reactions and reading displacement/stress results');
    const dat=await fs.promises.readFile(path.join(dir,'study.dat'),'utf8'),frd=await fs.promises.readFile(path.join(dir,'study.frd'),'utf8');
    return parseResults(mesh,dat,frd,deck);
  }finally{
    this.jobs.delete(id);
    if(dir)await fs.promises.rm(dir,{recursive:true,force:true});
  }
 }
}
module.exports={FemJobs};
