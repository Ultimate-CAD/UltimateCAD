import { _electron as electron } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('dist/ultimate/windows/midnight-theme-validation');mkdirSync(out,{recursive:true});
let app,page;const checks=[],errors=[];
try{
  app=await electron.launch({executablePath:path.resolve('dist/ultimate/windows/win-unpacked/Layerling Ultimate.exe'),cwd:out,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,PATH:process.env.SystemRoot+'\\System32',LAYERLING_DESKTOP_PROFILE:path.join(out,'isolated-profile'),LAYERLING_DESKTOP_TEST:'1'}});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  assert.equal(await app.evaluate(({app})=>app.getVersion()),'1.114.0-ultimate.9.1');
  await page.getByRole('button',{name:'Create new 3D design',exact:true}).waitFor({timeout:90000});
  await page.waitForFunction(()=>document.documentElement.dataset.palette==='midnight'&&getComputedStyle(document.body).backgroundColor==='rgb(17, 17, 17)');
  const style=await page.evaluate(()=>{const s=getComputedStyle(document.body);return {palette:document.documentElement.dataset.palette,background:s.backgroundColor,foreground:s.color,font:s.fontFamily,fontSize:s.fontSize,accent:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()};});
  assert.equal(style.background,'rgb(17, 17, 17)');assert.equal(style.foreground,'rgb(252, 252, 252)');assert.equal(style.fontSize,'16px');assert.match(style.font,/MS PGothic/);assert.equal(style.accent,'#0169cc');checks.push({name:'Requested palette and font applied',style});
  await page.screenshot({path:path.join(out,'dashboard.png'),fullPage:true});
  await page.getByRole('button',{name:'Create new 3D design',exact:true}).click();
  await page.getByRole('button',{name:'Theme',exact:true}).click();await page.getByRole('menuitem',{name:'Light',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.getByRole('button',{name:'Theme',exact:true}).click();await page.getByRole('menuitem',{name:'Midnight Blue',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.palette==='midnight');
  checks.push({name:'Theme is selectable; original light theme still works'});
  await page.screenshot({path:path.join(out,'editor.png'),fullPage:true});
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.palette==='midnight');
  assert.equal(await page.evaluate(()=>localStorage.getItem('layerling.theme')),'midnight');checks.push({name:'Theme persists after reload'});
  assert.deepEqual(errors,[]);
}catch(e){errors.push(e.stack||String(e));if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.on('will-prevent-unload',e=>e.preventDefault());}).catch(()=>{});await app.close().catch(()=>{});}if(errors.length)process.exitCode=1;}
