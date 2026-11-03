import { expect, it } from "vitest";
import { mountingPlateSketch } from "@/lib/constraintSketch";
import { constraintSketchShape } from "@/lib/constraintSketchShape";
import { cloneSketchProfile } from "@/lib/sketchSmoothHandles";
import { isNonSolidShape } from "@/lib/workplaneShapes";
import { meshForShape } from "@/lib/editorMeshCore";
import { editorHistoryEntry, hydrateEditorHistoryState } from "@/lib/editorHistory";
import { exportLylProject, importLylProject } from "@/lib/lylProject";
import { unzipSync, strFromU8 } from "fflate";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";

it("round trips editable planar sketches, exact arc data and undo states without inventing a solid",async()=>{
  const doc=mountingPlateSketch(),first=constraintSketchShape(doc,"stable-sketch");
  expect(isNonSolidShape(first)).toBe(true);expect(meshForShape(first).faces).toHaveLength(0);
  const changed=structuredClone(doc);changed.constraints.find(c=>c.id==="outer-radius")!.value=45;
  const next=constraintSketchShape(changed,first.id,first),history=[editorHistoryEntry([first],[]),editorHistoryEntry([next],[])];
  const bytes=await exportLylProject({projectId:"sketch16",projectName:"Sketch16",createdAt:1,modifiedAt:2,shapes:[next],history,historyIndex:1,assets:[],workspace:DEFAULT_WORKPLANE_WORKSPACE,snapGrid:DEFAULT_SNAP_GRID,placementElevation:0});
  const restored=await importLylProject(bytes);
  const document=JSON.parse(strFromU8(unzipSync(bytes)["project.json"]));expect(document.formatVersion).toBe(5);expect(document.minimumReaderVersion).toBe(5);
  expect(restored.shapes[0].id).toBe(first.id);expect(restored.shapes[0].sketchOnly).toBe(true);expect(restored.shapes[0].sketchProfile?.constraintSketch).toEqual(changed);
  expect(restored.shapes[0].sketchProfile?.segments.find(s=>s.analyticMidpoint)?.analyticMidpoint).toEqual(first.sketchProfile!.segments.find(s=>s.analyticMidpoint)!.analyticMidpoint);
  const original=hydrateEditorHistoryState(restored.shapes,restored.history,restored.historyIndex);expect(original.entries).toHaveLength(2);expect(original.entries[0].shapes[0].sketchProfile?.constraintSketch).toEqual(doc);
  const copy=cloneSketchProfile(first.sketchProfile!);copy.constraintSketch!.constraints[0].value=99;copy.segments.find(s=>s.analyticMidpoint)!.analyticMidpoint!.x=123;
  expect(first.sketchProfile?.constraintSketch?.constraints[0].value).toBe(40);expect(first.sketchProfile!.segments.find(s=>s.analyticMidpoint)!.analyticMidpoint!.x).not.toBe(123);
});
import {createSketchPadHistory} from "@/lib/sketchPadHistory";

it("requires a feature-aware reader even when only an undo state carries the named pad",async()=>{
  const sketch=mountingPlateSketch();
  sketch.featureHistory=createSketchPadHistory(5);
  sketch.featureHistory.parameters=[{name:"stock",unit:"mm",expression:"2.5 mm"},{name:"depth",unit:"mm",expression:"stock * 2"}];
  const first=constraintSketchShape(sketch,"stable");
  const plain=constraintSketchShape(mountingPlateSketch(),"stable",first);
  const bytes=await exportLylProject({projectId:"feature17",projectName:"History",createdAt:1,modifiedAt:2,shapes:[plain],history:[editorHistoryEntry([first],[]),editorHistoryEntry([plain],[])],historyIndex:1,assets:[],workspace:DEFAULT_WORKPLANE_WORKSPACE,snapGrid:DEFAULT_SNAP_GRID,placementElevation:0});
  const doc=JSON.parse(strFromU8(unzipSync(bytes)["project.json"]));
  expect([doc.formatVersion,doc.minimumReaderVersion]).toEqual([6,6]);
  const restored=await importLylProject(bytes);
  expect(restored.history?.[0].shapes[0].sketchProfile?.constraintSketch?.featureHistory).toEqual(sketch.featureHistory);
});
