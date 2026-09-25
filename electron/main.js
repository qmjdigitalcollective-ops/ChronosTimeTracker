const { app, BrowserWindow, ipcMain, desktopCapturer, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

// Auto-pause the timer after this many seconds with no mouse/keyboard activity
// anywhere on the computer (not just in this window) — a real "stepped away
// from the desk" signal, which a browser tab alone could never detect.
const IDLE_THRESHOLD_SECONDS = 120;
let wasIdle = false;

function startIdleWatcher() {
  setInterval(() => {
    if (!mainWindow) return;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const isIdleNow = idleSeconds >= IDLE_THRESHOLD_SECONDS;
    if (isIdleNow && !wasIdle) {
      wasIdle = true;
      mainWindow.webContents.send('idle-started');
    } else if (!isIdleNow && wasIdle) {
      wasIdle = false;
      mainWindow.webContents.send('idle-ended', { idleSeconds });
    }
  }, 5000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Auravia Collective Time Tracker',
    backgroundColor: '#fefaf1',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load production build or dev server
  const distIndex = path.join(__dirname, '..', 'dist', 'time-tracker', 'browser', 'index.html');
  const distIndexRoot = path.join(__dirname, '..', 'dist', 'time-tracker', 'index.html');

  if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else if (fs.existsSync(distIndexRoot)) {
    mainWindow.loadFile(distIndexRoot);
  } else {
    mainWindow.loadURL('http://localhost:4200');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Silent background desktop screen capture handler
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });

    if (sources && sources.length > 0) {
      // Grab the primary monitor screen
      const primarySource = sources[0];
      const jpegBuffer = primarySource.thumbnail.toJPEG(75);
      return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    }
  } catch (err) {
    console.error('Silent screen capture failed:', err);
  }
  return null;
});

app.whenReady().then(() => {
  createWindow();
  startIdleWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
