const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class WechatBridge extends EventEmitter {
  constructor(localServer) {
    super();
    this.localServer = localServer;
    this.status = {
      connected: false,
      qrScanned: false,
      user: null,
      startedAt: null,
    };
    this.pythonProcess = null;
    this.bridgePort = 18990;
  }

  init() {
    // Check if Python bridge script exists
    const bridgePath = path.join(__dirname, '..', 'python', 'wechat_bridge.py');
    if (!fs.existsSync(bridgePath)) {
      console.log('Python bridge script not found, WeChat integration will use stub');
    }
  }

  async start() {
    try {
      const scriptPath = path.join(__dirname, '..', 'python', 'wechat_bridge.py');

      if (!fs.existsSync(scriptPath)) {
        // Stub mode for testing without Python
        this.status.connected = true;
        this.status.qrScanned = true;
        this.status.user = '测试用户';
        this.status.startedAt = new Date().toISOString();
        this.emit('status-changed', this.status);
        return true;
      }

      this.pythonProcess = spawn('python', [scriptPath, '--port', String(this.bridgePort)], {
        cwd: path.join(__dirname, '..', 'python'),
        env: { ...process.env },
      });

      this.pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[WeChat Bridge]', output);

        // Parse status updates from Python bridge
        if (output.includes('LOGIN_SUCCESS')) {
          this.status.connected = true;
          this.status.qrScanned = true;
          this.emit('status-changed', this.status);
        } else if (output.includes('QR_READY')) {
          this.status.connected = false;
          this.status.qrScanned = false;
          this.emit('status-changed', this.status);
        } else if (output.includes('USER:')) {
          const userMatch = output.match(/USER:(.+)/);
          if (userMatch) {
            this.status.user = userMatch[1].trim();
            this.emit('status-changed', this.status);
          }
        }
      });

      this.pythonProcess.stderr.on('data', (data) => {
        console.error('[WeChat Bridge Error]', data.toString());
      });

      this.pythonProcess.on('close', (code) => {
        console.log('[WeChat Bridge] Process exited with code', code);
        this.status.connected = false;
        this.emit('status-changed', this.status);
        this.pythonProcess = null;
      });

      this.status.startedAt = new Date().toISOString();
      this.emit('status-changed', this.status);
      return true;
    } catch (err) {
      console.error('Failed to start WeChat bridge:', err.message);
      return false;
    }
  }

  stop() {
    if (this.pythonProcess) {
      this.pythonProcess.kill('SIGTERM');
      this.pythonProcess = null;
    }
    this.status.connected = false;
    this.status.qrScanned = false;
    this.emit('status-changed', this.status);
  }

  getStatus() {
    return { ...this.status };
  }

  async sendWechatMessage(toUser, content) {
    return new Promise((resolve) => {
      if (!this.pythonProcess) {
        resolve(false);
        return;
      }
      // Send command to Python bridge via stdin
      const cmd = JSON.stringify({ action: 'send', to: toUser, content }) + '\n';
      this.pythonProcess.stdin.write(cmd);
      resolve(true);
    });
  }
}

module.exports = { WechatBridge };
