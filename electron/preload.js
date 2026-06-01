const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccIsland', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getSessionDetail: (sessionId) => ipcRenderer.invoke('get-session-detail', sessionId),
  sendToSession: (sessionId, message) => ipcRenderer.invoke('send-to-session', sessionId, message),
  focusSessionWindow: (sessionId) => ipcRenderer.invoke('focus-session-window', sessionId),

  toggleIsland: () => ipcRenderer.invoke('toggle-island'),
  getIslandState: () => ipcRenderer.invoke('get-island-state'),
  collapseAnimationDone: () => ipcRenderer.invoke('collapse-animation-done'),

  getWechatStatus: () => ipcRenderer.invoke('get-wechat-status'),
  startWechatBridge: () => ipcRenderer.invoke('start-wechat-bridge'),
  stopWechatBridge: () => ipcRenderer.invoke('stop-wechat-bridge'),

  getQRCodeUrl: (sessionId) => ipcRenderer.invoke('get-qrcode-url', sessionId),
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  getTunnelStatus: () => ipcRenderer.invoke('get-tunnel-status'),
  startTunnel: () => ipcRenderer.invoke('start-tunnel'),
  stopTunnel: () => ipcRenderer.invoke('stop-tunnel'),
  hasCustomServer: () => ipcRenderer.invoke('has-custom-server'),
  newClaudeSession: (cwd) => ipcRenderer.invoke('new-claude-session', cwd),
  // Auth
  getAccessPin: () => ipcRenderer.invoke('get-access-pin'),
  getDeviceMode: () => ipcRenderer.invoke('get-device-mode'),
  setDeviceMode: (mode) => ipcRenderer.invoke('set-device-mode', mode),
  resetFirstDevice: () => ipcRenderer.invoke('reset-first-device'),
  regeneratePin: () => ipcRenderer.invoke('regenerate-pin'),
  getPendingDevices: () => ipcRenderer.invoke('get-pending-devices'),
  getApprovedDevices: () => ipcRenderer.invoke('get-approved-devices'),
  approveDevice: (deviceId) => ipcRenderer.invoke('approve-device', deviceId),
  rejectDevice: (deviceId) => ipcRenderer.invoke('reject-device', deviceId),
  // Command queue
  getQueue: (sessionId) => ipcRenderer.invoke('get-queue', sessionId),
  addToQueue: (sessionId, cmd) => ipcRenderer.invoke('add-to-queue', sessionId, cmd),
  removeFromQueue: (sessionId, index) => ipcRenderer.invoke('remove-from-queue', sessionId, index),
  clearQueue: (sessionId) => ipcRenderer.invoke('clear-queue', sessionId),
  setAutoPlay: (sessionId, enabled) => ipcRenderer.invoke('set-auto-play', sessionId, enabled),
  getAutoPlay: (sessionId) => ipcRenderer.invoke('get-auto-play', sessionId),
  getQueueMode: (sessionId) => ipcRenderer.invoke('get-queue-mode', sessionId),
  setQueueMode: (sessionId, enabled) => ipcRenderer.invoke('set-queue-mode', sessionId, enabled),
  sendNextFromQueue: (sessionId) => ipcRenderer.invoke('send-next-from-queue', sessionId),
  reorderQueue: (sessionId, from, to) => ipcRenderer.invoke('reorder-queue', sessionId, from, to),
  onQueueUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('queue-updated', handler);
    return () => ipcRenderer.removeListener('queue-updated', handler);
  },
  onQueueAutoReady: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('queue-auto-ready', handler);
    return () => ipcRenderer.removeListener('queue-auto-ready', handler);
  },

  // Pure JS window drag — no -webkit-app-region needed
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),

  onSessionsUpdated: (callback) => {
    ipcRenderer.on('sessions:updated', (_, sessions) => callback(sessions));
    return () => ipcRenderer.removeAllListeners('sessions:updated');
  },
  onWechatStatus: (callback) => {
    ipcRenderer.on('wechat:status', (_, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('wechat:status');
  },
  onIslandExpand: (callback) => {
    ipcRenderer.on('island:expand', () => callback());
    return () => ipcRenderer.removeAllListeners('island:expand');
  },
  onIslandCollapse: (callback) => {
    ipcRenderer.on('island:collapse', () => callback());
    return () => ipcRenderer.removeAllListeners('island:collapse');
  },

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  updateGlobalShortcut: (combo) => ipcRenderer.invoke('update-global-shortcut', combo),

  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open:settings', handler);
    return () => ipcRenderer.removeListener('open:settings', handler);
  },
  onSettingsLoaded: (callback) => {
    const handler = (_, settings) => callback(settings);
    ipcRenderer.on('settings:loaded', handler);
    return () => ipcRenderer.removeListener('settings:loaded', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_, settings) => callback(settings);
    ipcRenderer.on('settings-changed', handler);
    return () => ipcRenderer.removeListener('settings-changed', handler);
  },
  onAuthStateChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('auth-state-changed', handler);
    return () => ipcRenderer.removeListener('auth-state-changed', handler);
  },
});
