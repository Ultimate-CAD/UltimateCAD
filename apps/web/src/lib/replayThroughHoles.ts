import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { cutWithNamedFaces, resolveFeatureEdge, type NamedFaces } from "@/lib/featureEdgeLineage";
import { holeInstance, resolvePadDepth, type SketchPadHistory } from "@/lib/sketchPadHistory";

/** Through all of this pad along its local extrusion axis, before object placement. */
export function replayThroughHoles(kernel:OcctKernel, pad:ShapeHandle, history:SketchPadHistory):ShapeHandle {
  const height = resolvePadDepth(history);
  let solid = pad;
  const finish = history.rimFinish;
  const track = finish && !finish.suppressed;
  const cap = history.pad.id + "/top";
  let roles: NamedFaces = new Map();
  if (track) {
    const topFaces = kernel.getSubShapes(pad,"face").filter(face => {
      const bounds = kernel.getBoundingBox(face);
      return kernel.surfaceType(face) === "plane" && Math.abs(bounds.ymin-height)<1e-7 && Math.abs(bounds.ymax-height)<1e-7;
    });
    roles.set(cap,topFaces);
  }
  for (const hole of history.holes ?? []) {
    if (hole.suppressed) continue;
    for (let index=0;index<(hole.pattern?.count ?? 1);index++) {
      const instance=holeInstance(hole,index);
      try {
        const margin = Math.max(0.01, height * 1e-5);
        const edge = kernel.makeCircleEdge({x:instance.x,y:-margin,z:instance.z},{x:0,y:1,z:0},hole.diameterMm/2);
        const cutter = kernel.extrude(kernel.makeFace(kernel.makeWire([edge])),0,height + 2*margin,0);
        let next: ShapeHandle;
        if (track) {
          roles.set(instance.wall, kernel.getSubShapes(cutter,"face").filter(face => kernel.surfaceType(face) === "cylinder"));
          const cut = cutWithNamedFaces(kernel,solid,cutter,roles);
          next = cut.solid;
          roles = cut.faces;
        } else next = kernel.cut(solid,cutter);
        const volume = kernel.getVolume(next);
        if (!kernel.isValid(next) || !(volume > 0 && volume < kernel.getVolume(solid))) throw Error("The hole must remove material and leave a valid solid");
        solid = next;
      } catch (error) {
        throw Error("Hole " + hole.id + " instance " + index + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  if (track) {
    const wall = finish.instance ? finish.patternId+"/instance/"+finish.instance+"/wall" : finish.holeId+"/wall";
    const producer = history.holes?.find(hole => hole.id === finish.holeId);
    if (finish.instance && (!producer?.pattern || producer.pattern.id !== finish.patternId)) throw Error("Missing producing pattern for rim " + finish.id);
    const edge = resolveFeatureEdge(kernel,roles,{firstFace:cap,secondFace:wall});
    const bodies = kernel.getSubShapes(solid,"solid");
    const owners = bodies.filter(body=>kernel.getSubShapes(body,"edge").some(candidate=>kernel.isSame(edge,candidate)));
    if (owners.length !== 1) throw Error("Ambiguous owner of rim " + finish.holeId);
    const treated = finish.kind === "fillet" ? kernel.fillet(owners[0],[edge],finish.sizeMm) : kernel.chamfer(owners[0],[edge],finish.sizeMm);
    const others = bodies.filter(body=>!kernel.isSame(body,owners[0]));
    solid = others.length ? kernel.makeCompound([...others,treated]) : treated;
    if (!kernel.isValid(solid) || !(kernel.getVolume(solid)>0)) throw Error("Invalid rim treatment " + finish.id);
  }
  return solid;
}
