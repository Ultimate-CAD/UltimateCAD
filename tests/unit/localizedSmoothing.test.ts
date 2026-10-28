import {describe,it,expect} from 'vitest';
import {brushWeight,localizedSmooth,smoothingTopology} from '@/lib/localizedSmoothing';
import type {StlExportMesh} from '@/lib/stlExport';
const fixture=()=>{
  const vertices: [number,number,number][]=[];const faces:[number,number,number][]=[];const n=48,rows=21;
  for(let y=0;y<rows;y++)for(let j=0;j<n;j++) {const a=j*2*Math.PI/n,r=10+2*Math.exp(-(((y-10)/1.2)**2))+Math.max(0,4-y)*0.4;vertices.push([r*Math.cos(a),y,r*Math.sin(a)]);}
  for(let y=0;y<rows-1;y++)for(let j=0;j<n;j++){const a=y*n+j,b=y*n+(j+1)%n,c=a+n,d=b+n;faces.push([a,c,b],[b,c,d]);}
  return {name:'collar',vertices,faces} satisfies StlExportMesh;
};
describe('localized smoothing',()=>{
  it('reduces a collar with continuous weights, fixed surroundings, unchanged open topology and deterministic output',()=>{
    const mesh=fixture(),before=JSON.stringify(mesh),weights=mesh.vertices.map(p=>brushWeight(Math.abs(p[1]-10),5)),topology=smoothingTopology(mesh);
    const a=localizedSmooth(mesh,weights,0.8,30,topology),b=localizedSmooth(mesh,weights,0.8,30,topology);
    expect(a.mesh).toEqual(b.mesh);expect(JSON.stringify(mesh)).toBe(before);expect(a.mesh.faces).toBe(mesh.faces);
    expect(Math.hypot(a.mesh.vertices[480][0],a.mesh.vertices[480][2])).toBeLessThan(12);
    expect(a.stats.maxDisplacementMm).toBeGreaterThan(0.05);expect(a.audit.boundaryEdges).toBe(96);expect(a.stats.resultValid).toBe(false);
    mesh.vertices.forEach((p,i)=>{if(weights[i]===0)expect(a.mesh.vertices[i]).toEqual(p);});
  });
  it('rejects malformed weights and non-manifold connectivity without repair',()=>{
    const m=fixture();expect(()=>localizedSmooth(m,[],1,10)).toThrow();
    expect(()=>smoothingTopology({...m,faces:[...m.faces,m.faces[0],m.faces[0]]})).toThrow(/Non-manifold/);
  });
});

