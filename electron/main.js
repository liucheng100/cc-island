const { app, BrowserWindow, Tray, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
const path = require('path');
const { createTray, getTray } = require('./tray');
const { SessionMonitor } = require('./session-monitor');
const { LocalServer } = require('./local-server');
const { WechatBridge } = require('./wechat-bridge');

let islandWindow = null;
let sessionListWindow = null;
let sessionMonitor = null;
let localServer = null;
let wechatBridge = null;
let isIslandExpanded = false;

function createIslandWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  islandWindow = new BrowserWindow({
    width: 280,
    height: 52,
    x: screenWidth - 300,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
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

  const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
  const url = isDev
    ? 'http://localhost:5173/#/island'
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}#/island`;

  islandWindow.loadURL(url);
  islandWindow.setContentProtection(true);

  islandWindow.on('blur', () => {
    if (isIslandExpanded) {
      collapseIsland();
    }
  });

  return islandWindow;
}

function createSessionListWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

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

  const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
  const url = isDev
    ? 'http://localhost:5173/#/sessions'
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}#/sessions`;

  sessionListWindow.loadURL(url);

  sessionListWindow.on('blur', () => {
    collapseIsland();
  });

  return sessionListWindow;
}

function expandIsland() {
  if (isIslandExpanded) return;
  isIslandExpanded = true;

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
    const port = localServer.getPort();
    const ip = localServer.getLocalIP();
    return `http://${ip}:${port}/session/${sessionId}`;
  });

  ipcMain.handle('send-to-session', async (_, sessionId, message) => {
    return sessionMonitor ? sessionMonitor.sendToSession(sessionId, message) : false;
  });

  ipcMain.handle('start-wechat-bridge', async () => {
    if (wechatBridge) {
      return wechatBridge.start();
    }
    return false;
  });

  ipcMain.handle('stop-wechat-bridge', async () => {
    if (wechatBridge) {
      return wechatBridge.stop();
    }
    return false;
  });
}

app.whenReady().then(async () => {
  // Initialize session monitor
  sessionMonitor = new SessionMonitor();
  sessionMonitor.start();

  // Initialize local server for phone access
  localServer = new LocalServer();
  await localServer.start();

  // Initialize WeChat bridge
  wechatBridge = new WechatBridge(localServer);
  wechatBridge.init();

  // Create tray
  createTray(toggleIsland);

  // Create floating island
  createIslandWindow();

  // Setup IPC handlers
  setupIPC();

  // Forward session updates to renderer
  sessionMonitor.on('sessions-updated', (sessions) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('sessions:updated', sessions);
    }
    if (sessionListWindow && !sessionListWindow.isDestroyed() && isIslandExpanded) {
      sessionListWindow.webContents.send('sessions:updated', sessions);
    }
    // Also forward to local server for phone clients
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

  console.log('CC Island started successfully');
});

app.on('window-all-closed', () => {
  // Don't quit on window close - keep running in tray
});

app.on('before-quit', () => {
  if (sessionMonitor) sessionMonitor.stop();
  if (localServer) localServer.stop();
  if (wechatBridge) wechatBridge.stop();
});
