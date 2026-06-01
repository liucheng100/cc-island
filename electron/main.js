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
const bus = require('./message-bus');

let islandWindow = null;
let sessionMonitor = null;
let localServer = null;
let wechatBridge = null;
let isIslandExpanded = false;
let isQuitting = false;

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

const PILL_W = 340, PILL_H = 52;
const PANEL_W = 420, PANEL_H = 640;

let isFullscreen = false;
function getFullscreenBounds() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.floor(sw * 0.8);
  const h = Math.floor(sh * 0.85);
  const x = Math.floor((sw - w) / 2);
  const y = Math.floor((sh - h) / 2);
  return { x, y, width: w, height: h };
}

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
  isFullscreen = false;
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
  ipcMain.handle('toggle-fullscreen', () => {
    if (!isIslandExpanded) expandIsland();
    isFullscreen = !isFullscreen;
    if (isFullscreen) {
      const b = getFullscreenBounds();
      islandWindow.setBounds(b, true);
    } else {
      const [x, y] = islandWindow.getPosition();
      islandWindow.setBounds({ x: Math.min(x, screen.getPrimaryDisplay().workAreaSize.width - PANEL_W), y, width: PANEL_W, height: PANEL_H }, true);
    }
    islandWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    return isFullscreen;
  });
  ipcMain.handle('get-fullscreen-state', () => isFullscreen);
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

  ipcMain.handle('has-custom-server', () => {
    if (!localServer) return false;
    return !!(localServer.publicBase);
  });

  // === Auth IPC ===
  ipcMain.handle('get-access-pin', () => localServer ? localServer.getAccessPin() : '');
  ipcMain.handle('get-device-mode', () => localServer ? localServer.getDeviceMode() : 1);
  ipcMain.handle('set-device-mode', (_, mode) => { if (localServer) localServer.setDeviceMode(mode); });
  ipcMain.handle('reset-first-device', () => { if (localServer) localServer.resetFirstDevice(); });
  ipcMain.handle('regenerate-pin', () => localServer ? localServer.regeneratePin() : '');
  ipcMain.handle('get-pending-devices', () => localServer ? localServer.getPendingDevices() : []);
  ipcMain.handle('get-approved-devices', () => localServer ? localServer.getApprovedDevices() : []);
  ipcMain.handle('approve-device', (_, deviceId) => localServer ? localServer.approveDevice(deviceId) : false);
  ipcMain.handle('reject-device', (_, deviceId) => { if (localServer) localServer.rejectDevice(deviceId); });
  // Command queue
  ipcMain.handle('get-queue', (_, sessionId) => sessionMonitor ? sessionMonitor.getQueue(sessionId) : []);
  ipcMain.handle('add-to-queue', (_, sessionId, cmd) => { if (sessionMonitor) sessionMonitor.addToQueue(sessionId, cmd); });
  ipcMain.handle('remove-from-queue', (_, sessionId, index) => { if (sessionMonitor) sessionMonitor.removeFromQueue(sessionId, index); });
  ipcMain.handle('clear-queue', (_, sessionId) => { if (sessionMonitor) sessionMonitor.clearQueue(sessionId); });
  ipcMain.handle('set-auto-play', (_, sessionId, enabled) => { if (sessionMonitor) sessionMonitor.setAutoPlay(sessionId, enabled); });
  ipcMain.handle('get-auto-play', (_, sessionId) => sessionMonitor ? sessionMonitor.getAutoPlay(sessionId) : false);
  ipcMain.handle('get-queue-mode', (_, sessionId) => sessionMonitor ? sessionMonitor.getQueueMode(sessionId) : false);
  ipcMain.handle('set-queue-mode', (_, sessionId, enabled) => { if (sessionMonitor) sessionMonitor.setQueueMode(sessionId, enabled); });
  ipcMain.handle('send-next-from-queue', (_, sessionId) => sessionMonitor ? sessionMonitor.sendNextFromQueue(sessionId) : false);
  ipcMain.handle('cancel-auto-send', (_, sessionId) => { if (sessionMonitor) sessionMonitor.cancelAutoSend(sessionId); });
  ipcMain.handle('reorder-queue', (_, sessionId, from, to) => { if (sessionMonitor) sessionMonitor.reorderQueue(sessionId, from, to); });

  ipcMain.handle('new-claude-session', async (_, cwd, options) => {
    const { spawn } = require('child_process');
    const os = require('os');
    const dir = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
    const args = ['claude'];
    if (options && options.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
    const child = spawn('cmd.exe', ['/c', 'start', '"Claude"', 'cmd.exe', '/K', ...args], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { success: true, cwd: dir };
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
  ipcMain.handle('start-tunnel', () => {
    if (!localServer) return false;
    // If custom server is configured, no SSH tunnel needed — already listening
    if (localServer.publicBase) {
      return { active: true, url: localServer.publicBase, service: 'custom' };
    }
    return localServer.startTunnel();
  });
  ipcMain.handle('stop-tunnel', () => localServer ? localServer.stopTunnel() : false);
  ipcMain.handle('get-server-info', () => {
    if (!localServer) return { port: 0, localIP: '127.0.0.1', publicURL: null };
    return { port: localServer.getPort(), localIP: localServer.getLocalIP(), publicURL: localServer.getPublicURL() };
  });

  ipcMain.handle('get-settings', () => {
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch (e) {}
    return { theme: 'dark', showTips: true, toggleShortcut: 'Ctrl+Space', soundNewTask: true, soundCompletion: true };
  });
  ipcMain.handle('save-settings', async (_, settings) => {
    try {
      const oldSettings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) : {};
      // Preserve auth fields from disk — renderer's settings may be stale
      settings.accessPin = oldSettings.accessPin;
      settings.deviceMode = oldSettings.deviceMode;
      settings.firstDeviceId = oldSettings.firstDeviceId;
      settings.firstDeviceName = oldSettings.firstDeviceName;
      settings.approvedDevices = oldSettings.approvedDevices;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      // Connection mode or server config changed
      const modeChanged = oldSettings.connectMode !== settings.connectMode;
      const serverChanged = oldSettings.customServer !== settings.customServer || oldSettings.publicBase !== settings.publicBase;
      if (modeChanged || serverChanged) {
        await applyConnectMode(settings);
        if (localServer.broadcastAuthCheck) localServer.broadcastAuthCheck();
      }
      // Notify all renderer windows of settings change
      if (islandWindow && !islandWindow.isDestroyed()) {
        islandWindow.webContents.send('settings-changed', settings);
      }
      return true;
    } catch (e) { return false; }
  });

  async function applyConnectMode(settings) {
    if (!localServer) return;
    const mode = settings.connectMode || '';
    // Stop any active SSH tunnel
    localServer.stopTunnel();

    if (mode === 'local') {
      let host = '0.0.0.0', port = 0;
      if (settings.customServer) {
        const m = settings.customServer.match(/^(.+):(\d+)$/);
        if (m) { host = m[1]; port = parseInt(m[2]); }
      }
      const publicBase = settings.publicBase ? settings.publicBase.replace(/\/+$/, '') : '';
      if (host !== localServer.bindHost || port !== localServer.bindPort) {
        localServer.stop();
        localServer = new LocalServer({ host, port, publicBase });
        localServer.setSettingsPath(settingsPath);
        localServer.initAuth();
        await localServer.start();
        localServer.setSessionDetailProvider((id) => sessionMonitor.getSessionDetail(id));
      localServer.getQueueForSession = (id) => sessionMonitor.getQueue(id);
      localServer.getAutoPlayForSession = (id) => sessionMonitor.getAutoPlay(id);
      localServer.getQueueModeForSession = (id) => sessionMonitor.getQueueMode(id);
        // Events now on shared bus — no per-instance rewire needed
        if (sessionMonitor) localServer.broadcastSessions(sessionMonitor.getSessions());
      }
    } else if (mode === 'ssh') {
      // Revert to default bind if needed
      if (localServer.bindHost !== '0.0.0.0' || localServer.bindPort !== 0) {
        localServer.stop();
        localServer = new LocalServer({ host: '0.0.0.0', port: 0, publicBase: '' });
        localServer.setSettingsPath(settingsPath);
        localServer.initAuth();
        await localServer.start();
        localServer.setSessionDetailProvider((id) => sessionMonitor.getSessionDetail(id));
      localServer.getQueueForSession = (id) => sessionMonitor.getQueue(id);
      localServer.getAutoPlayForSession = (id) => sessionMonitor.getAutoPlay(id);
      localServer.getQueueModeForSession = (id) => sessionMonitor.getQueueMode(id);
        // Events now on shared bus — no per-instance rewire needed
        if (sessionMonitor) localServer.broadcastSessions(sessionMonitor.getSessions());
      }
      localServer.startTunnel();
    } else {
      // LAN only — revert to default bind
      if (localServer.bindHost !== '0.0.0.0' || localServer.bindPort !== 0) {
        localServer.stop();
        localServer = new LocalServer({ host: '0.0.0.0', port: 0, publicBase: '' });
        localServer.setSettingsPath(settingsPath);
        localServer.initAuth();
        await localServer.start();
        localServer.setSessionDetailProvider((id) => sessionMonitor.getSessionDetail(id));
      localServer.getQueueForSession = (id) => sessionMonitor.getQueue(id);
      localServer.getAutoPlayForSession = (id) => sessionMonitor.getAutoPlay(id);
      localServer.getQueueModeForSession = (id) => sessionMonitor.getQueueMode(id);
        // Events now on shared bus — no per-instance rewire needed
        if (sessionMonitor) localServer.broadcastSessions(sessionMonitor.getSessions());
      }
    }
  }

  // All event listeners now registered once in app.whenReady via bus.on() — no rewire needed

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

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

app.whenReady().then(async () => {
  sessionMonitor = new SessionMonitor();
  sessionMonitor.start();
  // Read settings for custom server config
  let serverConfig = { host: '0.0.0.0', port: 0, publicBase: '' };
  try {
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (s.customServer) {
        const m = s.customServer.match(/^(.+):(\d+)$/);
        if (m) { serverConfig.host = m[1]; serverConfig.port = parseInt(m[2]); }
      }
      if (s.publicBase) serverConfig.publicBase = s.publicBase.replace(/\/+$/, '');
    }
  } catch (e) {}

  localServer = new LocalServer(serverConfig);
  localServer.setSettingsPath(settingsPath);
  localServer.initAuth();
  await localServer.start();
  localServer.setSessionDetailProvider((id) => sessionMonitor.getSessionDetail(id));
      localServer.getQueueForSession = (id) => sessionMonitor.getQueue(id);
      localServer.getAutoPlayForSession = (id) => sessionMonitor.getAutoPlay(id);
      localServer.getQueueModeForSession = (id) => sessionMonitor.getQueueMode(id);
  wechatBridge = new WechatBridge(localServer);
  wechatBridge.init();
  createIslandWindow();
  createTray(toggleIsland, islandWindow);
  setupIPC();

  // Send initial settings to renderer
  try {
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

  bus.on('sessions-updated', (sessions) => {
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('sessions:updated', sessions);
    if (localServer) localServer.broadcastSessions(sessions);
  });

  bus.on('session-messages-changed', (data) => {
    if (localServer) localServer.onMessagesChanged(data);
  });

  bus.on('queue-updated', (data) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('queue-updated', data);
    }
    if (localServer) localServer.onQueueUpdated(data);
  });

  bus.on('queue-auto-ready', (data) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('queue-auto-ready', data);
    }
    if (localServer) localServer.onQueueAutoReady(data);
  });

  wechatBridge.on('status-changed', (status) => {
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('wechat:status', status);
  });

  bus.on('session-message', (sessionId, message) => {
    if (sessionMonitor) sessionMonitor.sendToSession(sessionId, message);
  });

  bus.on('focus-session', (sessionId) => {
    if (sessionMonitor) sessionMonitor.focusSessionWindow(sessionId);
  });

  bus.on('new-claude-session', (cwd, options) => {
    const { spawn } = require('child_process');
    const dir = (cwd && fs.existsSync(cwd)) ? cwd : require('os').homedir();
    const args = ['claude'];
    if (options && options.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
    const child = spawn('cmd.exe', ['/c', 'start', '"Claude"', 'cmd.exe', '/K', ...args], {
      cwd: dir, detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
  });

  // Command queue
  bus.on('get-queue-resp', (socket, sessionId) => {
    if (sessionMonitor && socket) {
      socket.emit('queue-data', { sessionId, queue: sessionMonitor.getQueue(sessionId) });
    }
  });
  bus.on('add-to-queue', (sessionId, cmd) => {
    if (sessionMonitor) sessionMonitor.addToQueue(sessionId, cmd);
  });
  bus.on('remove-from-queue', (sessionId, index) => {
    if (sessionMonitor) sessionMonitor.removeFromQueue(sessionId, index);
  });
  bus.on('clear-queue', (sessionId) => {
    if (sessionMonitor) sessionMonitor.clearQueue(sessionId);
  });
  bus.on('reorder-queue', (sessionId, from, to) => {
    if (sessionMonitor) sessionMonitor.reorderQueue(sessionId, from, to);
  });
  bus.on('set-auto-play', (sessionId, enabled) => {
    if (sessionMonitor) sessionMonitor.setAutoPlay(sessionId, enabled);
  });
  bus.on('set-queue-mode', (sessionId, enabled) => {
    if (sessionMonitor) sessionMonitor.setQueueMode(sessionId, enabled);
  });
  bus.on('send-next-from-queue', (sessionId) => {
    if (sessionMonitor) sessionMonitor.sendNextFromQueue(sessionId);
  });

  bus.on('auth-state-changed', () => {
    // Kick all sockets that no longer pass auth
    if (localServer.broadcastAuthCheck) localServer.broadcastAuthCheck();
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('auth-state-changed');
      try {
        const s = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) : {};
        islandWindow.webContents.send('settings-changed', s);
      } catch (e) {}
    }
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

  // Apply saved connection mode on startup
  try {
    const s = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) : {};
    if (s.connectMode === 'local' && s.customServer) {
      const m = s.customServer.match(/^(.+):(\d+)$/);
      if (m) {
        localServer.publicBase = (s.publicBase || '').replace(/\/+$/, '');
        if (localServer.publicBase) localServer.publicURL = localServer.publicBase;
      }
    }
  } catch (e) {}

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
