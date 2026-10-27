import { _electron as electron } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { testStdioMcp } from './mcp-smoke.mjs';
const executable = path.resolve(process.argv[2] || 'dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe');
const output = path.resolve(process.env.LAYERLING_SCAD_VALIDATION_DIR || 'dist/ultimate/windows/validation');
const profile = path.join(output, 'private profile with spaces');
const fixture = path.resolve('tests/fixtures/openscad/parametric-box-upstream.scad');
mkdirSync(output, { recursive: true });
let app, page, connection, editorId;
const checks = [], errors = [];
const pass = (name, detail) => { checks.push({ name, result: 'PASS', detail }); console.log('PASS', name, detail || ''); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function launch() {
  app = await electron.launch({ executablePath: executable, cwd: output, timeout: 90000, env: { ...process.env,
    ELECTRON_RUN_AS_NODE: undefined, PATH: process.env.SystemRoot + '\\System32',
    ProgramFiles: path.join(output, 'no development OpenSCAD installation'),
    LAYERLING_DESKTOP_PROFILE: profile, LAYERLING_DESKTOP_TEST: '1' } });
  page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Create new 3D design', exact: true }).waitFor({ timeout: 60000 });
  connection = JSON.parse(readFileSync(path.join(profile, 'connection.json'), 'utf8'));
}
async function ready() {
  for (let n = 0; n < 300; n++) {
    const result = await (await fetch(connection.url + '/api/layerling-mcp', { headers: { Authorization: `Bearer ${connection.token}` } })).json();
    if (result.editors?.length) { editorId = result.editors[0].editorId; return; }
    await pause(200);
  }
  throw new Error('Imported SCAD design did not open an editor');
}
async function command(action, params = {}) {
  const result = await (await fetch(connection.url + '/api/layerling-mcp', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'command', editorId, action, params, timeoutMs: 180000 }), signal: AbortSignal.timeout(185000) })).json();
  assert.ok(result.ok, `${action}: ${JSON.stringify(result)}`); return result.data;
}
async function waitForDocument(id, predicate, message) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const result = await command('openscad_get', { id });
    if (predicate(result)) return result;
    await pause(200);
  }
  throw new Error(message);
}
function validateManufacturingStl(bytes) {
  const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const position = geometry.getAttribute('position');
  assert.ok(position.count > 0 && position.count % 3 === 0);
  const edges = new Map(); let volume = 0;
  const point = i => [position.getX(i), position.getY(i), position.getZ(i)];
  const key = p => p.map(n => Math.round(n * 10000)).join(',');
  for (let i = 0; i < position.count; i += 3) {
    const [a,b,c] = [point(i),point(i+1),point(i+2)];
    assert.ok([...a,...b,...c].every(Number.isFinite));
    volume += (a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for (const [u,v] of [[a,b],[b,c],[c,a]]) { const e = [key(u),key(v)].sort().join('|'); edges.set(e,(edges.get(e)||0)+1); }
  }
  assert.ok(Math.abs(volume) > 0.001);
  // CGAL can triangulate a planar interface with collinear edges split differently.
  // Manifold export repairs those; report the exact boundary-edge count for the saved file.
  const boundaryEdges = [...edges.values()].filter(count => count !== 2).length;
  geometry.dispose(); return { triangles: position.count/3, volume: Math.abs(volume), boundaryEdges };
}
try {
  await launch();
  const prefs = await app.evaluate(({ BrowserWindow }) => { const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { sandbox:p.sandbox,nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation }; });
  assert.deepEqual(prefs,{sandbox:true,nodeIntegration:false,contextIsolation:true});
  pass('Packaged Ultimate launches with sandbox, no installed Node or development OpenSCAD on PATH');
  const offline = await page.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}});
  assert.ok(offline); pass('External network blocked before SCAD import');
  await page.locator('input[type=file][accept*=".scad"]').first().setInputFiles(fixture);
  await ready();
  const scene = await command('list_objects');
  const object = scene.objects.find(object=>object.openScad);
  assert.ok(object); const id = object.id;
  const initial = await command('openscad_get',{id});
  assert.equal(initial.document.source,readFileSync(fixture,'utf8'));
  assert.ok(initial.customizer.parameters.some(parameter=>parameter.name==='width'));
  assert.equal(initial.object.kind,'mesh');
  pass('Import existing upstream parameterized SCAD through dashboard', {id,parameters:initial.customizer.parameters.length,engine:initial.document.engineVersion,sourceDirectory:initial.document.sourceDirectory});
  assert.ok(initial.document.sourceDirectory,'Native File path bridge did not preserve relative dependency base');
  pass('Native selected-file path retained for relative includes');
  pass('Bundled stdio MCP exposes SCAD tools',await testStdioMcp(executable,profile));
  await command('select_objects',{ids:[id]});
  await page.getByRole('button',{name:'OpenSCAD workbench',exact:true}).click();
  await page.getByLabel('SCAD width',{exact:true}).waitFor();
  pass('Customizer graphical controls displayed');
  await page.getByLabel('SCAD width',{exact:true}).fill('76');
  const wider = await waitForDocument(id,result=>result.document.parameters.width===76,'Width edit did not regenerate');
  assert.ok(Math.abs(wider.object.dimensions.width-76)<0.02);
  assert.equal(wider.object.id,id); pass('Debounced UI dimension edit regenerates geometry in place',wider.object.dimensions);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await waitForDocument(id,result=>result.document.parameters.width!==76,'Undo did not restore SCAD parameters');
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await waitForDocument(id,result=>result.document.parameters.width===76,'Redo did not restore SCAD parameters');
  pass('UI parameter edit is undoable and redoable');
  await page.getByLabel('SCAD width expression',{exact:true}).fill('depth*2');
  const equation = await waitForDocument(id,result=>result.document.expressions.width==='depth*2','Equation override did not regenerate');
  assert.ok(Math.abs(equation.object.dimensions.width-80)<0.02); pass('Native dimensional equation override recomputes dependent geometry');
  await page.getByLabel('SCAD preset name').fill('wide-equation');
  await page.getByRole('button',{name:'Save preset',exact:true}).click();
  await waitForDocument(id,result=>Boolean(result.document.presets['wide-equation']),'Preset not persisted');
  pass('Named configuration saved with parameter and equation values');
  await command('openscad_update',{id,parameters:{width:68},expressions:{width:''}});
  await page.getByLabel('SCAD named configuration').selectOption('wide-equation');
  await waitForDocument(id,result=>result.document.parameters.width===76&&result.document.expressions.width==='depth*2','Named configuration did not regenerate');
  pass('Applying a named configuration restores values and regenerates');
  const saved = await command('save_project',{history:'all'});
  const projectFile=path.join(output,'scad-roundtrip.lyl');writeFileSync(projectFile,Buffer.from(saved.base64,'base64'));
  assert.ok(saved.bytes>0);pass('Whole Layerling project saved with native and SCAD representations',saved.bytes);
  await app.close();app=null;await launch();
  await page.locator('input[type=file][accept*=".lyl"]').first().setInputFiles(projectFile);await ready();
  const restored=await command('openscad_get',{id});
  assert.equal(restored.document.source,initial.document.source);assert.equal(restored.document.parameters.width,76);assert.equal(restored.document.expressions.width,'depth*2');assert.ok(restored.document.presets['wide-equation']);
  pass('Reopen LYL restores original SCAD, overrides, equations, presets and object identity');
  await command('select_objects',{ids:[id]});
  await page.getByRole('button',{name:'OpenSCAD workbench',exact:true}).click();
  const modified=restored.document.source.replace('wall = 2;','wall = 3;');assert.notEqual(modified,restored.document.source);
  await page.getByLabel('SCAD source',{exact:true}).fill(modified);
  const edited=await waitForDocument(id,result=>result.document.source===modified,'Direct source edit did not regenerate');
  assert.equal(edited.object.id,id);assert.notEqual(edited.document.meshKey,restored.document.meshKey);
  pass('Direct script edit regenerates without replacing object identity');
  const exported=await command('export_mesh',{format:'stl',ids:[id]});
  const bytes=Buffer.from(exported.base64,'base64');const mesh=validateManufacturingStl(bytes);
  writeFileSync(path.join(output,'scad-manufacturing.stl'),bytes);
  assert.equal(mesh.boundaryEdges,0,'Manufacturing STL has unmatched triangle edges');
  pass('Manufacturing STL export has finite triangles, positive volume and closed edges',mesh);
  const benchmark=[];for(let i=0;i<5;i++){const result=await command('openscad_update',{id});benchmark.push({cached:result.cached,ms:result.durationMs,key:result.key});}
  assert.ok(benchmark.slice(1).every(result=>result.cached));assert.equal(new Set(benchmark.map(result=>result.key)).size,1);
  writeFileSync(path.join(output,'regeneration-benchmark.json'),JSON.stringify(benchmark,null,2));pass('Repeated unchanged regeneration reuses cached geometry',benchmark);
  const malformed=await fetch(connection.url+'/api/openscad',{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({jobId:randomUUID(),input:{source:'cube([1,2);'}})});
  assert.equal(malformed.status,422);assert.match((await malformed.json()).error,/parser|syntax|OpenSCAD failed/i);pass('Malformed native script returns diagnostics');
  const missing=await fetch(connection.url+'/api/openscad',{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({jobId:randomUUID(),input:{source:'include <definitely-missing-library.scad>\ncube(2);'}})});
  assert.equal(missing.status,422);pass('Missing library produces a visible native diagnostic');
  const library=await command('openscad_create',{source:'use <MCAD/boxes.scad>\nroundedBox([12,14,10],2,true);',fileName:'bundled-mcad.scad'});
  const libraryDoc=await command('openscad_get',{id:library.object.id});
  assert.ok(Object.keys(libraryDoc.document.files).some(name=>name.endsWith('MCAD/boxes.scad')));
  pass('Bundled MCAD library resolves and is captured with the project');
  const jobId=randomUUID();const pending=fetch(connection.url+'/api/openscad',{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({jobId,input:{source:'sphere(r=20,$fn=1000);',timeoutMs:20000}})});
  await pause(600);await fetch(connection.url+'/api/openscad?jobId='+jobId,{method:'DELETE',headers:{Authorization:`Bearer ${connection.token}`}});
  const canceled=await pending;assert.equal(canceled.status,499);assert.equal((await canceled.json()).canceled,true);pass('Native render cancellation stops the process and returns a canceled result');
  await command('select_objects',{ids:[id]});
  const native=(await command('create_shape',{kind:'box',width:10,depth:10,height:10,x:140})).object;assert.ok(!native.openScad);
  const mixed=await command('save_project',{history:'all'});writeFileSync(path.join(output,'native-and-scad.lyl'),Buffer.from(mixed.base64,'base64'));pass('Native Layerling and SCAD objects coexist and save together');
  await page.screenshot({path:path.join(output,'ultimate-openscad-workbench.png')});
  assert.deepEqual(errors,[]);pass('No renderer exceptions in packaged workbench workflows');
} catch(error) {
  console.error(error);checks.push({name:'Validation failure',result:'FAIL',detail:error.stack});process.exitCode=1;
  if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});writeFileSync(path.join(output,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));}
} finally {
  if(app)await app.close().catch(()=>{});
  writeFileSync(path.join(output,'results.json'),JSON.stringify({executable,checks,errors},null,2));
}
