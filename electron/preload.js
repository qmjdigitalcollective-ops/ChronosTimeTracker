const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
});
