import type {OcctKernel,ShapeHandle} from "occt-wasm";
import type {SketchPadHistory} from "@/lib/sketchPadHistory";
import {constraintSketchProfile} from "@/lib/constraintSketch";
import {cadSketchRegions} from "@/lib/sketchCadProfile";
import {pathWire} from "@/lib/sketchCadWire";

export function replaySketchPocket(kernel:OcctKernel, pad:ShapeHandle, pocket:NonNullable<SketchPadHistory["pocket"]>, height:number) {
  if (pocket.depthMm>height) throw Error("Pocket depth exceeds pad depth");
  const regions=cadSketchRegions(constraintSketchProfile(pocket.profile));
  if (!regions.length) throw Error("Pocket requires a closed sketch");
  const margin=Math.max(.01,height*1e-5);
  let solid=pad;
  for(const region of regions){
    let face=kernel.makeFace(pathWire(kernel,region.outer));
    if(region.holes.length) face=kernel.addHolesInFace(face,region.holes.map(h=>pathWire(kernel,h)));
    const cutter=kernel.translate(kernel.extrude(face,0,pocket.depthMm+margin,0),0,height-pocket.depthMm,0);
    const next=kernel.cut(solid,cutter);
    const volume=kernel.getVolume(next);
    if(!kernel.isValid(next) || !(volume>0 && volume<kernel.getVolume(solid))) throw Error("Pocket " + pocket.id + " did not leave a valid cut");
    solid=next;
  }
  return solid;
}
