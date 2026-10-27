const { contextBridge, webUtils } = require('electron');
// A native File object can reveal only the path of the file the user selected.
// There is no renderer API for arbitrary filesystem access or process execution.
contextBridge.exposeInMainWorld('layerlingFiles', {
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
