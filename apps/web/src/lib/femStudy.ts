export interface FemSettings {axis:number;supportMax:boolean;young:number;poisson:number;meshSizeM:number;force:[number,number,number]}
export interface FemResult {
 units:{length:string;force:string;stress:string};
 positions:number[];displacements:number[];vonMises:number[];indices:number[];
 nodes:number;elements:number;loadedAreaM2:number;
 appliedForceN:number[];reactionForceN:number[];forceResidualN:number;momentResidualNm:number;
 maxDisplacementM:number;maxVonMisesPa:number;
}
export interface FemStudy {schema:1;sourceFingerprint:string;settings:FemSettings;result:FemResult}
export interface FemBridge {
 run:(id:string,request:{step:string;settings:FemSettings})=>Promise<{ok:boolean;result?:FemResult;message?:string}>;
 cancel:(id:string)=>void;
 onProgress:(id:string,listener:(text:string)=>void)=>()=>void;
}
export function validateFemStudy(study:FemStudy) {
 if(study?.schema!==1 || !/^[a-f0-9]{64}$/.test(study.sourceFingerprint))throw Error("Unsupported FEM study");
 const r=study.result,s=study.settings;
 if(!s || ![0,1,2].includes(s.axis) || typeof s.supportMax!=="boolean" || ![s.young,s.poisson,s.meshSizeM,...s.force].every(Number.isFinite) ||
   s.force.length!==3 || !(s.young>0&&s.poisson>=0&&s.poisson<.49&&s.meshSizeM>0))throw Error("Invalid FEM settings");
 if(!r || r.units?.length!=="m" || r.units.force!=="N" || r.units.stress!=="Pa" ||
   !Number.isInteger(r.nodes) || r.nodes<4 || r.nodes>200000 || !Number.isInteger(r.elements)||r.elements<1||r.elements>500000 ||
   r.positions?.length!==r.nodes*3 || r.displacements?.length!==r.nodes*3 || r.vonMises?.length!==r.nodes ||
   !Array.isArray(r.indices)||r.indices.length%3 || r.indices.length>6000000)throw Error("Invalid FEM result dimensions");
 for(const values of [r.positions,r.displacements,r.vonMises])if(!Array.isArray(values)||!values.every(Number.isFinite))throw Error("Nonfinite FEM solution");
 if(r.vonMises.some(v=>v<0))throw Error("Negative Von Mises stress");
 if(!r.indices.every(i=>Number.isInteger(i)&&i>=0&&i<r.nodes))throw Error("Invalid FEM mesh index");
 if(![r.forceResidualN,r.momentResidualNm,r.maxDisplacementM,r.maxVonMisesPa,r.loadedAreaM2,...r.appliedForceN,...r.reactionForceN].every(Number.isFinite))throw Error("Invalid FEM diagnostics");
 if(r.appliedForceN.length!==3||r.reactionForceN.length!==3||r.loadedAreaM2<=0||r.maxDisplacementM<0||r.maxVonMisesPa<0||r.forceResidualN<0||r.momentResidualNm<0)throw Error("Invalid FEM diagnostic ranges");
 for(let i=0;i<3;i++)if(Math.abs(r.appliedForceN[i]-s.force[i])>1e-6*Math.max(1,Math.abs(s.force[i])))throw Error("Applied force disagrees with study settings");

}
