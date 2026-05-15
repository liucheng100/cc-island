const { app, BrowserWindow, ipcMain, screen, Notification, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// Safe console — silently drop all output in packaged builds (stdout is invalid)
console.log = () => {};
console.error = () => {};
console.warn = () => {};

app.setPath('userData', path.join(app.getPath('appData'), 'CC Island'));

const { createTray } = require('./tray');
const { SessionMonitor } = require('./session-monitor');
const { LocalServer } = require('./local-server');
const { WechatBridge } = require('./wechat-bridge');

let islandWindow = null;
let sessionMonitor = null;
let localServer = null;
let wechatBridge = null;
let isIslandExpanded = false;
let isQuitting = false;

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

const PILL_W = 340, PILL_H = 52;
const PANEL_W = 420, PANEL_H = 640;

function getUrl() {
  if (isDev) return 'http://localhost:5173/';
  return `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
}

function createIslandWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  islandWindow = new BrowserWindow({
    width: PILL_W, height: PILL_H,
    x: Math.max(0, screenWidth - PILL_W - 20), y: 20,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000', thickFrame: false, hasShadow: false,
    resizable: false, focusable: true, type: 'toolbar',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  islandWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  islandWindow.setVisibleOnAllWorkspaces(true);

  // Prevent Alt+F4 from closing the window (tray退出 sets isQuitting)
  islandWindow.on('close', (e) => {
    if (!isQuitting) e.preventDefault();
  });

  // Also block WM_SYSCOMMAND (Alt+Space) at the native window level
  if (process.platform === 'win32') {
    islandWindow.hookWindowMessage(0x0112, (wParam) => { // WM_SYSCOMMAND
      const cmd = wParam.readUInt32LE(0) & 0xFFF0;
      if (cmd === 0xF093 || cmd === 0xF100) { // SC_KEYMENU, SC_SIZE
        return true; // block
      }
    });
  }

  // Block browser-level shortcuts that interfere with our app
  islandWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    // Ctrl+W closes window, Ctrl+Q quits, Ctrl+N/T new tab
    if (input.control && ['w','q','n','t'].includes(key)) { event.preventDefault(); return; }
    // Ctrl+Shift+N / Ctrl+Shift+T
    if (input.control && input.shift && ['n','t'].includes(key)) { event.preventDefault(); return; }
  });

  islandWindow.loadURL(getUrl());

  return islandWindow;
}

function expandIsland() {
  if (isIslandExpanded) return;
  isIslandExpanded = true;
  // Resize window first, keep top-left corner, then tell renderer to animate
  const [x, y] = islandWindow.getPosition();
  islandWindow.setBounds({ x, y, width: PANEL_W, height: PANEL_H }, false);
  islandWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  islandWindow.webContents.send('island:expand');
}

function collapseIsland() {
  if (!isIslandExpanded) return;
  isIslandExpanded = false;
  // Tell renderer to animate collapse; it will call back when done
  islandWindow.webContents.send('island:collapse');
}

function toggleIsland() {
  isIslandExpanded ? collapseIsland() : expandIsland();
}

function setupIPC() {
  ipcMain.handle('get-sessions', () => sessionMonitor ? sessionMonitor.getSessions() : []);
  ipcMain.handle('get-session-detail', (_, id) => sessionMonitor ? sessionMonitor.getSessionDetail(id) : null);
  ipcMain.handle('toggle-island', () => { toggleIsland(); return isIslandExpanded; });
  ipcMain.handle('get-island-state', () => isIslandExpanded);
  ipcMain.handle('collapse-animation-done', () => {
    if (isIslandExpanded) return; // user re-expanded during animation, skip collapse
    const [x, y] = islandWindow.getPosition();
    islandWindow.setOpacity(0);
    islandWindow.setBounds({ x, y, width: PILL_W, height: PILL_H }, false);
    islandWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    setImmediate(() => islandWindow.setOpacity(1));
  });
  ipcMain.handle('get-wechat-status', () => wechatBridge ? wechatBridge.getStatus() : { connected: false });
  ipcMain.handle('get-qrcode-url', (_, id) => {
    if (!localServer) return null;
    const pub = localServer.getPublicURL();
    if (pub) return `${pub}/session/${id}`;
    return `http://${localServer.getLocalIP()}:${localServer.getPort()}/session/${id}`;
  });
  ipcMain.handle('send-to-session', async (_, id, msg) => {
    if (!sessionMonitor) return { success: false, error: 'Session monitor not available' };
    return sessionMonitor.sendToSession(id, msg);
  });
  ipcMain.handle('focus-session-window', async (_, id) => {
    if (!sessionMonitor) return false;
    return sessionMonitor.focusSessionWindow(id);
  });
  ipcMain.handle('get-tunnel-status', () => localServer ? localServer.getTunnelStatus() : null);
  ipcMain.handle('start-tunnel', () => localServer ? localServer.startTunnel() : false);
  ipcMain.handle('stop-tunnel', () => localServer ? localServer.stopTunnel() : false);
  ipcMain.handle('get-server-info', () => {
    if (!localServer) return { port: 0, localIP: '127.0.0.1', publicURL: null };
    return { port: localServer.getPort(), localIP: localServer.getLocalIP(), publicURL: localServer.getPublicURL() };
  });

  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  ipcMain.handle('get-settings', () => {
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch (e) {}
    return { theme: 'dark', showTips: true, toggleShortcut: 'Ctrl+Space', soundNewTask: true, soundCompletion: true };
  });
  ipcMain.handle('save-settings', (_, settings) => {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      return true;
    } catch (e) { return false; }
  });

  // Window drag — use known size to avoid drift/resize from getSize() rounding
  ipcMain.on('move-window', (event, dx, dy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const [x, y] = win.getPosition();
      const w = isIslandExpanded ? PANEL_W : PILL_W;
      const h = isIslandExpanded ? PANEL_H : PILL_H;
      win.setBounds({ x: x + dx, y: y + dy, width: w, height: h }, false);
    }
  });
}

