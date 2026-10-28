import type { ManifoldToplevel } from "manifold-3d";
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { StlExportMesh } from "@/lib/stlExport";
import { auditManufacturingMesh } from "@/lib/manufacturingMesh";

/** Explicit, non-destructive preview. Never fills holes or reconstructs an unknown surface. */
export function repairManufacturingMesh(runtime: ManifoldToplevel, input: StlExportMesh, maxDeviationMm: number) {
  if(!Number.isFinite(maxDeviationMm)||maxDeviationMm<=0||maxDeviationMm>0.1) throw new Error("Repair deviation must be greater than zero and at most 0.1 mm");
  const mesh = new runtime.Mesh({numProp:3,vertProperties:Float32Array.from(input.vertices.flat()),triVerts:Uint32Array.from(input.faces.flat()),tolerance:Math.min(1e-5,maxDeviationMm/16)});
  mesh.merge();
  const source = runtime.Manifold.ofMesh(mesh);
  const simplified = source.simplify(Math.max(source.tolerance(),maxDeviationMm/16));
  const geometry = new BufferGeometry();
  try {
    if(source.status()!=="NoError"||simplified.status()!=="NoError") throw new Error("Repair cannot infer a closed solid from this mesh");
    const m=simplified.getMesh(), parents=Array.from({length:m.numVert},(_,i)=>i);
    const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
    for(let i=0;i<m.mergeFromVert.length;i++)parents[root(m.mergeFromVert[i])]=root(m.mergeToVert[i]);
    const point=(i:number)=>Array.from(m.vertProperties.subarray(i*m.numProp,i*m.numProp+3)) as [number,number,number];
    const groups=new Map<string,Set<number>>(),normals=new Map<number,number[]>();
    for(let i=0;i<m.numVert;i++){const key=point(i).join(","),group=groups.get(key)??new Set();group.add(root(i));groups.set(key,group);}
    for(let i=0;i<m.triVerts.length;i+=3){
      const ids=Array.from(m.triVerts.subarray(i,i+3)),[a,b,c]=ids.map(point),u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]);
      const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      for(const id of ids){const r=root(id),old=normals.get(r)??[0,0,0];normals.set(r,old.map((x,j)=>x+n[j]));}
    }
    let separatedVertices=0;
    const vertices=Array.from({length:m.numVert},(_,i)=>{
      const p=point(i);if(groups.get(p.join(","))!.size<2)return p;
      const n=normals.get(root(i))!,length=Math.hypot(...n);
      if(!length)throw new Error("Repair cannot resolve a singular vertex normal");
      separatedVertices++;
      return p.map((x,j)=>Math.fround(x+n[j]/length*maxDeviationMm/4)) as [number,number,number];
    });
    const faces=Array.from({length:m.numTri},(_,i)=>Array.from(m.triVerts.subarray(i*3,i*3+3)) as [number,number,number]);
    const result={vertices,faces};
    const audit=auditManufacturingMesh(result,true);
    if(!audit.valid)throw new Error(`Repair preview failed strict topology validation (${audit.boundaryEdges} boundary edges, ${audit.nonManifoldEdges} non-manifold edges, ${audit.degenerateFaces} degenerate faces)`);
    // Bidirectional sampled surface distance, not a global Hausdorff certificate.
    const sampleDistance=(from:StlExportMesh,to:StlExportMesh)=>{
      geometry.setAttribute("position",new Float32BufferAttribute(to.vertices.flat(),3));geometry.setIndex(to.faces.flat());
      const bvh=new MeshBVH(geometry),q=new Vector3();let max=0;
      const check=(p:readonly number[])=>{q.set(p[0],p[1],p[2]);const hit=bvh.closestPointToPoint(q);if(hit)max=Math.max(max,hit.distance);};
      from.vertices.forEach(check);
      for(const face of from.faces){const p=face.map(i=>from.vertices[i]);check([0,1,2].map(j=>(p[0][j]+p[1][j]+p[2][j])/3));
        for(const[a,b]of[[0,1],[1,2],[2,0]])check(p[a].map((x,j)=>(x+p[b][j])/2));}
      return max;
    };
    const sampledDeviationMm=Math.max(sampleDistance(input,result),sampleDistance(result,input));
    if(sampledDeviationMm>maxDeviationMm)throw new Error(`Repair exceeds the requested ${maxDeviationMm} mm deviation`);
    return {mesh:result,audit,sampledDeviationMm,maxDeviationMm,separatedVertices,sourceTriangles:input.faces.length};
  } finally { geometry.dispose();simplified.delete();source.delete(); }
}
