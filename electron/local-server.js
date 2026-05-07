const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

class LocalServer extends EventEmitter {
  constructor() {
    super();
    this.app = express();
    this.server = null;
    this.io = null;
    this.port = 0;
    this.sessions = [];
    this.tunnelProcess = null;
    this.publicURL = null;
    this.tunnelStatus = { active: false, url: null, service: null };
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      this.io = new SocketIOServer(this.server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
      });

      // Serve mobile web client
      this.app.use('/mobile', express.static(path.join(__dirname, '..', 'mobile')));

      // API: Get all sessions
      this.app.get('/api/sessions', (req, res) => {
        res.json(this.sessions);
      });

      // API: Get session detail
      this.app.get('/api/sessions/:id', (req, res) => {
        const session = this.sessions.find((s) => s.id === req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
      });

      // API: Send message to session (from phone / public network)
      this.app.post('/api/sessions/:id/message', express.json(), (req, res) => {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });
        this.emit('session-message', req.params.id, message);
        res.json({ success: true });
      });

      // Serve session control page
      this.app.get('/session/:id', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'mobile', 'session.html'));
      });

      // WeChat verification endpoint (for Official Account)
      this.app.get('/wechat', (req, res) => {
        const { signature, timestamp, nonce, echostr } = req.query;
        // For WeChat Official Account URL verification
        if (echostr) {
          res.send(echostr);
        } else {
          res.send('CC Island WeChat Bridge');
        }
      });

      this.app.post('/wechat', express.text({ type: '*/*' }), (req, res) => {
        // Handle WeChat Official Account messages
        this.emit('wechat-message', req.body);
        res.send('success');
      });

      // Health check
      this.app.get('/health', (req, res) => {
        res.json({
          status: 'ok',
          sessions: this.sessions.length,
          tunnel: this.tunnelStatus,
        });
      });

      // WebSocket
      this.io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        socket.on('join-session', (sessionId) => {
          socket.join(`session:${sessionId}`);
          const session = this.sessions.find((s) => s.id === sessionId);
          if (session) {
            socket.emit('session-data', session);
          }
        });

        socket.on('send-message', (data) => {
          this.emit('session-message', data.sessionId, data.message);
          socket.to(`session:${data.sessionId}`).emit('new-message', {
            role: 'user',
            content: data.message,
            timestamp: new Date().toISOString(),
          });
        });

        socket.on('disconnect', () => {
          console.log('Client disconnected:', socket.id);
        });
      });

      this.server.listen(0, () => {
        this.port = this.server.address().port;
        console.log(`[LocalServer] Running on port ${this.port}`);
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
  // Public Tunnel — tries multiple services
  // ========================

  async startTunnel(service = 'auto') {
    if (this.tunnelProcess) { this.stopTunnel(); }

    // Try services in order: bore.pub (HTTP), localhost.run (SSH), serveo.net (SSH)
    const services = service === 'auto'
      ? ['bore', 'localhost.run', 'serveo']
      : [service];

    for (const svc of services) {
      const result = await this.tryTunnel(svc);
      if (result && result.active) return result;
    }

    this.tunnelStatus = { active: false, url: null, service: null, error: 'All services failed' };
    return this.tunnelStatus;
  }

  async tryTunnel(service) {
    if (service === 'bore') {
      return this.tryBoreTunnel();
    }
    return this.trySSHTunnel(service);
  }

  // bore.pub — free HTTP tunnel, no SSH needed
  async tryBoreTunnel() {
    return new Promise((resolve) => {
      console.log('[Tunnel] Trying bore.pub...');
      // bore is a Rust-based tunnel tool, check if installed
      const { exec } = require('child_process');
      exec('bore local ' + this.port + ' --to bore.pub 2>&1', { timeout: 10000 }, (err, stdout) => {
        if (err) { resolve(null); return; }
        const match = stdout.match(/bore\.pub:(\d+)/) || stdout.match(/([\w-]+\.bore\.pub)/);
        if (match) {
          const url = `http://bore.pub:${match[1]}`;
          this.publicURL = url;
          this.tunnelStatus = { active: true, url, service: 'bore.pub' };
          resolve(this.tunnelStatus);
        } else {
          resolve(null);
        }
      });
    });
  }

  // SSH-based tunnels
  async trySSHTunnel(service) {
    return new Promise((resolve) => {
      const hosts = {
        'localhost.run': { host: 'nokey@localhost.run', port: 80 },
        'serveo': { host: 'serveo.net', port: 80 },
      };

      const cfg = hosts[service];
      if (!cfg) { resolve(null); return; }

      console.log(`[Tunnel] Trying ${service}...`);
      this.tunnelProcess = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-R', `${cfg.port}:localhost:${this.port}`,
        cfg.host,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let resolved = false;
      const handle = setTimeout(() => {
        if (!resolved) { resolved = true; resolve(null); }
      }, 12000);

      const onData = (data) => {
        const output = data.toString();
        console.log('[Tunnel]', output.trim());
        // Match serveo.net URL
        const serveoMatch = output.match(/https?:\/\/([\w-]+\.serveo\.net)/);
        // Match localhost.run URL
        const lhrMatch = output.match(/https?:\/\/([\w-]+\.lhr\.life)/);

        if ((serveoMatch || lhrMatch) && !resolved) {
          const url = serveoMatch ? `https://${serveoMatch[1]}` : `https://${lhrMatch[1]}`;
          this.publicURL = url;
          this.tunnelStatus = { active: true, url, service };
          resolved = true;
          clearTimeout(handle);
          console.log(`[Tunnel] Public URL: ${url}`);
          resolve(this.tunnelStatus);
        }
      };

      this.tunnelProcess.stdout.on('data', onData);
      this.tunnelProcess.stderr.on('data', onData);

      this.tunnelProcess.on('close', () => {
        if (!resolved) { resolved = true; clearTimeout(handle); resolve(null); }
        this.tunnelProcess = null;
        if (this.publicURL && this.tunnelStatus.active) {
          // Connection was established but later dropped
          this.tunnelStatus = { active: false, url: null, service: null };
        }
      });

      this.tunnelProcess.on('error', () => {
        if (!resolved) { resolved = true; clearTimeout(handle); resolve(null); }
        this.tunnelProcess = null;
      });
    });
  }

  stopTunnel() {
    if (this.tunnelProcess) {
      this.tunnelProcess.kill('SIGTERM');
      this.tunnelProcess = null;
    }
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
    this.sessions = sessions;
    if (this.io) {
      this.io.emit('sessions-updated', sessions);
      for (const session of sessions) {
        this.io.to(`session:${session.id}`).emit('session-updated', session);
      }
    }
  }
}

module.exports = { LocalServer };
