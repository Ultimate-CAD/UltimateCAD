import {DoubleSide,Ray,Vector3} from "three";
import type {MeshBVH} from "three-mesh-bvh";

export type DistanceQueryStats={nearestQueries:number;faceSignQueries:number;boundsSignQueries:number;rayQueries:number};

/** Reuses a unique closest face's orientation. Edge/vertex cases retain the original ray classifier. */
export function createMeshDistanceQuery(signBvh:MeshBVH,distanceBvh:MeshBVH,bounds:{min:readonly number[];max:readonly number[]},epsilon:number){
 const positions=distanceBvh.geometry.attributes.position,index=distanceBvh.geometry.index!;
 // One immutable record per BVH-ordered face: A, barycentric duals, unit normal and validity.
 const stride=13,faces=new Float64Array(index.count/3*stride);
 for(let i=0;i<index.count;i+=3){
  const ai=index.getX(i),bi=index.getX(i+1),ci=index.getX(i+2),offset=i/3*stride;
  const ax=positions.getX(ai),ay=positions.getY(ai),az=positions.getZ(ai);
  const ux=positions.getX(bi)-ax,uy=positions.getY(bi)-ay,uz=positions.getZ(bi)-az;
  const vx=positions.getX(ci)-ax,vy=positions.getY(ci)-ay,vz=positions.getZ(ci)-az;
  const uu=ux*ux+uy*uy+uz*uz,uv=ux*vx+uy*vy+uz*vz,vv=vx*vx+vy*vy+vz*vz,denominator=uu*vv-uv*uv;
  if(!(denominator>uu*vv*1e-12))continue;
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);
  faces.set([ax,ay,az,(vv*ux-uv*vx)/denominator,(vv*uy-uv*vy)/denominator,(vv*uz-uv*vz)/denominator,
   (uu*vx-uv*ux)/denominator,(uu*vy-uv*uy)/denominator,(uu*vz-uv*uz)/denominator,nx/length,ny/length,nz/length,1],offset);
 }
 const nearest={point:new Vector3(),distance:0,faceIndex:0},probe=new Vector3();
 const ray=new Ray(new Vector3(),new Vector3(1,.371390676,.69474659).normalize());
 const stats:DistanceQueryStats={nearestQueries:0,faceSignQueries:0,boundsSignQueries:0,rayQueries:0};
 const signedDistance=(p:readonly number[],signPoint:readonly number[]=p)=>{
  stats.nearestQueries++;probe.set(p[0],p[1],p[2]);
  const hit=distanceBvh.closestPointToPoint(probe,nearest);
  if(!hit)throw new Error("Could not measure source surface distance");
  const distance=hit.distance;
  // A point beyond the original closed body's bounds is certainly outside.
  if(signPoint[0]<bounds.min[0]||signPoint[0]>bounds.max[0]||signPoint[1]<bounds.min[1]||signPoint[1]>bounds.max[1]||signPoint[2]<bounds.min[2]||signPoint[2]>bounds.max[2]){stats.boundsSignQueries++;return-distance;}
  if(signBvh===distanceBvh&&signPoint===p){
   const offset=hit.faceIndex*stride;
   if(faces[offset+12]){
    const dx=hit.point.x-faces[offset],dy=hit.point.y-faces[offset+1],dz=hit.point.z-faces[offset+2];
    const b=dx*faces[offset+3]+dy*faces[offset+4]+dz*faces[offset+5],c=dx*faces[offset+6]+dy*faces[offset+7]+dz*faces[offset+8];
    const orientation=(p[0]-hit.point.x)*faces[offset+9]+(p[1]-hit.point.y)*faces[offset+10]+(p[2]-hit.point.z)*faces[offset+11];
    if(b>1e-7&&c>1e-7&&1-b-c>1e-7&&Math.abs(orientation)>epsilon){stats.faceSignQueries++;return orientation<0?distance:-distance;}
   }
  }
  stats.rayQueries++;ray.origin.set(signPoint[0],signPoint[1],signPoint[2]);
  const crossing=signBvh.raycastFirst(ray,DoubleSide);
  return crossing?.face&&ray.direction.dot(crossing.face.normal)>0?distance:-distance;
 };
 return{signedDistance,stats};
}
