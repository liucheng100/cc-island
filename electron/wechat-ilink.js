/**
 * WeChat iLink Bot API integration
 * Official Tencent WeChat personal bot API (released 2026-03)
 * Docs: https://ilinkai.weixin.qq.com
 *
 * Flow:
 * 1. Generate QR code → user scans with WeChat
 * 2. iLink establishes WebSocket for message relay
 * 3. Incoming WeChat messages → forward to Claude session
 * 4. Claude response → send back via iLink to WeChat
 */
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const https = require('https');
const crypto = require('crypto');

class WechatILink extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.qrData = null;
    this.userInfo = null;
    this.sessionMap = {}; // wechat sender → sessionId mapping
    this.pendingMessages = [];
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  /**
   * Step 1: Get QR code for WeChat scan login
   */
  async getLoginQR() {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'ilinkai.weixin.qq.com',
        path: '/api/v1/bot/qrcode',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.errcode === 0) {
              this.qrData = json;
              resolve({
                qrcode_url: json.qrcode_url || json.qrcode_img,
                uuid: json.uuid,
                expire_seconds: json.expire_seconds || 300,
              });
            } else {
              // Fallback: use polling instead of WebSocket
              this.startPolling();
              resolve(null);
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', (e) => {
        // iLink may not be accessible — fall back to polling
        this.startPolling();
        resolve(null);
      });
      req.write(JSON.stringify({}));
      req.end();
    });
  }

  /**
   * Step 2: Connect WebSocket for real-time messages
   */
  connectWebSocket(token) {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const wsUrl = `wss://ilinkai.weixin.qq.com/ws/bot?token=${token}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.connected = true;
      this.startPing();
      this.emit('status', { connected: true, method: 'ilink' });
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (e) { /* ignore */ }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.stopPing();
      this.emit('status', { connected: false, method: 'ilink' });
    });

    this.ws.on('error', (err) => {
      console.error('[iLink] WS error:', err.message);
    });
  }

  /**
   * Handle incoming WeChat message
   */
  handleMessage(msg) {
    if (msg.type === 'text' && msg.content) {
      const senderId = msg.from_user || msg.sender;
      const content = msg.content;

      // Auto-map sender to first available session if not mapped
      let sessionId = this.sessionMap[senderId];
      if (!sessionId) {
        // Map to first working session
        this.emit('wechat-message', { sender: senderId, content, sessionId: null });
        return;
      }

      this.emit('wechat-message', { sender: senderId, content, sessionId });
    }
  }

  /**
   * Send message to WeChat user via iLink
   */
  async sendMessage(toUser, content) {
    if (!this.connected) return false;

    return new Promise((resolve) => {
      const body = JSON.stringify({
        to_user: toUser,
        msgtype: 'text',
        text: { content },
      });

      const req = https.request({
        hostname: 'ilinkai.weixin.qq.com',
        path: '/api/v1/bot/send',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.write(body);
      req.end();
    });
  }

  /**
   * Fallback: HTTP polling (when WebSocket not available)
   */
  startPolling() {
    console.log('[iLink] Starting polling mode...');
    this.pollTimer = setInterval(async () => {
      try {
        // Try to get pending messages
        const msgs = await this.pollMessages();
        for (const msg of msgs) {
          this.handleMessage(msg);
        }
      } catch (e) { /* ignore */ }
    }, 3000);
  }

  async pollMessages() {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'ilinkai.weixin.qq.com',
        path: '/api/v1/bot/messages',
        method: 'GET',
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.messages || []);
          } catch (e) { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.end();
    });
  }

  linkSession(wechatUserId, sessionId) {
    this.sessionMap[wechatUserId] = sessionId;
  }

  startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  stop() {
    this.stopPing();
    if (this.pollTimer) { clearInterval(this.pollTimer); }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected = false;
  }

  getStatus() {
    return { connected: this.connected, method: 'ilink' };
  }
}

module.exports = { WechatILink };
