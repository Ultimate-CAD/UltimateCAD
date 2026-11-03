const { app, BrowserWindow, Menu, dialog, utilityProcess, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const branding = require('./branding.json');
const ultimate = require('./package.json').name === 'layerling-ultimate' || process.env.LAYERLING_ULTIMATE_BUILD === '1';
const productName = branding.name;
// Compatibility identity is independent of the user's display brand.
const storageName = ultimate ? 'Layerling Ultimate' : 'Layerling Desktop';
app.setName(productName);
app.setAppUserModelId(ultimate ? 'org.layerling.ultimate' : 'org.layerling.desktop');
// Explicit profile override is used by isolated release verification, never by renderer input.
app.setPath('userData', path.resolve(process.env.LAYERLING_DESKTOP_PROFILE || path.join(app.getPath('appData'), storageName)));
const profile = app.getPath('userData');
fs.mkdirSync(profile, { recursive: true });
const log = message => fs.appendFileSync(path.join(profile, 'desktop.log'), `${new Date().toISOString()} ${message}\n`);
const readJson = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(profile, name), 'utf8')); } catch { return fallback; } };
const writeJson = (name, data) => {
  const target = path.join(profile, name);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
};
let server, window, quitting = false, baseUrl;
let geometryJobs;
let femJobs;
const connectionPath = path.join(profile, 'connection.json');

function openLocalPage(url) {
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) throw Error('Help must be a local page');
  void window?.webContents.executeJavaScript(`window.open(${JSON.stringify(url)}, '_blank')`, true).catch(error => log(error.message));
}

function freePort(wanted) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error(`Desktop port ${wanted} is unavailable (${error.code}). Close the conflicting process and retry; saved projects have been preserved.`)));
    probe.listen(wanted, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}
