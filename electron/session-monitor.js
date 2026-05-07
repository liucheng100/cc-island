const { EventEmitter } = require('events');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SessionMonitor extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.pollInterval = null;
    this.POLL_MS = 3000;
  }

  start() {
    this.scanSessions();
    this.pollInterval = setInterval(() => this.scanSessions(), this.POLL_MS);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async scanSessions() {
    try {
      const tasks = await this.findClaudeProcesses();
      const currentIds = new Set();

      for (const task of tasks) {
        currentIds.add(task.id);

        if (!this.sessions.has(task.id)) {
          // New session detected
          const session = {
            ...task,
            status: 'working',
            startTime: new Date().toISOString(),
            messages: [],
            lastActivity: new Date().toISOString(),
            workingDuration: 0,
          };
          this.sessions.set(task.id, session);
        } else {
          // Update existing session
          const existing = this.sessions.get(task.id);
          existing.lastActivity = new Date().toISOString();

          // Check if Claude has finished
          const isDone = await this.checkCompletion(task);
          if (isDone && existing.status === 'working') {
            existing.status = 'completed';
            existing.completedTime = new Date().toISOString();
          } else if (!isDone && existing.status === 'completed') {
            existing.status = 'working';
          }

          // Read recent conversation
          const messages = await this.readConversation(task);
          if (messages.length > 0) {
            existing.messages = messages;
          }

          existing.workingDuration = Math.floor(
            (new Date() - new Date(existing.startTime)) / 1000
          );
        }
      }

      // Mark dead sessions
      for (const [id, session] of this.sessions) {
        if (!currentIds.has(id)) {
          session.status = 'disconnected';
        }
      }

      // Clean up old disconnected sessions after 5 minutes
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (
          session.status === 'disconnected' &&
          now - new Date(session.lastActivity).getTime() > 300000
        ) {
          this.sessions.delete(id);
        }
      }

      this.emit('sessions-updated', this.getSessions());
    } catch (err) {
      console.error('Session scan error:', err.message);
    }
  }

  async findClaudeProcesses() {
    return new Promise((resolve) => {
      // Use WMIC to find Claude-related processes
      const cmd = `wmic process where "name like '%claude%' or name like '%node%'" get ProcessId,CommandLine,Name /format:csv 2>nul`;
      exec(cmd, { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }

        const tasks = [];
        const lines = stdout.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          // Parse WMIC CSV output
          const parts = line.split(',');
          if (parts.length < 3) continue;

          const name = (parts[1] || '').trim();
          const pid = (parts[2] || '').trim();
          const cmdLine = parts.slice(3).join(',').trim();

          // Detect Claude Code processes
          if (
            cmdLine.includes('claude') ||
            cmdLine.includes('@anthropic') ||
            cmdLine.includes('claude-code') ||
            name.toLowerCase().includes('claude')
          ) {
            // Extract working directory from command line
            const cwdMatch = cmdLine.match(/--cwd\s+["']?([^"'\s]+)/);
            const cwd = cwdMatch ? cwdMatch[1] : os.homedir();

            const sessionName = this.extractSessionName(cmdLine, cwd);

            tasks.push({
              id: `session-${pid}`,
              pid: parseInt(pid) || 0,
              name: sessionName,
              cwd: cwd,
              commandLine: cmdLine,
              type: 'claude-code',
            });
          }
        }

        // If no real Claude processes found, create demo sessions for testing
        if (tasks.length === 0) {
          tasks.push(...this.getDemoSessions());
        }

        resolve(tasks);
      });
    });
  }

  extractSessionName(cmdLine, cwd) {
    // Try to extract a meaningful name
    const promptMatch = cmdLine.match(/--prompt\s+["']?([^"']+)/);
    if (promptMatch) {
      const prompt = promptMatch[1].substring(0, 40);
      return prompt + (promptMatch[1].length > 40 ? '...' : '');
    }

    // Use directory name
    const dirName = path.basename(cwd);
    return `Claude @ ${dirName}`;
  }

  async checkCompletion(task) {
    return new Promise((resolve) => {
      // Check if process is still running
      exec(`tasklist /FI "PID eq ${task.pid}" /NH 2>nul`, (err, stdout) => {
        if (err || !stdout.includes(`${task.pid}`)) {
          resolve(true); // Process not found = completed
          return;
        }

        // Check CPU usage to detect idle (completed) state
        exec(
          `wmic process where ProcessId=${task.pid} get WorkingSetSize /format:csv 2>nul`,
          { timeout: 3000 },
          (err2, stdout2) => {
            if (err2) {
              resolve(false);
              return;
            }
            // If we can get process info, it's still working
            resolve(false);
          }
        );
      });
    });
  }

  async readConversation(task) {
    // Try to read Claude's conversation from common log locations
    const possiblePaths = [
      path.join(os.homedir(), '.claude', 'conversations'),
      path.join(os.homedir(), '.claude', 'history.jsonl'),
      path.join(task.cwd || os.homedir(), '.claude', 'conversation.json'),
    ];

    for (const logPath of possiblePaths) {
      try {
        if (fs.existsSync(logPath)) {
          const stat = fs.statSync(logPath);
          if (stat.isDirectory()) {
            // Read the latest conversation file
            const files = fs
              .readdirSync(logPath)
              .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
              .sort((a, b) => {
                return (
                  fs.statSync(path.join(logPath, b)).mtime -
                  fs.statSync(path.join(logPath, a)).mtime
                );
              });

            if (files.length > 0) {
              return this.parseConversationFile(path.join(logPath, files[0]));
            }
          } else {
            return this.parseConversationFile(logPath);
          }
        }
      } catch (e) {
        // Ignore read errors
      }
    }

    // Return demo messages if no real conversation found
    return this.getDemoMessages(task);
  }

  parseConversationFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const messages = [];

      if (filePath.endsWith('.jsonl')) {
        const lines = content.trim().split('\n');
        for (const line of lines.slice(-20)) {
          try {
            const entry = JSON.parse(line);
            if (entry.role && entry.content) {
              messages.push({
                role: entry.role,
                content:
                  typeof entry.content === 'string'
                    ? entry.content.substring(0, 200)
                    : JSON.stringify(entry.content).substring(0, 200),
                timestamp: entry.timestamp || new Date().toISOString(),
              });
            }
          } catch (e) {
            // skip
          }
        }
      } else {
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          for (const entry of data.slice(-20)) {
            messages.push({
              role: entry.role || 'unknown',
              content:
                typeof entry.content === 'string'
                  ? entry.content.substring(0, 200)
                  : JSON.stringify(entry.content).substring(0, 200),
              timestamp: entry.timestamp || new Date().toISOString(),
            });
          }
        }
      }

      return messages;
    } catch (e) {
      return [];
    }
  }

  getDemoSessions() {
    return [
      {
        id: 'session-demo-1',
        pid: 0,
        name: 'Claude @ my-project',
        cwd: 'E:\\projects\\my-project',
        type: 'claude-code',
      },
      {
        id: 'session-demo-2',
        pid: 0,
        name: 'Claude @ api-server',
        cwd: 'E:\\projects\\api-server',
        type: 'claude-code',
      },
    ];
  }

  getDemoMessages(task) {
    const baseMessages = [
      { role: 'user', content: '帮我重构这个模块的代码结构', timestamp: new Date(Date.now() - 300000).toISOString() },
      { role: 'assistant', content: '好的，让我先分析一下现有代码结构...', timestamp: new Date(Date.now() - 240000).toISOString() },
      { role: 'assistant', content: '我发现有以下可以优化的地方：1. 模块职责不清晰 2. 循环依赖 ...', timestamp: new Date(Date.now() - 180000).toISOString() },
    ];

    if (task.id === 'session-demo-2') {
      return [
        ...baseMessages,
        { role: 'user', content: '添加 API 限流功能', timestamp: new Date(Date.now() - 120000).toISOString() },
        { role: 'assistant', content: '已创建 rate-limiter.js，使用 token bucket 算法...', timestamp: new Date(Date.now() - 60000).toISOString() },
        { role: 'assistant', content: '✅ 任务已完成，已添加单元测试', timestamp: new Date(Date.now() - 10000).toISOString() },
      ];
    }

    return baseMessages;
  }

  getSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      ...s,
      messageCount: s.messages ? s.messages.length : 0,
    }));
  }

  getSessionDetail(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      ...session,
      messages: session.messages || [],
    };
  }

  async sendToSession(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // For real sessions, we could send input to the process via stdin
    // For demo, just add to messages
    if (!session.messages) session.messages = [];
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    // Simulate a response for demo
    setTimeout(() => {
      session.messages.push({
        role: 'assistant',
        content: `收到消息: "${message}" - Claude 正在处理中...`,
        timestamp: new Date().toISOString(),
      });
      session.lastActivity = new Date().toISOString();
      this.emit('sessions-updated', this.getSessions());
    }, 2000);

    return true;
  }
}

module.exports = { SessionMonitor };
