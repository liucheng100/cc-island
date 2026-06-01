const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const bus = require('./message-bus');

class LocalServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.app = express();
    this.server = null;
    this.io = null;
    this.port = 0;
    this.sessions = [];
    this.tunnelProcess = null;
    this.tunnelReconnectTimer = null;
    this.tunnelRetryCount = 0;
    this.tunnelMaxRetries = 5;
    this.tunnelService = null;
    this.tunnelCustomCfg = null;
    this.publicURL = null;
    this.tunnelStatus = { active: false, url: null, service: null };
    this.getSessionDetail = null;
    this.getQueueForSession = null;
    // Custom server bind config
    this.bindHost = config.host || '0.0.0.0';
    this.bindPort = config.port || 0;
    this.publicBase = config.publicBase || '';
    if (this.publicBase) this.publicURL = this.publicBase;
    // Auth
    this.accessPin = '';
    this.deviceMode = 1; // 1=first-device, 2=manual, 3=open
    this.firstDeviceId = null;
    this.firstDeviceName = '';
    this.approvedDevices = new Map(); // deviceId → { name, approvedAt }
    this.pendingDevices = new Map(); // deviceId → { name, createdAt }
    this.pinFailUntil = 0;
    this.settingsPath = null;
  }

  setSettingsPath(p) { this.settingsPath = p; }

  setSessionDetailProvider(fn) {
    this.getSessionDetail = fn;
  }

  onQueueUpdated(data) {
    if (this.io && data && data.sessionId) {
      this.io.emit('queue-changed', { sessionId: data.sessionId, autoPlay: data.autoPlay });
    }
  }

  onQueueAutoReady(data) {
    if (this.io && data && data.sessionId) {
      this.io.to(`session:${data.sessionId}`).emit('queue-auto-ready', data);
    }
  }

  // ===== Auth =====
  initAuth() {
    const fs = require('fs');
    const sp = this.settingsPath;
    try {
      if (sp && fs.existsSync(sp)) {
        const s = JSON.parse(fs.readFileSync(sp, 'utf-8'));
        if (s.accessPin) this.accessPin = s.accessPin;
        if (s.deviceMode) this.deviceMode = s.deviceMode;
        if (s.firstDeviceId) this.firstDeviceId = s.firstDeviceId;
        if (s.firstDeviceName) this.firstDeviceName = s.firstDeviceName;
        if (s.approvedDevices) {
          for (const [k, v] of Object.entries(s.approvedDevices)) {
            this.approvedDevices.set(k, v);
          }
        }
      }
    } catch (e) {}
    if (!this.accessPin) {
      this.accessPin = String(Math.floor(100000 + Math.random() * 900000));
      this.firstDeviceId = null;
      this.saveAuth();
    }
  }

  saveAuth() {
    const sp = this.settingsPath;
    if (!sp) return;
    const fs = require('fs');
    try {
      const existing = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf-8')) : {};
      existing.accessPin = this.accessPin;
      existing.deviceMode = this.deviceMode;
      existing.firstDeviceId = this.firstDeviceId;
      existing.firstDeviceName = this.firstDeviceName;
      existing.approvedDevices = Object.fromEntries(this.approvedDevices);
      fs.writeFileSync(sp, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (e) {}
    bus.emit('auth-state-changed');
  }

  getAccessPin() { return this.accessPin; }
  getDeviceMode() { return this.deviceMode; }

  setDeviceMode(mode) {
    this.deviceMode = mode;
    this.saveAuth();
  }

  resetFirstDevice() {
    this.firstDeviceId = null;
    this.firstDeviceName = '';
    this.saveAuth();
  }

  regeneratePin() {
    this.accessPin = String(Math.floor(100000 + Math.random() * 900000));
    this.firstDeviceId = null;
    this.firstDeviceName = '';
    this.saveAuth();
    return this.accessPin;
  }

  getPendingDevices() {
    return Array.from(this.pendingDevices.entries()).map(([id, info]) => ({ deviceId: id, ...info }));
  }

  getApprovedDevices() {
    return Array.from(this.approvedDevices.entries()).map(([id, info]) => ({
      deviceId: id,
      displayId: id.substring(0, 8) + '...',
      name: info.name,
      approvedAt: info.approvedAt,
    }));
  }

  approveDevice(deviceId) {
    const p = this.pendingDevices.get(deviceId);
    if (p) {
      this.approvedDevices.set(deviceId, { name: p.name, approvedAt: new Date().toISOString() });
      this.pendingDevices.delete(deviceId);
      this.saveAuth();
      return true;
    }
    this.approvedDevices.set(deviceId, { name: deviceId.substring(0, 8), approvedAt: new Date().toISOString() });
    this.saveAuth();
    return true;
  }

  rejectDevice(deviceId) {
    this.pendingDevices.delete(deviceId);
    this.approvedDevices.delete(deviceId);
    this.saveAuth();
  }

  // Returns true if device is authorized
  checkDevice(deviceId, deviceName) {
    if (this.deviceMode === 3) return true; // open
    if (this.deviceMode === 1) {
      // First-device mode
      if (!this.firstDeviceId) {
        this.firstDeviceId = deviceId;
        this.firstDeviceName = deviceName || deviceId.substring(0, 8);
        this.saveAuth();
        return true;
      }
      return deviceId === this.firstDeviceId;
    }
    if (this.deviceMode === 2) {
      // Manual mode
      if (this.approvedDevices.has(deviceId)) return true;
      // Add to pending if not already
      if (!this.pendingDevices.has(deviceId)) {
        this.pendingDevices.set(deviceId, { name: deviceName || deviceId.substring(0, 8), createdAt: new Date().toISOString() });
        bus.emit('auth-state-changed');
      }
      return false;
    }
    return false;
  }

  // Rate-limit PIN attempts
  checkPinRateLimit() {
    if (this.pinFailUntil > 0 && Date.now() < this.pinFailUntil) return false;
    return true;
  }

  recordPinFailure() {
    this.pinFailCount = (this.pinFailCount || 0) + 1;
    if (this.pinFailCount >= 5) {
      this.pinFailUntil = Date.now() + 60000; // lock 1 minute
      this.pinFailCount = 0;
    }
  }

  resetPinFailures() {
    this.pinFailCount = 0;
    this.pinFailUntil = 0;
  }

  // Verify a pin + device combo, return { ok, reason, deviceId }
  verifyAuth(pin, deviceId, deviceName) {
    if (!pin || pin !== this.accessPin) {
      this.recordPinFailure();
      return { ok: false, reason: 'pin' };
    }
    if (!this.checkPinRateLimit()) {
      return { ok: false, reason: 'rate_limit' };
    }
    this.resetPinFailures();
    if (!deviceId) {
      return { ok: false, reason: 'no_device_id' };
    }
    const deviceOk = this.checkDevice(deviceId, deviceName);
    if (!deviceOk) {
      return { ok: false, reason: 'device_rejected', pending: this.deviceMode === 2 };
    }
    return { ok: true };
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      this.io = new SocketIOServer(this.server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
      });

      // Serve static assets (no auth needed)
      this.app.use('/mobile', express.static(path.join(__dirname, '..', 'mobile')));
      this.app.use('/lib/marked', express.static(path.join(__dirname, '..', 'node_modules', 'marked', 'lib')));
      this.app.use('/lib/fp', express.static(path.join(__dirname, '..', 'node_modules', '@fingerprintjs', 'fingerprintjs', 'dist')));

      // === Auth middleware ===
      const authGuard = (req, res, next) => {
        const pin = req.query.pin || (req.body && req.body.pin);
        const deviceId = req.query.deviceId || (req.body && req.body.deviceId);
        const deviceName = req.query.deviceName || (req.body && req.body.deviceName) || '';
        const r = this.verifyAuth(pin, deviceId, deviceName);
        if (!r.ok) {
          return res.status(401).json({ error: 'Unauthorized', reason: r.reason, pending: r.pending });
        }
        next();
      };

      // === Queue API ===
      this.app.get('/api/queue/:id', authGuard, (req, res) => {
        if (this.getQueueForSession) {
          res.json({ queue: this.getQueueForSession(req.params.id), autoPlay: this.getAutoPlayForSession ? this.getAutoPlayForSession(req.params.id) : false });
        } else {
          res.json({ queue: [], autoPlay: false });
        }
      });

      // === Auth API (no guard) ===
      this.app.post('/api/auth', express.json(), (req, res) => {
        const { pin, deviceId, deviceName } = req.body || {};
        const r = this.verifyAuth(pin, deviceId, deviceName);
        if (r.ok) return res.json({ ok: true });
        res.status(401).json({ ok: false, reason: r.reason, pending: r.pending });
      });

      this.app.get('/api/auth/status', (req, res) => {
        res.json({
          pinSet: !!this.accessPin,
          deviceMode: this.deviceMode,
          pendingCount: this.pendingDevices.size,
          approvedCount: this.approvedDevices.size,
        });
      });

      // === Protected API ===
      this.app.get('/api/sessions', authGuard, (req, res) => {
        res.json(this.sessions);
      });

      // API: Get session detail (with messages for initial load)
      this.app.get('/api/sessions/:id', authGuard, (req, res) => {
        if (this.getSessionDetail) {
          const detail = this.getSessionDetail(req.params.id);
          if (detail) return res.json(detail);
        }
        const session = this.sessions.find((s) => s.id === req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
      });

      // API: Send message to session
      this.app.post('/api/sessions/:id/message', authGuard, express.json(), (req, res) => {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });
        bus.emit('session-message', req.params.id, message);
        res.json({ success: true });
      });

      // Serve session control page (no auth — page handles auth itself)
      this.app.get('/session/:id', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'mobile', 'session.html'));
      });

      // WeChat endpoints (no auth — relies on WeChat's own verification)
      this.app.get('/wechat', (req, res) => {
        const { signature, timestamp, nonce, echostr } = req.query;
        if (echostr) { res.send(echostr); }
        else { res.send('CC Island WeChat Bridge'); }
      });

      this.app.post('/wechat', express.text({ type: '*/*' }), (req, res) => {
        bus.emit('wechat-message', req.body);
        res.send('success');
      });

      // Health check (no auth)
      this.app.get('/health', (req, res) => {
        res.json({
          status: 'ok',
          sessions: this.sessions.length,
          tunnel: this.tunnelStatus,
        });
      });

      // === Socket.IO auth middleware ===
      this.io.use((socket, next) => {
        const pin = socket.handshake.auth.pin || socket.handshake.query.pin;
        const deviceId = socket.handshake.auth.deviceId || socket.handshake.query.deviceId;
        const deviceName = socket.handshake.auth.deviceName || '';
        const r = this.verifyAuth(pin, deviceId, deviceName);
        if (!r.ok) return next(new Error('Unauthorized'));
        next();
      });

      // Per-event auth check — re-verify PIN + device without rate limiting
      const socketAuth = (socket) => {
        const pin = socket.handshake.auth.pin;
        const deviceId = socket.handshake.auth.deviceId;
        const deviceName = socket.handshake.auth.deviceName || '';
        // Skip rate-limit: socket is already authenticated at connection time
        if (!pin || pin !== this.accessPin) {
          socket.emit('auth-error', { reason: 'pin' });
          socket.disconnect(true);
          return false;
        }
        if (!deviceId || !this.checkDevice(deviceId, deviceName)) {
          socket.emit('auth-error', { reason: 'device_rejected' });
          socket.disconnect(true);
          return false;
        }
        return true;
      };

      // Check all connected sockets on auth config change
      this.broadcastAuthCheck = () => {
        if (!this.io) return;
        for (const [id, socket] of this.io.sockets.sockets) {
          socketAuth(socket);
        }
      };

      // WebSocket
      this.io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Ping/pong heartbeat — verify auth on each cycle
        const pingTimer = setInterval(() => {
          if (!socketAuth(socket)) return;
          socket.emit('ping');
        }, 1000);

        socket.on('pong', () => {
          if (!socketAuth(socket)) return;
        });

        socket.on('latency-test', () => {
          if (!socketAuth(socket)) return;
          socket.emit('latency-pong');
        });

        socket.on('join-session', (sessionId) => {
          if (!socketAuth(socket)) return;
          socket.join(`session:${sessionId}`);
          bus.emit('get-queue-resp', socket, sessionId);
        });

        socket.on('send-message', (data) => {
          if (!socketAuth(socket)) return;
          if (!this.sessions.find(s => s.id === data.sessionId)) {
            socket.emit('send-error', { sessionId: data.sessionId, error: '会话已断开' });
            return;
          }
          bus.emit('session-message', data.sessionId, data.message);
        });

        socket.on('focus-session', (sessionId) => {
          if (!socketAuth(socket)) return;
          bus.emit('focus-session', sessionId);
        });

        socket.on('leave-session', (sessionId) => {
          socket.leave(`session:${sessionId}`);
        });

        socket.on('new-session', (cwd) => {
          if (!socketAuth(socket)) return;
          bus.emit('new-claude-session', cwd);
        });

        // Command queue
        socket.on('get-queue', (sessionId, cb) => {
          if (!socketAuth(socket)) return;
          bus.emit('get-queue-resp', socket, sessionId);
        });
        socket.on('add-to-queue', (data) => {
          if (!socketAuth(socket)) return;
          bus.emit('add-to-queue', data.sessionId, data.command);
        });
        socket.on('remove-from-queue', (data) => {
          if (!socketAuth(socket)) return;
          bus.emit('remove-from-queue', data.sessionId, data.index);
        });
        socket.on('clear-queue', (sessionId) => {
          if (!socketAuth(socket)) return;
          bus.emit('clear-queue', sessionId);
        });
        socket.on('reorder-queue', (data) => {
          if (!socketAuth(socket)) return;
          bus.emit('reorder-queue', data.sessionId, data.from, data.to);
        });
        socket.on('set-auto-play', (data) => {
          if (!socketAuth(socket)) return;
          bus.emit('set-auto-play', data.sessionId, data.enabled);
        });
        socket.on('send-next-from-queue', (sessionId) => {
          if (!socketAuth(socket)) return;
          bus.emit('send-next-from-queue', sessionId);
        });

        socket.on('disconnect', () => {
          clearInterval(pingTimer);
          console.log('Client disconnected:', socket.id);
        });
      });

      this.server.listen(this.bindPort, this.bindHost, () => {
        this.port = this.server.address().port;
        console.log(`[LocalServer] Running on ${this.bindHost}:${this.port}`);
        resolve(this.port);
      });

      this.server.on('error', reject);
    });
  }

  stop() {
    this.stopTunnel();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  // ========================
  // Public Tunnel — SSH reverse tunnel with auto-reconnect
  // ========================

  async startTunnel(service = 'auto', customCfg = null) {
    if (this.tunnelProcess) { this.stopTunnel(); }

    // Pre-flight: check if SSH is available
    const sshOk = await this.checkSshAvailable();
    if (!sshOk) {
      this.tunnelStatus = { active: false, url: null, service: null, error: '系统未安装 SSH，请先安装 OpenSSH 客户端' };
      return this.tunnelStatus;
    }

    if (service === 'custom' && customCfg && customCfg.host) {
      this.tunnelCustomCfg = customCfg;
      const result = await this.connectTunnel('custom', customCfg);
      if (result && result.active) {
        this.tunnelService = 'custom';
        this.tunnelRetryCount = 0;
        return result;
      }
      const errMsg = (result && result.error) ? result.error : '连接失败，请检查主机地址和端口是否正确';
      this.tunnelStatus = { active: false, url: null, service: null, error: errMsg };
      return this.tunnelStatus;
    }

    const services = ['serveo', 'localhost.run'];

    for (const svc of services) {
      const result = await this.connectTunnel(svc);
      if (result && result.active) {
        this.tunnelService = svc;
        this.tunnelRetryCount = 0;
        return result;
      }
    }

    this.tunnelStatus = { active: false, url: null, service: null, error: 'All services failed' };
    return this.tunnelStatus;
  }

  checkSshAvailable() {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      exec('ssh -V 2>&1', { timeout: 5000 }, (err, stdout, stderr) => {
        // ssh -V outputs to stderr by design
        const output = (stdout || '') + (stderr || '');
        resolve(output.includes('OpenSSH') || output.includes('ssh'));
      });
    });
  }

  connectTunnel(service, customCfg = null) {
    return new Promise((resolve) => {
      let sshHost, remotePort, publicUrlBase;

      if (service === 'custom' && customCfg) {
        sshHost = customCfg.host;
        remotePort = customCfg.port || 22;
        publicUrlBase = customCfg.publicBase || '';
      } else {
        const hosts = {
          'serveo': { host: 'serveo.net', port: 80 },
          'localhost.run': { host: 'nokey@localhost.run', port: 80 },
        };
        const cfg = hosts[service];
        if (!cfg) { resolve(null); return; }
        sshHost = cfg.host;
        remotePort = cfg.port;
        publicUrlBase = '';
      }

      // For custom servers, allow specifying a fixed remote port
      let remoteBindPort = '0'; // 0 = random allocation
      if (customCfg && customCfg.remotePort) {
        remoteBindPort = String(customCfg.remotePort);
      }

      console.log(`[Tunnel] Connecting to ${service}${customCfg ? ' (' + customCfg.host + ':' + customCfg.port + ')' : ''}...`);
      const child = spawn('ssh', [
        '-N', '-T',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=15',
        '-o', 'ServerAliveInterval=60',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'TCPKeepAlive=yes',
        '-o', 'ExitOnForwardFailure=yes',
        '-p', String(remotePort),
        '-R', `${remoteBindPort}:localhost:${this.port}`,
        sshHost,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let resolved = false;
      let errorOutput = '';

      // If user specified both remote port and public base, we know the URL upfront
      if (customCfg && customCfg.remotePort && customCfg.publicBase) {
        const url = customCfg.publicBase.replace(/\/+$/, '') + ':' + customCfg.remotePort;
        // Still need to verify SSH connects — give it 8s before assuming success
        setTimeout(() => {
          if (!resolved) {
            this.publicURL = url;
            this.tunnelStatus = { active: true, url, service };
            this.tunnelProcess = child;
            resolved = true;
            clearTimeout(timeout);
            console.log(`[Tunnel] Connected (custom): ${url}`);
            resolve(this.tunnelStatus);
          }
        }, 8000);
      }

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill();
          const errMsg = errorOutput || 'Connection timed out (15s)';
          console.log('[Tunnel] Failed:', errMsg);
          resolve({ active: false, url: null, service, error: errMsg });
        }
      }, 15000);

      const onData = (data) => {
        const output = data.toString();
        console.log('[Tunnel]', output.trim());

        if (resolved) return;

        // Public tunnel services — parse generated URL from output
        const serveoMatch = output.match(/https?:\/\/([\w-]+\.serveo\.net)/);
        const lhrMatch = output.match(/https?:\/\/([\w-]+\.lhr\.life)/);
        // Custom server — parse allocated port
        const portMatch = output.match(/[Aa]llocated port (\d+)/);

        let url = null;
        if (serveoMatch) url = `https://${serveoMatch[1]}`;
        else if (lhrMatch) url = `https://${lhrMatch[1]}`;
        else if (portMatch && customCfg) {
          const allocatedPort = portMatch[1];
          if (customCfg.publicBase) {
            url = customCfg.publicBase.replace(/\/+$/, '') + ':' + allocatedPort;
          } else {
            url = customCfg.host + ':' + allocatedPort;
          }
        }

        if (url) {
          this.publicURL = url;
          this.tunnelStatus = { active: true, url, service };
          this.tunnelProcess = child;
          resolved = true;
          clearTimeout(timeout);
          console.log(`[Tunnel] Connected: ${url}`);
          resolve(this.tunnelStatus);
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
        onData(data);
      });

      child.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          const errMsg = errorOutput || `SSH exited with code ${code}`;
          console.log('[Tunnel] Failed:', errMsg);
          resolve({ active: false, url: null, service, error: errMsg });
          return;
        }
        // Established tunnel dropped — try reconnect
        this.tunnelProcess = null;
        console.log(`[Tunnel] Disconnected (code=${code}), will reconnect...`);
        this.scheduleReconnect();
      });

      child.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('[Tunnel] Error:', err.message);
          resolve({ active: false, url: null, service, error: err.message });
          return;
        }
        this.tunnelProcess = null;
        console.log(`[Tunnel] Error: ${err.message}, will reconnect...`);
        this.scheduleReconnect();
      });
    });
  }

  scheduleReconnect() {
    if (this.tunnelReconnectTimer) return;
    if (this.tunnelRetryCount >= this.tunnelMaxRetries) {
      console.log('[Tunnel] Max retries reached, giving up.');
      this.tunnelStatus = { active: false, url: null, service: null };
      this.publicURL = null;
      return;
    }
    this.tunnelRetryCount++;
    const delay = Math.min(2000 * this.tunnelRetryCount, 15000);
    console.log(`[Tunnel] Reconnect #${this.tunnelRetryCount} in ${delay / 1000}s...`);
    this.tunnelReconnectTimer = setTimeout(async () => {
      this.tunnelReconnectTimer = null;
      const svc = this.tunnelService || 'serveo';
      const result = await this.connectTunnel(svc, this.tunnelCustomCfg);
      if (result && result.active) {
        this.tunnelRetryCount = 0;
      } else {
        this.scheduleReconnect();
      }
    }, delay);
  }

  stopTunnel() {
    if (this.tunnelReconnectTimer) {
      clearTimeout(this.tunnelReconnectTimer);
      this.tunnelReconnectTimer = null;
    }
    if (this.tunnelProcess) {
      this.tunnelProcess.kill('SIGTERM');
      this.tunnelProcess = null;
    }
    this.tunnelRetryCount = this.tunnelMaxRetries;
    this.tunnelCustomCfg = null;
    this.publicURL = null;
    this.tunnelStatus = { active: false, url: null, service: null };
    console.log('[Tunnel] Stopped');
  }

  getPublicURL() {
    return this.publicURL;
  }

  getTunnelStatus() {
    return { ...this.tunnelStatus };
  }

  // ========================
  // Utilities
  // ========================

  getPort() {
    return this.port;
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  broadcastSessions(sessions) {
    // Strip messages to keep broadcast lightweight
    this.sessions = sessions.map(s => {
      const { messages, ...rest } = s;
      return rest;
    });
    if (this.io) {
      this.io.emit('sessions-updated', this.sessions);
    }
  }

  // Push incremental message delta to a session room
  onMessagesChanged(data) {
    if (this.io && data && data.sessionId) {
      this.io.to(`session:${data.sessionId}`).emit('session-messages', {
        sessionId: data.sessionId,
        messages: data.messages,
        delta: data.delta,
      });
    }
  }
}

module.exports = { LocalServer };
