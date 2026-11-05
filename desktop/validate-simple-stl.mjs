import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { verifyStl } from "./manufacturing-file-audit.mjs";

const origin = process.env.LAYERLING_STL_DEV_URL || "http://localhost:3191";
const output = path.resolve(`.codex-run/simple-stl/gui-${Date.now()}`);
mkdirSync(output, { recursive: true });
const browser = await chromium.launchPersistentContext(path.join(output,"profile"), {headless:true,
  executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe", acceptDownloads:true});
const page = browser.pages()[0], errors = [], workers = [], checks = [];
page.setDefaultTimeout(90000);
page.on("pageerror", e => errors.push(e.message));
page.on("worker", w => workers.push(w.url()));
await page.route("**/*", route => /^https?:/.test(route.request().url()) && new URL(route.request().url()).origin !== new URL(origin).origin ? route.abort() : route.continue());
let editorId, complete = false;
async function command(action, params = {}) {
  const response = await fetch(`${origin}/api/layerling-mcp`, {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({type:"command",editorId,action,params,timeoutMs:120000})});
  const result = await response.json();
  assert.ok(result.ok, JSON.stringify(result));
  return result.data;
}
async function exportFile(file, picker = false) {
  const dialog = page.getByRole("dialog",{name:"Export",exact:true});
  const started = Date.now();
  if (picker) {
    await page.evaluate(() => {
      window.__stlProbe = {pickCount:0, writes:[]};
      window.showSaveFilePicker = async options => {
        window.__stlProbe.pickCount++;
        return {name:options.suggestedName, queryPermission:async()=>"granted", getFile:async()=>new File([],options.suggestedName),
          createWritable:async()=>({write:async data=>window.__stlProbe.writes.push(Array.from(data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data))),close:async()=>{},abort:async()=>{}})};
      };
    });
    await dialog.getByRole("button",{name:"Export STL",exact:true}).click();
    await page.waitForFunction(()=>window.__stlProbe.writes.length===1,null,{timeout:30000});
    const result = await page.evaluate(()=>window.__stlProbe);
    assert.equal(result.pickCount,1,"Default export asks for a location once");
    writeFileSync(path.join(output,file),Buffer.from(result.writes[0]));
    await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  } else {
    const download=page.waitForEvent("download");
    await dialog.getByRole("button",{name:"Export STL",exact:true}).click();
    await (await download).saveAs(path.join(output,file));
  }
  const bytes = readFileSync(path.join(output,file));
  assert.equal(bytes.length,84+bytes.readUInt32LE(80)*50);
  assert.match(bytes.subarray(0,80).toString(),/UNVERIFIED/);
  return {file,triangles:bytes.readUInt32LE(80),milliseconds:Date.now()-started};
}
try {
  await page.goto(origin,{waitUntil:"domcontentloaded",timeout:120000});
  await page.getByRole("button",{name:"Create new 3D design",exact:true}).click();
  for(let i=0;i<200;i++) {
    const result=await (await fetch(`${origin}/api/layerling-mcp`)).json();
    const editor=(result.editors||[]).find(e=>Date.now()-e.lastSeen<10000);
    if(editor){editorId=editor.editorId;break;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(editorId,"Editor registered");
  const box=(await command("create_shape",{kind:"box",width:20,depth:20,height:20})).object;
  const cylinder=(await command("create_shape",{kind:"cylinder",width:16,depth:16,height:25,x:7})).object;
  const group=(await command("group_objects",{ids:[box.id,cylinder.id]})).object;
  await command("select_objects",{ids:[group.id]});
  await page.keyboard.press("Control+e");
  const dialog=page.getByRole("dialog",{name:"Export",exact:true});
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("radio",{name:/^STL:/}).getAttribute("aria-checked"),"true");
  const advanced=dialog.getByText("Advanced / Analyze (optional)",{exact:true});
  assert.equal(await advanced.evaluate(el=>el.parentElement.open),false);
  assert.equal(await dialog.getByRole("button",{name:"Generate export preview",exact:true}).isVisible(),false);
  checks.push(await exportFile("group-standard.stl",true));
  checks.push({name:"Grouped box and cylinder independently reimport",audit:verifyStl(path.join(output,"group-standard.stl"))});
  assert.ok(!workers.some(url=>/precision[-_]?export/i.test(url)),"Ordinary export must not start the analysis worker");
  await page.keyboard.press("Control+e");
  await dialog.getByText(/^Mesh quality: Standard$/).click();
  await dialog.getByLabel("Mesh quality",{exact:true}).selectOption("ultra");
  checks.push(await exportFile("group-ultra.stl"));
  assert.ok(checks.at(-1).triangles>checks[0].triangles);
  await page.keyboard.press("Control+e");
  await dialog.getByText(/^Mesh quality: Standard$/).click();
  await dialog.getByLabel("Mesh quality",{exact:true}).selectOption("custom");
  await dialog.getByLabel("Surface deviation (mm)",{exact:true}).fill("0,002");
  await dialog.getByLabel("Angular tolerance (degrees)",{exact:true}).fill("3");
  checks.push(await exportFile("group-custom.stl"));
  const custom=await command("export_mesh",{format:"stl",stlQuality:{preset:"custom",deviationMm:0.002,angleDeg:3}});
  assert.deepEqual(Buffer.from(custom.base64,"base64"),readFileSync(path.join(output,"group-custom.stl")));
  const mcp=await command("export_mesh",{format:"stl",stlQuality:{preset:"standard"}});
  assert.equal(mcp.verified,false);assert.equal(mcp.quality.preset,"standard");
  assert.deepEqual(Buffer.from(mcp.base64,"base64"),readFileSync(path.join(output,"group-standard.stl")));
  await page.keyboard.press("Control+e");
  await advanced.click();
  assert.equal(await dialog.getByRole("button",{name:"Generate export preview",exact:true}).isVisible(),true);
  checks.push({name:"Optional analysis remains explicitly accessible; UI and MCP share identical bytes"});
  assert.deepEqual(errors,[]);
  complete = true;
  await page.screenshot({path:path.join(output,"optional-analysis.png")});
  console.log(JSON.stringify({output,checks,errors,workers},null,2));
} finally {
  await page.screenshot({path:path.join(output,"last-state.png")}).catch(()=>{});
  writeFileSync(path.join(output,"report.json"),JSON.stringify({complete,checks,errors,workers},null,2));
  await browser.close();
}
