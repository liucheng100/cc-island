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
  // Public Tunnel (serveo.net / localhost.run)
  // ========================

  async startTunnel(service = 'serveo') {
    if (this.tunnelProcess) {
      console.log('[Tunnel] Already running');
      return this.tunnelStatus;
    }

    return new Promise((resolve) => {
      const sshArgs = service === 'serveo'
        ? ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-R', `80:localhost:${this.port}`, 'serveo.net']
        : ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-R', `80:localhost:${this.port}`, 'nokey@localhost.run'];

      console.log(`[Tunnel] Starting ${service} tunnel...`);
      this.tunnelProcess = spawn('ssh', sshArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resolved = false;

      this.tunnelProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[Tunnel]', output.trim());

        // serveo.net output: "Forwarding HTTP traffic from https://xxx.serveo.net"
        const serveoMatch = output.match(/https?:\/\/([\w-]+\.serveo\.net)/);
        // localhost.run output: "https://xxx.lhr.life tunneled"
        const lhrMatch = output.match(/https?:\/\/([\w-]+\.lhr\.life)/);

        if ((serveoMatch || lhrMatch) && !resolved) {
          const url = serveoMatch
            ? `https://${serveoMatch[1]}`
            : `https://${lhrMatch[1]}`;

          this.publicURL = url;
          this.tunnelStatus = { active: true, url, service };
          resolved = true;
          console.log(`[Tunnel] Public URL: ${url}`);
          resolve(this.tunnelStatus);
        }
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        const output = data.toString();
        // serveo.net often outputs info to stderr
        const serveoMatch = output.match(/https?:\/\/([\w-]+\.serveo\.net)/);
        if (serveoMatch && !resolved) {
          const url = `https://${serveoMatch[1]}`;
          this.publicURL = url;
          this.tunnelStatus = { active: true, url, service };
          resolved = true;
          console.log(`[Tunnel] Public URL (stderr): ${url}`);
          resolve(this.tunnelStatus);
        }
      });

      this.tunnelProcess.on('close', (code) => {
        console.log(`[Tunnel] Process exited with code ${code}`);
        this.tunnelProcess = null;
        this.publicURL = null;
        this.tunnelStatus = { active: false, url: null, service: null };
        if (!resolved) {
          resolved = true;
          resolve(this.tunnelStatus);
        }
      });

      this.tunnelProcess.on('error', (err) => {
        console.error(`[Tunnel] Error: ${err.message}`);
        this.tunnelProcess = null;
        this.tunnelStatus = { active: false, url: null, service: null, error: err.message };
        if (!resolved) {
          resolved = true;
          resolve(this.tunnelStatus);
        }
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.tunnelStatus = { active: false, url: null, service: null, error: 'Connection timeout' };
          resolve(this.tunnelStatus);
        }
      }, 15000);
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
