const { contextBridge, webUtils, ipcRenderer } = require('electron');
// A native File object can reveal only the path of the file the user selected.
// Geometry IPC accepts only bounded binary mesh jobs, never paths or commands.
contextBridge.exposeInMainWorld('layerlingFiles', {
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
contextBridge.exposeInMainWorld('layerlingGeometry',{
  run:(id,bytes)=>ipcRenderer.invoke('geometry:run',id,bytes),
  cancel:id=>ipcRenderer.send('geometry:cancel',id),
  onProgress:(id,callback)=>{const listener=(_event,job,text)=>{if(job===id)callback(text);};ipcRenderer.on('geometry:progress',listener);return ()=>ipcRenderer.removeListener('geometry:progress',listener);},
});