function cleanup() {
  quitting = true;
  geometryJobs?.close();
  femJobs?.cancelAll();
  if (server) {
    // Also terminate a native OpenSCAD render below the managed utility process.
    // Killing only the Node parent can leave a console launcher/CGAL child alive.
    if (ultimate && Number.isInteger(server.pid) && server.pid > 0) {
      spawnSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    }
    server.kill(); server = null;
  }
  fs.rmSync(connectionPath, { force: true });
}
async function start() {
  const settings = readJson('desktop-settings.json', {});
  const port = await freePort(Number.isInteger(settings.port) && settings.port > 1024 && settings.port < 65536 ? settings.port : 0);
  writeJson('desktop-settings.json', { port });
  baseUrl = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(32).toString('hex');
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../dist/desktop-stage');
  {
    const {NativeGeometryJobs}=require('./native-geometry.cjs');
    geometryJobs=new NativeGeometryJobs(path.join(resources,'geometry/layerling-geometry.exe'),path.join(profile,'native-geometry-jobs'));
    const trusted=event=>{if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Untrusted native geometry request');};
    ipcMain.handle('geometry:run',async(event,id,bytes)=>{trusted(event);try{return {ok:true,...await geometryJobs.run(id,bytes,text=>{if(!event.sender.isDestroyed())event.sender.send('geometry:progress',id,text);})};}catch(error){return {ok:false,message:error.message,code:error.code};}});
    ipcMain.on('geometry:cancel',(event,id)=>{try{trusted(event);geometryJobs.cancel(id);}catch{ /* Ignore frames that do not own the editor. */ }});
    const {FemJobs}=require('./fem-jobs.cjs');
    femJobs=new FemJobs(path.join(resources,'fem'),path.join(profile,'fem-jobs'));
    ipcMain.handle('fem:run',async(event,id,request)=>{trusted(event);try{return {ok:true,result:await femJobs.run(id,request,text=>{if(!event.sender.isDestroyed())event.sender.send('fem:progress',id,text);})};}catch(error){return {ok:false,message:error.message};}});
    ipcMain.on('fem:cancel',(event,id)=>{try{trusted(event);femJobs.cancel(id);}catch{}});

  }
  const runtime = path.join(resources, 'runtime/apps/web');
  fs.mkdirSync(path.join(profile, 'Projects'), { recursive: true });
  server = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], {
    cwd: profile, stdio: 'pipe', serviceName: `${productName} CAD server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1',
      LAYERLING_RUNTIME: runtime, LAYERLING_MCP_REMOTE: 'true', LAYERLING_MCP_TOKEN: token,
      LAYERLING_SHARED_PROJECTS_DIR: path.join(profile, 'Projects'), LAYERLING_DESKTOP_DATA: profile,
      LAYERLING_OPENSCAD_EXECUTABLE: ultimate ? path.join(resources, 'openscad/openscad.com') : process.env.LAYERLING_OPENSCAD_EXECUTABLE,
      OPENSCADPATH: ultimate ? path.join(resources, 'openscad/libraries') : process.env.OPENSCADPATH,
      NEXT_TELEMETRY_DISABLED: '1' },
  });
  server.stdout.on('data', data => log(data.toString().trim()));
  server.stderr.on('data', data => log(data.toString().trim()));
  let exited = false;
  server.once('exit', code => {
    exited = true;
    log(`Server exited: ${code}`);
    if (!quitting) { dialog.showErrorBox(`${productName} server stopped`, `The application server exited (${code}). See ${path.join(profile, 'desktop.log')}`); app.quit(); }
  });
  const deadline = Date.now() + 60000;
  while (true) {
    if (exited) throw new Error('Production server stopped before it was ready');
    try {
      const response = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500) });
      if (response.ok) break;
      log(`Readiness returned ${response.status}`);
    } catch { /* Server is still starting. */ }
    if (Date.now() > deadline) throw new Error('Production server did not become ready within 60 seconds');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  writeJson('connection.json', { url: baseUrl, token, pid: process.pid, version: app.getVersion() });
  const ses = session.fromPartition('persist:layerling');
  // Chromium's file picker still requires an explicit user selection before a file
  // handle exists. Preserve handle writes, local font selection and clipboard tools.
  const localPermissions = new Set(['fileSystem', 'clipboard-read', 'clipboard-sanitized-write', 'local-fonts', 'persistent-storage', 'fullscreen']);
  const isLocalPage = url => { try { return new URL(url).origin === baseUrl; } catch { return false; } };
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(localPermissions.has(permission) && isLocalPage(details.requestingUrl || contents.getURL()));
  });
  ses.setPermissionCheckHandler((contents, permission, origin, details) =>
    localPermissions.has(permission) && (isLocalPage(origin) || isLocalPage(details.requestingUrl || contents?.getURL())));
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(`${baseUrl}/`) || /^(data|blob):/.test(details.url);
    callback({ cancel: !allowed });
    if (!allowed) log(`Blocked external request: ${new URL(details.url).origin}`);
  });
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith(`${baseUrl}/`)) details.requestHeaders.Authorization = `Bearer ${token}`;
    callback({ requestHeaders: details.requestHeaders });
  });
  ses.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: `Save ${productName} file`, defaultPath: path.join(app.getPath('documents'), path.basename(item.getFilename())) });
    item.once('done', (_e, state) => log(`Download ${state}: ${item.getFilename()}`));
  });
  const bounds = readJson('window.json', { width: 1440, height: 960 });
  window = new BrowserWindow({ width: Math.max(900, Math.min(3840, Number(bounds.width) || 1440)),
    height: Math.max(650, Math.min(2160, Number(bounds.height) || 960)), show: false,
    title: productName, icon: path.join(resources, 'icon.png'),
    webPreferences: { partition: 'persist:layerling', nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, spellcheck: false, preload: path.join(__dirname, 'preload.cjs'), devTools: !app.isPackaged || process.env.LAYERLING_DESKTOP_TEST === '1' },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Internal guide/project windows retain the same hardened settings.
    if (url.startsWith(`${baseUrl}/`)) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:layerling', nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: false } } };
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${baseUrl}/`)) event.preventDefault(); });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => { if (!url.startsWith(`${baseUrl}/`)) event.preventDefault(); });
    if (contents !== window.webContents) contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  window.webContents.on('render-process-gone', (_event, details) => log(`Renderer gone: ${details.reason}`));
  window.on('page-title-updated', (event) => { event.preventDefault(); window?.setTitle(productName); });
  window.on('close', () => { writeJson('window.json', window.getNormalBounds()); });
  window.on('closed', () => { window = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open project or import', accelerator: 'Ctrl+O', click: () => {
        void window?.webContents.executeJavaScript(`document.querySelector('input[type=file][accept*=".lyl"]')?.click()`, true).catch(error => log(error.message));
      } },
      { label: 'Save project', accelerator: 'Ctrl+S', click: () => {
        // A fixed DOM event reaches the existing save handler, with native user
        // activation, without recursively triggering the menu accelerator.
        void window?.webContents.executeJavaScript(`document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'s',ctrlKey:true,bubbles:true}))`, true).catch(error => log(error.message));
      } }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'Local help', click: () => openLocalPage(branding.helpPath) },
      { label: `About ${productName}`, click: () => openLocalPage('/desktop/about.html') },
    ] },
  ]));
  await window.loadURL(baseUrl);
  window.show();
  log(`Ready ${app.getVersion()} at ${baseUrl}`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', cleanup);
  app.on('quit', cleanup);
  app.whenReady().then(start).catch(error => {
    // Closing a just-created window cancels loadURL. It is an ordinary shutdown,
    // not a startup failure that should display a blocking error dialog.
    if (quitting) return;
    log(error.stack || error); cleanup();
    dialog.showErrorBox(`${productName} could not start`, String(error.message || error)); app.quit();
  });
}
