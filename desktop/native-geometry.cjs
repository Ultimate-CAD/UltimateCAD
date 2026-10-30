const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {validateRequest,decodeResult,MAX_BYTES}=require('./native-geometry-protocol.cjs');
class NativeGeometryJobs {
  constructor(executable,root,options={}){this.executable=executable;this.root=root;this.jobs=new Map();this.timeoutMs=options.timeoutMs??600_000;}
  cancel(id){const job=this.jobs.get(id);if(job){job.cancelled=true;job.child?.kill();}}
  close(){for(const id of this.jobs.keys())this.cancel(id);}
  async run(id,bytes,progress=()=>{}){
    if(typeof id!=='string'||!/^[a-z0-9-]{1,80}$/i.test(id)||this.jobs.has(id))throw new Error('Invalid native job identity');
    if(this.jobs.size)throw new Error('A native hollowing job is already running; cancel it before starting another');
    const buffer=validateRequest(bytes);
    try{await fs.access(this.executable);}catch{const e=new Error('Native geometry backend unavailable; use the WASM engine');e.code='NATIVE_UNAVAILABLE';throw e;}
    const job={child:null,cancelled:false};this.jobs.set(id,job);let dir,timer;
    try{
      await fs.mkdir(this.root,{recursive:true});dir=await fs.mkdtemp(path.join(this.root,'job-'));
      const request=path.join(dir,'request.bin'),result=path.join(dir,'result.bin');
      await fs.writeFile(request,buffer);if(job.cancelled)throw new Error('Native geometry cancelled');
      const stats=await new Promise((resolve,reject)=>{
        let stdout='',stderr='',timedOut=false;
        const child=job.child=spawn(this.executable,[request,result,String(process.pid)],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,PATH:path.join(process.env.SystemRoot||'C:/Windows','System32')}});
        timer=setTimeout(()=>{timedOut=true;child.kill();},this.timeoutMs);
        child.stdout.on('data',data=>{stdout+=data.toString();if(stdout.length>16384)child.kill();});
        child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-8192);progress(data.toString().slice(0,1024));});
        child.once('error',reject);
        child.once('close',code=>{if(job.cancelled)return reject(new Error('Native geometry cancelled'));if(timedOut)return reject(new Error('Native geometry exceeded its ten-minute time budget; original preserved'));if(code!==0)return reject(new Error(`Native geometry stopped (${code}): ${stderr.slice(-2048)}`));try{const s=JSON.parse(stdout);if(s.method!=='mesh-sdf'||s.backend!=='native-cpu'||!Number.isFinite(s.measuredErrorMm)||s.measuredErrorMm>s.maxErrorMm)throw new Error('Invalid native accuracy result');resolve(s);}catch(e){reject(e);}});
      });
      if((await fs.stat(result)).size>MAX_BYTES)throw new Error('Native result exceeds its transport budget');
      const output=await fs.readFile(result);decodeResult(output,false);
      if(job.cancelled)throw new Error('Native geometry cancelled');
      return {bytes:new Uint8Array(output.buffer,output.byteOffset,output.byteLength),stats};
    }finally{clearTimeout(timer);this.jobs.delete(id);if(dir)await fs.rm(dir,{recursive:true,force:true});}
  }
}
module.exports={NativeGeometryJobs};
