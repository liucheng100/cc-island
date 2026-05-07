const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccIsland', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getSessionDetail: (sessionId) => ipcRenderer.invoke('get-session-detail', sessionId),
  toggleIsland: () => ipcRenderer.invoke('toggle-island'),
  getIslandState: () => ipcRenderer.invoke('get-island-state'),
  getWechatStatus: () => ipcRenderer.invoke('get-wechat-status'),
  getQRCodeUrl: (sessionId) => ipcRenderer.invoke('get-qrcode-url', sessionId),
  sendToSession: (sessionId, message) => ipcRenderer.invoke('send-to-session', sessionId, message),
  startWechatBridge: () => ipcRenderer.invoke('start-wechat-bridge'),
  stopWechatBridge: () => ipcRenderer.invoke('stop-wechat-bridge'),

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
