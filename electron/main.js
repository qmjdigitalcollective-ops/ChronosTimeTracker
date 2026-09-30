const { app, BrowserWindow, ipcMain, desktopCapturer, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;

// Check GitHub Releases for a newer build, download it quietly in the
// background, then let the person decide when to install — never installs
// on its own. So a fix pushed here reaches everyone's desktop app without
// resending and reinstalling the .exe by hand, but nothing runs unattended.
// Only matters for an installed build, not `npm run electron` in development.
function startAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', (err) => console.error('Auto-update error:', err));
  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-ready', { version: info?.version });
  });
  const check = () => autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err));
  check();
  // Also check every couple hours in case the app is left open for days.
  setInterval(check, 2 * 60 * 60 * 1000);
}

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Auto-pause the timer after this many seconds with no mouse/keyboard activity
// anywhere on the computer (not just in this window) — a real "stepped away
// from the desk" signal, which a browser tab alone could never detect.
const IDLE_THRESHOLD_SECONDS = 240;
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

  // Load production build or dev server. The desktop build uses a relative
  // base href (--base-href ./) — the regular web build's absolute "/" base
  // href resolves against the filesystem root under file://, which is what
  // produced a blank window with every asset silently failing to load.
  const distIndex = path.join(__dirname, '..', 'dist', 'desktop', 'browser', 'index.html');
  const distIndexRoot = path.join(__dirname, '..', 'dist', 'desktop', 'index.html');

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
  startAutoUpdate();

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
