const { app, BrowserWindow, ipcMain, screen, Notification } = require('electron');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'CC Island'));

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

function getUrl(hash) {
  if (isDev) return `http://localhost:5173/#/${hash}`;
  return `file://${path.join(__dirname, '..', 'dist', 'index.html')}#/${hash}`;
}

// Shared BrowserWindow config helper
function makeWin(opts) {
  return new BrowserWindow({
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000', thickFrame: false, hasShadow: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    ...opts,
  });
}

function createIslandWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  islandWindow = makeWin({
    width: 300, height: 56,
    x: Math.max(0, screenWidth - 320), y: 20,
    resizable: false, focusable: true, type: 'toolbar',
  });
  islandWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  islandWindow.setVisibleOnAllWorkspaces(true);
  islandWindow.loadURL(getUrl('island'));
  islandWindow.setContentProtection(true);
  return islandWindow;
}

function createSessionListWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  sessionListWindow = makeWin({
    width: 420, height: 640,
    minWidth: 420, maxWidth: 420,
    minHeight: 640, maxHeight: 640,
    x: screenWidth - 440, y: 80,
    resizable: false, hasShadow: true,
  });
  sessionListWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  sessionListWindow.loadURL(getUrl('sessions'));
  return sessionListWindow;
}

function expandIsland() {
  if (isIslandExpanded) return;
  isIslandExpanded = true;
  if (collapseTimeout) { clearTimeout(collapseTimeout); collapseTimeout = null; }
  islandWindow.webContents.send('island:expand');
  if (!sessionListWindow || sessionListWindow.isDestroyed()) createSessionListWindow();
  sessionListWindow.show();
  sessionListWindow.focus();
}

function collapseIsland() {
  if (!isIslandExpanded) return;
  isIslandExpanded = false;
  islandWindow.webContents.send('island:collapse');
  if (sessionListWindow && !sessionListWindow.isDestroyed()) sessionListWindow.hide();
}

function toggleIsland() {
  isIslandExpanded ? collapseIsland() : expandIsland();
}

function setupIPC() {
  ipcMain.handle('get-sessions', () => sessionMonitor ? sessionMonitor.getSessions() : []);
  ipcMain.handle('get-session-detail', (_, id) => sessionMonitor ? sessionMonitor.getSessionDetail(id) : null);
  ipcMain.handle('toggle-island', () => { toggleIsland(); return isIslandExpanded; });
  ipcMain.handle('get-island-state', () => isIslandExpanded);
  ipcMain.handle('get-wechat-status', () => wechatBridge ? wechatBridge.getStatus() : { connected: false });
  ipcMain.handle('get-qrcode-url', (_, id) => {
    if (!localServer) return null;
    const pub = localServer.getPublicURL();
    if (pub) return `${pub}/session/${id}`;
    return `http://${localServer.getLocalIP()}:${localServer.getPort()}/session/${id}`;
  });
  ipcMain.handle('send-to-session', (_, id, msg) => sessionMonitor ? sessionMonitor.sendToSession(id, msg) : false);
  ipcMain.handle('start-wechat-bridge', () => wechatBridge ? wechatBridge.start() : false);
  ipcMain.handle('stop-wechat-bridge', () => wechatBridge ? wechatBridge.stop() : false);
  ipcMain.handle('get-tunnel-status', () => localServer ? localServer.getTunnelStatus() : null);
  ipcMain.handle('start-tunnel', () => localServer ? localServer.startTunnel() : false);
  ipcMain.handle('stop-tunnel', () => localServer ? localServer.stopTunnel() : false);
  ipcMain.handle('focus-session-window', (_, id) => sessionMonitor ? sessionMonitor.focusSessionWindow(id) : false);

  // Pure JS window drag — keep known fixed window sizes stable
  ipcMain.on('move-window', (event, dx, dy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const [x, y] = win.getPosition();
      const fixedSize = win === islandWindow
        ? { width: 300, height: 56 }
        : win === sessionListWindow
          ? { width: 420, height: 640 }
          : (() => {
              const [width, height] = win.getSize();
              return { width, height };
            })();
      win.setBounds({ x: x + dx, y: y + dy, ...fixedSize }, false);
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
  createTray(toggleIsland);
  createIslandWindow();
  setupIPC();

  try { new Notification({ title: 'CC Island', body: '灵动岛已启动，查看屏幕右上角', silent: true }).show(); } catch (e) {}

  sessionMonitor.on('sessions-updated', (sessions) => {
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('sessions:updated', sessions);
    if (sessionListWindow && !sessionListWindow.isDestroyed() && isIslandExpanded) sessionListWindow.webContents.send('sessions:updated', sessions);
    if (localServer) localServer.broadcastSessions(sessions);
  });

  wechatBridge.on('status-changed', (status) => {
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('wechat:status', status);
    if (sessionListWindow && !sessionListWindow.isDestroyed()) sessionListWindow.webContents.send('wechat:status', status);
  });

  // Public network message relay: API/WeChat → Claude session
  localServer.on('session-message', (sessionId, message) => {
    if (sessionMonitor) sessionMonitor.sendToSession(sessionId, message);
  });

  // WeChat message relay: WeChat → Claude session
  wechatBridge.on('wechat-message', (data) => {
    if (!sessionMonitor) return;
    const { sender, content, sessionId } = data;
    if (sessionId) {
      sessionMonitor.sendToSession(sessionId, content);
    } else {
      // No linked session — forward to first active session
      const sessions = sessionMonitor.getSessions();
      const active = sessions.find((s) => s.status === 'working' || s.status === 'thinking');
      if (active) {
        sessionMonitor.sendToSession(active.id, content);
      }
    }
  });

  console.log('CC Island started');
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  if (sessionMonitor) sessionMonitor.stop();
  if (localServer) localServer.stop();
  if (wechatBridge) wechatBridge.stop();
});
