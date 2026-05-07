const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
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
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      this.io = new SocketIOServer(this.server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
      });

      // Serve static files for mobile web client
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

      // API: Send message to session
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

      // Health check
      this.app.get('/health', (req, res) => {
        res.json({ status: 'ok', sessions: this.sessions.length });
      });

      // WebSocket real-time communication
      this.io.on('connection', (socket) => {
        console.log('Mobile client connected:', socket.id);

        socket.on('join-session', (sessionId) => {
          socket.join(`session:${sessionId}`);
          const session = this.sessions.find((s) => s.id === sessionId);
          if (session) {
            socket.emit('session-data', session);
          }
        });

        socket.on('send-message', (data) => {
          this.emit('session-message', data.sessionId, data.message);
          // Broadcast to other clients in same session room
          socket.to(`session:${data.sessionId}`).emit('new-message', {
            role: 'user',
            content: data.message,
            timestamp: new Date().toISOString(),
          });
        });

        socket.on('disconnect', () => {
          console.log('Mobile client disconnected:', socket.id);
        });
      });

      // Listen on a random available port
      this.server.listen(0, () => {
        this.port = this.server.address().port;
        console.log(`Local server running on port ${this.port}`);
        resolve(this.port);
      });

      this.server.on('error', reject);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

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
      // Also emit per-session updates
      for (const session of sessions) {
        this.io.to(`session:${session.id}`).emit('session-updated', session);
      }
    }
  }
}

module.exports = { LocalServer };
