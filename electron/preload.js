const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccIsland', {
  // Session
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getSessionDetail: (sessionId) => ipcRenderer.invoke('get-session-detail', sessionId),
  sendToSession: (sessionId, message) => ipcRenderer.invoke('send-to-session', sessionId, message),

  // Island
  toggleIsland: () => ipcRenderer.invoke('toggle-island'),
  getIslandState: () => ipcRenderer.invoke('get-island-state'),

  // WeChat
  getWechatStatus: () => ipcRenderer.invoke('get-wechat-status'),
  startWechatBridge: () => ipcRenderer.invoke('start-wechat-bridge'),
  stopWechatBridge: () => ipcRenderer.invoke('stop-wechat-bridge'),

  // QR / Tunnel
  getQRCodeUrl: (sessionId) => ipcRenderer.invoke('get-qrcode-url', sessionId),
  getTunnelStatus: () => ipcRenderer.invoke('get-tunnel-status'),
  startTunnel: () => ipcRenderer.invoke('start-tunnel'),
  stopTunnel: () => ipcRenderer.invoke('stop-tunnel'),

  // Events
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
});
