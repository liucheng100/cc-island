const { app, BrowserWindow, Tray, ipcMain, screen, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { createTray } = require('./tray');
const { SessionMonitor } = require('./session-monitor');
const { LocalServer } = require('./local-server');
const { WechatBridge } = require('./wechat-bridge');

let islandWindow = null;
let sessionListWindow = null;
let sessionMonitor = null;
let localServer = null;
let wechatBridge = null;
let isIslandExpanded = false;
let collapseTimeout = null;

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

// Log to file for debugging — use project dir so it's easy to find
const logFile = path.join(__dirname, '..', '..', 'cc-island-debug.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch (e) { /* ignore */ }
}

function getUrl(hash) {
  if (isDev) return `http://localhost:5173/#/${hash}`;
  return `file://${path.join(__dirname, '..', 'dist', 'index.html')}#/${hash}`;
}

function createIslandWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  islandWindow = new BrowserWindow({
    width: 300,
    height: 56,
    x: Math.max(0, screenWidth - 320),
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    thickFrame: false,
    focusable: true,
    type: 'toolbar',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  islandWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  islandWindow.setVisibleOnAllWorkspaces(true);

  const url = getUrl('island');
  log(`Loading island: ${url}`);
  islandWindow.loadURL(url);

  islandWindow.webContents.on('did-finish-load', () => {
    log('Island window loaded successfully');
  });
  islandWindow.webContents.on('did-fail-load', (_, code, desc) => {
    log(`Island load FAILED: ${code} ${desc}`);
  });

  islandWindow.on('ready-to-show', () => {
    log('Island window ready to show');
  });

  return islandWindow;
}

function createSessionListWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  sessionListWindow = new BrowserWindow({
    width: 420,
    height: 640,
    x: screenWidth - 440,
    y: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    thickFrame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  sessionListWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  sessionListWindow.loadURL(getUrl('sessions'));

  if (isDev) {
    sessionListWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return sessionListWindow;
}

function expandIsland() {
  if (isIslandExpanded) return;
  isIslandExpanded = true;

  // Clear any pending collapse
  if (collapseTimeout) {
    clearTimeout(collapseTimeout);
    collapseTimeout = null;
  }

  islandWindow.webContents.send('island:expand');

  if (!sessionListWindow || sessionListWindow.isDestroyed()) {
    createSessionListWindow();
  }
  sessionListWindow.show();
  sessionListWindow.focus();
}

function collapseIsland() {
  if (!isIslandExpanded) return;
  isIslandExpanded = false;

  islandWindow.webContents.send('island:collapse');

  if (sessionListWindow && !sessionListWindow.isDestroyed()) {
    sessionListWindow.hide();
  }
}

function scheduleCollapse() {
  // Delayed collapse — allows clicking between windows without triggering immediate close
  if (collapseTimeout) clearTimeout(collapseTimeout);
  collapseTimeout = setTimeout(() => {
    // Only collapse if both windows lost focus
    const islandFocused = islandWindow && !islandWindow.isDestroyed() && islandWindow.isFocused();
    const listFocused = sessionListWindow && !sessionListWindow.isDestroyed() && sessionListWindow.isFocused();
    if (!islandFocused && !listFocused) {
      collapseIsland();
    }
  }, 300);
}

function toggleIsland() {
  if (isIslandExpanded) {
    collapseIsland();
  } else {
    expandIsland();
  }
}

function setupIPC() {
  ipcMain.handle('get-sessions', async () => {
    return sessionMonitor ? sessionMonitor.getSessions() : [];
  });

  ipcMain.handle('get-session-detail', async (_, sessionId) => {
    return sessionMonitor ? sessionMonitor.getSessionDetail(sessionId) : null;
  });

  ipcMain.handle('toggle-island', async () => {
    toggleIsland();
    return isIslandExpanded;
  });

  ipcMain.handle('get-island-state', async () => {
    return isIslandExpanded;
  });

  ipcMain.handle('get-wechat-status', async () => {
    return wechatBridge ? wechatBridge.getStatus() : { connected: false };
  });

  ipcMain.handle('get-qrcode-url', async (_, sessionId) => {
    if (!localServer) return null;
    const publicUrl = localServer.getPublicURL();
    if (publicUrl) {
      return `${publicUrl}/session/${sessionId}`;
    }
    const port = localServer.getPort();
    const ip = localServer.getLocalIP();
    return `http://${ip}:${port}/session/${sessionId}`;
  });

  ipcMain.handle('send-to-session', async (_, sessionId, message) => {
    return sessionMonitor ? sessionMonitor.sendToSession(sessionId, message) : false;
  });

  ipcMain.handle('start-wechat-bridge', async () => {
    if (wechatBridge) return wechatBridge.start();
    return false;
  });

  ipcMain.handle('stop-wechat-bridge', async () => {
    if (wechatBridge) return wechatBridge.stop();
    return false;
  });

  ipcMain.handle('get-tunnel-status', async () => {
    return localServer ? localServer.getTunnelStatus() : null;
  });

  ipcMain.handle('start-tunnel', async () => {
    return localServer ? localServer.startTunnel() : false;
  });

  ipcMain.handle('stop-tunnel', async () => {
    return localServer ? localServer.stopTunnel() : false;
  });
}

app.whenReady().then(async () => {
  log('CC Island starting...');

  sessionMonitor = new SessionMonitor();
  sessionMonitor.start();

  localServer = new LocalServer();
  await localServer.start();

  wechatBridge = new WechatBridge(localServer);
  wechatBridge.init();

  createTray(toggleIsland);
  createIslandWindow();

  setupIPC();

  // Startup notification
  try {
    new Notification({
      title: 'CC Island',
      body: '灵动岛已启动，查看屏幕右上角',
      silent: true,
    }).show();
  } catch (e) {}

  // Forward session updates to renderer
  sessionMonitor.on('sessions-updated', (sessions) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('sessions:updated', sessions);
    }
    if (sessionListWindow && !sessionListWindow.isDestroyed() && isIslandExpanded) {
      sessionListWindow.webContents.send('sessions:updated', sessions);
    }
    if (localServer) {
      localServer.broadcastSessions(sessions);
    }
  });

  // Forward WeChat status
  wechatBridge.on('status-changed', (status) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('wechat:status', status);
    }
    if (sessionListWindow && !sessionListWindow.isDestroyed()) {
      sessionListWindow.webContents.send('wechat:status', status);
    }
  });

  log(`CC Island started, island at (${islandWindow.getPosition()}), server: ${localServer.getLocalIP()}:${localServer.getPort()}`);
  console.log('CC Island started successfully');
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  if (sessionMonitor) sessionMonitor.stop();
  if (localServer) localServer.stop();
  if (wechatBridge) wechatBridge.stop();
});
