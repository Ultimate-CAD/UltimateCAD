import { BufferGeometry, Float32BufferAttribute, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { ManifoldToplevel, Manifold, Mesh } from "manifold-3d";
import type { ShellOpenings } from "@/types/layerling";
import { shellOpenSides } from "@/lib/shellLimits";

export type MeshHollowOptions = { direction?: "inward" | "outward"; maxErrorMm?: number };
export type MeshHollowInput = { positions: ArrayLike<number>; indices: ArrayLike<number>; thickness: number; openings: ShellOpenings; options?: MeshHollowOptions };
export type MeshHollowResult = { positions: number[]; indices: number[]; stats: {
  method: "mesh-sdf"; cellSizeMm: number; maxErrorMm: number; measuredErrorMm: number;
  sourceTriangles: number; resultTriangles: number; sourceVolumeMm3: number; resultVolumeMm3: number;
  cavityVolumeMm3: number; evaluations: number; durationMs: number; omittedCavities: number;
} };
const OPENING_AXES = { left:[0,-1], right:[0,1], bottom:[1,-1], top:[1,1], front:[2,1], back:[2,-1] } as const;
const GRID_CELL_BUDGET = 16_000_000;

/** Offset an actual faceted solid, keeping its original outside for inward walls.
 * BVH distance queries + oriented first ray hits define the signed distance.
 * Manifold's marching tetrahedra builds only the cavity; no OCCT triangle sewing.
 * Error is measured at vertices, edge midpoints and triangle centroids, not certified
 * as a global analytic offset bound. Source must already be a closed oriented mesh.
 */
export function hollowMesh(runtime: ManifoldToplevel, input: MeshHollowInput, onProgress: (text: string) => void = () => {}): MeshHollowResult {
  const started = performance.now(), wall = input.thickness;
  const maxError = input.options?.maxErrorMm ?? 0.1;
  const outward = input.options?.direction === "outward";
  if (!Number.isFinite(wall) || wall <= 0) throw new Error("Wall thickness must be positive");
  if (!Number.isFinite(maxError) || maxError < 0.02 || maxError > 0.5) throw new Error("Mesh accuracy must be between 0.02 and 0.5 mm");
  if (input.positions.length % 3 || input.indices.length % 3 || input.indices.length < 12) throw new Error("Invalid mesh arrays");
  for(let i=0;i<input.positions.length;i++)if(!Number.isFinite(input.positions[i]))throw new Error("Mesh contains non-finite coordinates");
  for(let i=0;i<input.indices.length;i++)if(!Number.isInteger(input.indices[i])||input.indices[i]<0||input.indices[i]>=input.positions.length/3)throw new Error("Mesh contains invalid triangle indices");
  if (input.indices.length / 3 > 1_000_000) throw new Error("Mesh hollowing input exceeds its isolated worker memory budget; simplify the source first");
  const retained: Manifold[] = [], geometries: BufferGeometry[] = [];
  let sourceMesh: Mesh | undefined;
  try {
    onProgress("Checking closed mesh");
    sourceMesh = new runtime.Mesh({ numProp:3, vertProperties:Float32Array.from(input.positions), triVerts:Uint32Array.from(input.indices), tolerance:1e-5 });
    sourceMesh.merge();
    let source:Manifold;
    try {source=runtime.Manifold.ofMesh(sourceMesh);}
    catch {throw new Error("Mesh hollowing needs a closed, consistently oriented solid. Repair open or non-manifold source edges first.");}
    retained.push(source);
    if (source.status() !== "NoError" || source.isEmpty() || source.volume() <= 0) throw new Error("Mesh hollowing needs a closed, consistently oriented solid. Repair open or non-manifold source edges first.");
    const bounds = source.boundingBox(), original = source.getMesh();
    const sourceVolume = source.volume();
    const positions = original.vertProperties, indices = original.triVerts;
    const makeBvh = (faces: Uint32Array | number[]) => {
      const geometry = new BufferGeometry(); geometries.push(geometry);
      geometry.setAttribute("position", new Float32BufferAttribute(positions, original.numProp));
      geometry.setIndex(Array.from(faces));
      return new MeshBVH(geometry, { targetLeafSize: 8 });
    };
    const sides = shellOpenSides(input.openings);
    if (outward && sides.length) throw new Error("Outward mesh walls currently need Closed (cavity inside). Use inward walls for an open base.");
    const epsilon = Math.max(1e-5, Math.hypot(...bounds.max.map((v,i)=>v-bounds.min[i])) * 1e-7);
    const openings = sides.map(side=>{const [axis,sign]=OPENING_AXES[side];return {side,axis,sign,coordinate:sign<0?bounds.min[axis]:bounds.max[axis], found:false};});
    const walls: number[] = [];
    for(let i=0;i<indices.length;i+=3) {
      const face=[indices[i],indices[i+1],indices[i+2]];
      const opening=openings.find(o=>face.every(v=>Math.abs(positions[v*original.numProp+o.axis]-o.coordinate)<=epsilon));
      if(opening) opening.found=true; else walls.push(...face);
    }
    const absent = openings.find(o=>!o.found);
    if(absent) throw new Error(`This mesh has no flat ${absent.side} face to open. Choose Closed (cavity inside), or a flat cut base such as Bottom.`);
    if(walls.length<12) throw new Error("Too many faces were selected as openings");
    const signBvh = makeBvh(indices), distanceBvh = openings.length ? makeBvh(walls) : signBvh;
    const probe = new Vector3(), signedProbe = new Vector3();
    const nearest = {point:new Vector3(),distance:0,faceIndex:0};
    const ray = new Ray(new Vector3(),new Vector3(1,0.371390676,0.69474659).normalize());
    let evaluations = 0;
    const distanceField = (p: readonly number[]) => {
      evaluations++;
      if(evaluations % 200_000 === 0) onProgress(`Building mesh cavity (${Math.round(evaluations/1000)}k distance queries)`);
      probe.set(p[0],p[1],p[2]);
      const hit=distanceBvh.closestPointToPoint(probe,nearest);
      if(!hit) throw new Error("Could not measure source surface distance");
      const distance=hit.distance;
      signedProbe.copy(probe);
      for(const opening of openings) {
        if(opening.sign<0 && signedProbe.getComponent(opening.axis)<opening.coordinate+epsilon*2) signedProbe.setComponent(opening.axis,opening.coordinate+epsilon*2);
        if(opening.sign>0 && signedProbe.getComponent(opening.axis)>opening.coordinate-epsilon*2) signedProbe.setComponent(opening.axis,opening.coordinate-epsilon*2);
      }
      ray.origin.copy(signedProbe);
      const crossing=signBvh.raycastFirst(ray,DoubleSide);
      const inside=Boolean(crossing?.face && ray.direction.dot(crossing.face.normal)>0);
      return inside?distance:-distance;
    };
    let cell = Math.min(wall*0.6,Math.sqrt(wall*maxError*4));
    let cavity: Manifold | undefined, measuredError = Infinity, omittedCavities = 0;
    for(let pass=0;pass<4;pass++,cell/=2) {
      onProgress(`Building ${outward?"outer surface":"inner cavity"}, grid ${cell.toFixed(3)} mm`);
      const low=[...bounds.min], high=[...bounds.max];
      const margin=outward?wall+cell*2:cell*2;
      for(let axis=0;axis<3;axis++){low[axis]-=margin;high[axis]+=margin;}
      for(const opening of openings) if(opening.sign<0) low[opening.axis]-=wall;else high[opening.axis]+=wall;
      const cells=low.reduce((n,v,i)=>n*Math.ceil((high[i]-v)/cell),1)*3;
      if(cells>128_000_000) throw new Error(`Requested mesh accuracy needs approximately ${Math.ceil(cells/1e6)} million grid cells. Choose a larger mesh accuracy value or reduce the model size; the original is unchanged.`);
      const level=outward?-wall:wall;
      const build=(min:number[],max:number[])=>runtime.Manifold.levelSet(distanceField,{min:min as [number,number,number],max:max as [number,number,number]},cell,level,Math.min(maxError/8,0.01));
      let made:Manifold;
      if(cells<=GRID_CELL_BUDGET) made=build(low,high);
      else {
        // Fine cavities are generated in overlapping slabs instead of allocating
        // a full high-resolution volume at once. Only the cavity is combined;
        // the original outer mesh never passes through this grid.
        const axis=high.map((v,i)=>v-low[i]).indexOf(Math.max(...high.map((v,i)=>v-low[i])));
        const count=Math.ceil(cells/(GRID_CELL_BUDGET*0.7));
        const parts:Manifold[]=[];
        try {
          for(let tile=0;tile<count;tile++){
            onProgress(`Building fine cavity slab ${tile+1}/${count}, grid ${cell.toFixed(3)} mm`);
            const min=[...low],max=[...high],span=high[axis]-low[axis];
            min[axis]=Math.max(low[axis],low[axis]+span*tile/count-cell*2);
            max[axis]=Math.min(high[axis],low[axis]+span*(tile+1)/count+cell*2);
            parts.push(build(min,max));
          }
          made=runtime.Manifold.union(parts);
          // Force evaluation while inputs are still alive, then release slabs.
          made.numTri();
        } finally {parts.forEach(part=>part.delete());}
      }
      retained.push(made);
      if(made.status()!=="NoError"||made.isEmpty()) throw new Error("No internal cavity fits this wall thickness. Choose thinner walls; narrow details may need to remain solid.");
      const components=made.decompose();retained.push(...components);
      components.sort((a,b)=>Math.abs(b.volume())-Math.abs(a.volume()));
      cavity=components[0];omittedCavities=components.length-1;
      // Grid triangles are construction detail, not useful printable detail.
      // Simplify the cavity only; the original outside is never simplified.
      // Measure the simplified result against the source SDF before accepting it.
      const simplified=cavity.simplify(maxError/4);retained.push(simplified);
      if(simplified.status()!=="NoError"||simplified.isEmpty())throw new Error("Cavity simplification failed; source preserved");
      cavity=simplified;
      const sample=cavity.getMesh(); measuredError=0;
      let vertexError=0,edgeError=0,centerError=0;
      const check=(p:number[])=>{
        if(openings.some(o=>o.sign<0?p[o.axis]<o.coordinate-epsilon:p[o.axis]>o.coordinate+epsilon))return 0;
        const error=Math.abs(distanceField(p)-level);
        measuredError=Math.max(measuredError,error);return error;
      };
      const point=(index:number)=>[sample.vertProperties[index*sample.numProp],sample.vertProperties[index*sample.numProp+1],sample.vertProperties[index*sample.numProp+2]];
      for(let i=0;i<sample.triVerts.length;i+=3){
        const a=point(sample.triVerts[i]),b=point(sample.triVerts[i+1]),c=point(sample.triVerts[i+2]);
        vertexError=Math.max(vertexError,check(a));centerError=Math.max(centerError,check(a.map((v,j)=>(v+b[j]+c[j])/3)));
        for(const [u,v] of [[a,b],[b,c],[c,a]])edgeError=Math.max(edgeError,check(u.map((x,j)=>(x+v[j])/2)));
      }
      onProgress(`Measured cavity error: vertex ${vertexError.toFixed(4)}, edge ${edgeError.toFixed(4)}, face ${centerError.toFixed(4)} mm`);
      if(measuredError<=maxError) break;
      // Failed coarse passes should not occupy memory during fine generation.
      for(const old of new Set([made,...components,cavity])){const at=retained.indexOf(old);if(at>=0)retained.splice(at,1);old.delete();}
      cavity=undefined;
    }
    if(!cavity||measuredError>maxError)throw new Error(`Mesh offset error ${measuredError.toFixed(3)} mm exceeds the requested ${maxError} mm. The source was preserved.`);
    onProgress("Validating and cutting cavity");
    const result=outward?cavity.subtract(source):source.subtract(cavity);retained.push(result);
    if(result.status()!=="NoError"||result.isEmpty()||result.volume()<=0||(!outward&&result.volume()>=sourceVolume))throw new Error("Mesh cavity did not leave a valid hollow solid");
    const output=result.getMesh();
    const outputPositions:number[]=[];
    for(let i=0;i<output.vertProperties.length;i+=output.numProp)outputPositions.push(output.vertProperties[i],output.vertProperties[i+1],output.vertProperties[i+2]);
    return {positions:outputPositions,indices:Array.from(output.triVerts),stats:{method:"mesh-sdf",cellSizeMm:cell,maxErrorMm:maxError,measuredErrorMm:measuredError,sourceTriangles:source.numTri(),resultTriangles:result.numTri(),sourceVolumeMm3:sourceVolume,resultVolumeMm3:result.volume(),cavityVolumeMm3:cavity.volume(),evaluations,durationMs:performance.now()-started,omittedCavities}};
  } finally {
    for(const shape of new Set(retained))shape.delete();
    // Mesh is a plain JS wrapper in current Manifold builds; only delete when supplied.
    (sourceMesh as unknown as {delete?:()=>void})?.delete?.();
    geometries.forEach(geometry=>geometry.dispose());
  }
}
