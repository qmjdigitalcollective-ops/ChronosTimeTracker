const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  onIdleStarted: (callback) => ipcRenderer.on('idle-started', () => callback()),
  onIdleEnded: (callback) => ipcRenderer.on('idle-ended', (_event, data) => callback(data)),
});
