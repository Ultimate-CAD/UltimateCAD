import {it,expect,vi} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
import manifoldModule from 'manifold-3d';
import {sevenHolePlateSelection} from '../fixtures/sevenHolePlate';
import {DEFAULT_PRECISION,PRECISION_PRESETS} from '@/lib/precisionMesh';
vi.mock('@/lib/brepKernel',async()=>{const brep=await import('brepjs'),{OcctKernel}=await import('occt-wasm');const kernel=await OcctKernel.init({wasm:join(dirname(fileURLToPath(import.meta.resolve('occt-wasm'))),'occt-wasm.wasm')});brep.registerKernel('occt-wasm',brep.OcctWasmAdapter.fromKernel(kernel));return {loadBrepWithOcct:async()=>brep,occtKernel:()=>kernel};});
it('reproduces normally grouped native seven-hole plate exports',async()=>{
 const {buildGroupedShapeFromSelection}=await import('@/lib/editorBooleans'),{PrecisionExportEngine}=await import('@/lib/precisionExport');
 const selected=sevenHolePlateSelection(),grouped=await buildGroupedShapeFromSelection(selected,4_000_000);expect(grouped.group,grouped.failureNotice).not.toBeNull();
 const runtime=await manifoldModule();runtime.setup();const engine=new PrecisionExportEngine(runtime),root=`.codex-run/export11/repro-${Date.now()}`;mkdirSync(root,{recursive:true});
 writeFileSync(`${root}/group.json`,JSON.stringify(grouped.group,null,2));
 const {analyticMeshForExport}=await import('@/lib/stepExport'),{subdivideManufacturingMesh,improvePlanarAspect}=await import('@/lib/precisionMesh'),{manufacturingSurfaceChecks}=await import('@/lib/meshManufacturingQa'),{indexManufacturingMesh}=await import('@/lib/manufacturingMesh');
 const analytic=await analyticMeshForExport(grouped.group!,.025,8);expect(analytic).not.toBeNull();
 const aspect=improvePlanarAspect(analytic!.mesh,8).mesh,refined=subdivideManufacturingMesh(aspect,1,4_000_000),stages={analytic:analytic!.mesh,aspect,subdivided:refined};
 for(const [stage,mesh] of Object.entries(stages)){for(const encoded of [false,true]){const m=encoded?{...mesh,vertices:mesh.vertices.map(p=>p.map(Math.fround) as [number,number,number])}:mesh,check=manufacturingSurfaceChecks(m,true,0),indexed=indexManufacturingMesh(m);const pairs=check.selfIntersections.exampleFaces.map(([a,b])=>({faces:[a,b],indices:[indexed.faces[a],indexed.faces[b]],positions:[indexed.faces[a].map(i=>indexed.vertices[i]),indexed.faces[b].map(i=>indexed.vertices[i])]}));writeFileSync(`${root}/${stage}-${encoded?'f32':'f64'}-pairs.json`,JSON.stringify({check,pairs},null,2));console.log(JSON.stringify({stage,encoded,triangles:m.faces.length,hits:check.selfIntersections.found,pairs}));}}
 for(const [name,settings] of [['high',{...DEFAULT_PRECISION,...PRECISION_PRESETS.high,preset:'high'}],['ultra',{...DEFAULT_PRECISION,...PRECISION_PRESETS.ultra,preset:'ultra'}],['fine',{...DEFAULT_PRECISION,deviationMm:.001,angleDeg:1,preset:'custom'}],['edge',{...DEFAULT_PRECISION,maxEdgeMm:1,preset:'custom'}]] as const){const r=await engine.run([grouped.group!],'stl',settings);writeFileSync(`${root}/${name}.json`,JSON.stringify(r.report,null,2));console.log(JSON.stringify({root,name,ready:r.report.ready,triangles:r.report.triangles,audit:r.report.bodies[0].audit.valid,intersections:r.report.bodies[0].surface.selfIntersections}));}
},180000);
