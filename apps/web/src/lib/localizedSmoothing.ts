import type { StlExportMesh } from "@/lib/stlExport";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";

export type SmoothingTopology = { neighbors: number[][]; pinned: Uint8Array; faces: number[][] };
/** No welding, reindexing, shell joining, or face insertion. Open boundaries are fixed. */
export function smoothingTopology(mesh: StlExportMesh): SmoothingTopology {
  const neighbors = mesh.vertices.map(() => new Set<number>()), pinned = new Uint8Array(mesh.vertices.length);
  const edges = new Map<string, number>();
  for (const f of mesh.faces) {
    if (f.length !== 3 || new Set(f).size !== 3 || f.some(i => !Number.isInteger(i) || i < 0 || i >= neighbors.length)) throw Error("Invalid triangle indices");
    for (let k = 0; k < 3; k++) {
      const a=f[k],b=f[(k+1)%3];neighbors[a].add(b);neighbors[b].add(a);
      const key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)??0)+1);
    }
  }
  for (const [key,count] of edges) {
    if(count>2) throw Error("Non-manifold mesh cannot be smoothed safely");
    if(count===1) for(const i of key.split(',').map(Number)) pinned[i]=1;
  }
  if(mesh.vertices.some(p=>p.length!==3 || p.some(v=>!Number.isFinite(v)))) throw Error("Non-finite mesh coordinates");
  return {neighbors:neighbors.map(s=>[...s].sort((a,b)=>a-b)),pinned,faces:mesh.faces};
}

/** C2 spatial falloff; callers combine strokes by max (add) or multiplication (subtract). */
export function brushWeight(distance: number, radius: number) {
  if(!Number.isFinite(radius)||radius<=0) throw Error("Brush radius must be positive");
  const t=Math.max(0,Math.min(1,1-distance/radius));return t*t*t*(t*(t*6-15)+10);
}

/** Constrained Taubin pair. Zero-weight and open-boundary vertices are bit-identical. */
export function localizedSmooth(mesh: StlExportMesh, weights: ArrayLike<number>, strength: number, iterations: number, topology=smoothingTopology(mesh)) {
  if(weights.length!==mesh.vertices.length || !Number.isFinite(strength)||strength<0||strength>1 || !Number.isInteger(iterations)||iterations<1||iterations>100) throw Error("Invalid smoothing settings");
  const active:number[]=[];
  for(let i=0;i<weights.length;i++) {
    if(!Number.isFinite(weights[i])||weights[i]<0||weights[i]>1)throw Error("Invalid selection weight");
    if(weights[i]>0&&!topology.pinned[i]&&topology.neighbors[i].length)active.push(i);
  }
  let points=mesh.vertices.map(p=>[...p] as [number,number,number]);
  const normal=(p:typeof points,f:number[])=>{
    const a=p[f[0]],b=p[f[1]],c=p[f[2]],u=b.map((x,j)=>x-a[j]),v=c.map((x,j)=>x-a[j]);
    return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  };
  const selected=new Set(active), affected=mesh.faces.filter(f=>f.some(i=>selected.has(i)));
  for(let step=0;step<iterations;step++) {
    const before=points;
    for(const factor of [0.5,-0.53]) {
      const next=points.slice();
      for(const i of active) {
        const ns=topology.neighbors[i];
        next[i]=points[i].map((v,j)=>v+factor*strength*weights[i]*(ns.reduce((sum,k)=>sum+points[k][j],0)/ns.length-v)) as [number,number,number];
      }
      points=next;
    }
    for(const f of affected) {
      const a=normal(before,f),b=normal(points,f),dot=a.reduce((s,v,j)=>s+v*b[j],0);
      if(!Number.isFinite(dot)||dot<=0)throw Error("Smoothing would collapse or invert a triangle; reduce strength or iterations");
    }
  }
  const result={...mesh,vertices:points};
  const sourceAudit=auditManufacturingMesh(mesh),audit=auditManufacturingMesh(result);
  for(const key of ['boundaryEdges','nonManifoldEdges','nonManifoldVertices','windingMismatches','degenerateFaces','duplicateFaces','shells'] as const)
    if(audit[key]!==sourceAudit[key])throw Error("Smoothing changed mesh integrity; source retained");
  let maxDisplacementMm=0,sum=0;
  for(const i of active){const d=Math.hypot(...points[i].map((v,j)=>v-mesh.vertices[i][j]));maxDisplacementMm=Math.max(maxDisplacementMm,d);sum+=d*d;}
  return {mesh:result,stats:{movedVertices:active.length,maxDisplacementMm,rmsDisplacementMm:Math.sqrt(sum/Math.max(1,active.length)),sourceVolumeMm3:sourceAudit.signedVolumeMm3,resultVolumeMm3:audit.signedVolumeMm3,sourceValid:sourceAudit.valid,resultValid:audit.valid},audit};
}
