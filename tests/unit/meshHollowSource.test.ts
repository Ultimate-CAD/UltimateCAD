import { describe,expect,it } from "vitest";
import { isPureMeshHollowSource } from "@/lib/meshHollowSource";
import type { WorkplaneShape } from "@/types/layerling";
const mesh = {id:"test",kind:"mesh",name:"test",color:"#abcdef",x:0,z:0,width:10,depth:10,height:10,size:10,
  importedMesh:{positions:[0,0,0,1,0,0,0,1,0],baseWidth:10,baseDepth:10,baseHeight:10,triangleCount:1,sourceFormat:"obj"}} as WorkplaneShape;
describe("hollow representation selection",()=>{
  it("routes an OBJ and a cut group containing an OBJ to mesh hollowing",()=>{
    expect(isPureMeshHollowSource(mesh)).toBe(true);
    expect(isPureMeshHollowSource({...mesh,groupedShapes:[mesh,{...mesh,kind:"box",importedMesh:undefined}]})).toBe(true);
  });
  it("retains exact BREP on the selected body even with mesh children in history",()=>{
    expect(isPureMeshHollowSource({...mesh,cadBrep:"exact",groupedShapes:[mesh]})).toBe(false);
    expect(isPureMeshHollowSource({...mesh,importedMesh:{...mesh.importedMesh!,brepStep:"STEP"}})).toBe(false);
  });
  it("keeps native catalog solids on CAD shelling",()=>{
    const native={...mesh,kind:"box" as const,importedMesh:undefined};
    expect(isPureMeshHollowSource(native)).toBe(false);
    expect(isPureMeshHollowSource({...mesh,groupedShapes:[native,{...native,hole:true}]})).toBe(false);
  });
});
