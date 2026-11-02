import type {WorkplaneShape} from '../../apps/web/src/types/layerling';
/** Native circular plate: Ø80 x 6, Ø12 center, six Ø6 holes on Ø50 PCD. */
export function sevenHolePlateSelection():WorkplaneShape[]{
 const cylinder=(id:string,diameter:number,x=0,z=0,hole=false):WorkplaneShape=>({id,name:id,kind:'cylinder',color:'#0169cc',x,z,elevation:hole?-2:0,size:diameter,width:diameter,depth:diameter,height:hole?10:6,rotation:0,sides:96,hole});
 return [cylinder('plate',80),cylinder('center-hole',12,0,0,true),...Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return cylinder(`bolt-hole-${i+1}`,6,25*Math.cos(a),25*Math.sin(a),true);})];
}