app.whenReady().then(async () => {
  sessionMonitor = new SessionMonitor();
  sessionMonitor.start();
  localServer = new LocalServer();
  await localServer.start();
  wechatBridge = new WechatBridge(localServer);
  wechatBridge.init();
  createIslandWindow();
  createTray(toggleIsland, islandWindow);
  setupIPC();

  // Send initial settings to renderer
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) : { theme: 'dark', showTips: true, toggleShortcut: 'Ctrl+Space', soundNewTask: true, soundCompletion: true };
    islandWindow.webContents.send('settings:loaded', settings);
  } catch (e) {}

  // Register global shortcut for toggle island
  const registerGlobalToggle = (combo) => {
    globalShortcut.unregisterAll();
    if (combo) {
      try {
        const ok = globalShortcut.register(combo, () => {
          toggleIsland();
          if (islandWindow && !islandWindow.isDestroyed()) islandWindow.focus();
        });
        if (!ok) console.log('[GlobalShortcut] Failed to register:', combo);
      } catch (e) { console.log('[GlobalShortcut] Error:', e.message); }
    }
  };
  // Load saved shortcut or default
  try {
    const sp = path.join(app.getPath('userData'), 'settings.json');
    const s = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf-8')) : {};
    registerGlobalToggle(s.toggleShortcut || 'Ctrl+Space');
  } catch (e) { registerGlobalToggle('Ctrl+Space'); }

  // IPC to update global shortcut from settings
  ipcMain.handle('update-global-shortcut', (_, combo) => {
    registerGlobalToggle(combo);
    return true;
  });

  try { new Notification({ title: 'CC Island', body: '灵动岛已启动', silent: true }).show(); } catch (e) {}

  sessionMonitor.on('sessions-updated', (sessions) => {
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('sessions:updated', sessions);
    if (localServer) localServer.broadcastSessions(sessions);
  });

  wechatBridge.on('status-changed', (status) => {
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('wechat:status', status);
  });

  localServer.on('session-message', (sessionId, message) => {
    if (sessionMonitor) sessionMonitor.sendToSession(sessionId, message);
  });

  wechatBridge.on('wechat-message', (data) => {
    if (!sessionMonitor) return;
    const { sessionId, content } = data;
    if (sessionId) {
      sessionMonitor.sendToSession(sessionId, content);
    } else {
      const sessions = sessionMonitor.getSessions();
      const active = sessions.find((s) => s.status === 'working' || s.status === 'thinking' || s.status === 'answering');
      if (active) sessionMonitor.sendToSession(active.id, content);
    }
  });

  console.log('CC Island started');
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (sessionMonitor) sessionMonitor.stop();
  if (localServer) localServer.stop();
  if (wechatBridge) wechatBridge.stop();
});
