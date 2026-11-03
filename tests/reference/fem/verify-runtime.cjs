const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {FemJobs}=require('../../../desktop/fem-jobs.cjs');
(async()=>{
 const root=path.resolve('.codex-run/fem19'),dir=path.join(root,'reference');fs.mkdirSync(dir,{recursive:true});
 const runtime=path.resolve('dist/ultimate-fem');
 fs.writeFileSync(path.join(dir,'beam.geo'),'SetFactory("OpenCASCADE");\nBox(1)={0,0,0,1000,100,100};\nSave "beam.step";\n');
 const mesh=spawnSync(path.join(runtime,'gmsh.exe'),['beam.geo','-0','-nopopup','-v','2'],{cwd:dir,windowsHide:true,encoding:'utf8'});
 if(mesh.status!==0)throw Error(mesh.stderr);
 const step=fs.readFileSync(path.join(dir,'beam.step'),'utf8');
 const jobs=new FemJobs(runtime,path.join(root,'jobs'));
 const reports=[];
 for(const size of [.05,.035,.025]){
  const t=performance.now();
  const r=await jobs.run('beam-'+size,{step,settings:{axis:0,supportMax:false,young:200e9,poisson:.3,meshSizeM:size,force:[0,0,-1000]}});
  if(Math.abs(r.maxDisplacementM-.0002)/.0002>.025)throw Error('Cantilever reference error');
  if(r.forceResidualN>.01 || r.momentResidualNm>.01)throw Error('Equilibrium failed');
  const row={size,nodes:r.nodes,elements:r.elements,maxDisplacementM:r.maxDisplacementM,errorToEuler:Math.abs(r.maxDisplacementM-.0002)/.0002,forceResidualN:r.forceResidualN,momentResidualNm:r.momentResidualNm,ms:performance.now()-t};
  reports.push(row);console.log(JSON.stringify(row));
  fs.writeFileSync(path.join(root,'beam-result.json'),JSON.stringify(r));
 }
 if(Math.abs(reports[2].maxDisplacementM-reports[1].maxDisplacementM)/reports[2].maxDisplacementM>.01)throw Error('Refinement did not stabilize');
 fs.writeFileSync(path.join(root,'convergence.json'),JSON.stringify({reference:{theory:'Euler-Bernoulli',displacementM:.0002,lengthM:1,sideM:.1,youngPa:200e9,poisson:.3,forceN:-1000},reports},null,2));
 const abort=jobs.run('cancel',{step,settings:{axis:0,supportMax:false,young:200e9,poisson:.3,meshSizeM:.025,force:[0,0,-1000]}});
 setTimeout(()=>jobs.cancel('cancel'),10);
 try{await abort;throw Error('Cancellation did not stop solve');}catch(e){if(!/cancel/i.test(e.message))throw e;}
 console.log('Cancellation verified');
})().catch(e=>{console.error(e);process.exitCode=1;});
