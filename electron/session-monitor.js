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
    this.POLL_MS = 5000;
    this.noSessionCount = 0;
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
          const session = {
            ...task,
            status: 'working',
            startTime: new Date().toISOString(),
            messages: [],
            lastActivity: new Date().toISOString(),
            workingDuration: 0,
          };
          this.sessions.set(task.id, session);
          console.log(`[SessionMonitor] New session: ${task.name} (${task.id})`);
        } else {
          const existing = this.sessions.get(task.id);
          existing.lastActivity = new Date().toISOString();

          const isDone = await this.checkCompletion(task);
          if (isDone && existing.status === 'working' && task.pid > 0) {
            existing.status = 'completed';
            existing.completedTime = new Date().toISOString();
            console.log(`[SessionMonitor] Session completed: ${task.name}`);
          } else if (!isDone && existing.status === 'completed') {
            existing.status = 'working';
          }

          const messages = await this.readConversation(task);
          if (messages.length > 0) {
            existing.messages = messages;
          }

          existing.workingDuration = Math.floor(
            (Date.now() - new Date(existing.startTime).getTime()) / 1000
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
          console.log(`[SessionMonitor] Removed stale session: ${id}`);
        }
      }

      this.emit('sessions-updated', this.getSessions());
    } catch (err) {
      console.error('[SessionMonitor] Scan error:', err.message);
    }
  }

  async findClaudeProcesses() {
    return new Promise((resolve) => {
      // PowerShell-based detection: more accurate on modern Windows
      const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'claude' -or $_.CommandLine -match 'claude-code' -or $_.CommandLine -match 'anthropic' -or $_.Name -match 'claude' } | Select-Object ProcessId, Name, CommandLine | ConvertTo-Csv -NoTypeInformation" 2>nul`;

      exec(psCmd, { timeout: 8000 }, (err, stdout) => {
        if (err || !stdout || stdout.trim().length === 0) {
          // Fallback: try WMIC
          this.findClaudeProcessesWMIC().then(resolve);
          return;
        }

        const tasks = [];
        const lines = stdout.trim().split('\n').slice(1); // skip header

        for (const line of lines) {
          const parts = line.replace(/^"|"$/g, '').split('","');
          if (parts.length < 3) continue;

          const pid = parts[0].replace(/"/g, '').trim();
          const name = parts[1].replace(/"/g, '').trim();
          const cmdLine = parts.slice(2).join('","').replace(/"/g, '').trim();

          if (!pid || isNaN(parseInt(pid))) continue;

          // Skip our own process
          if (cmdLine.includes('cc-island') || cmdLine.includes('CC Island')) continue;
          // Skip electron itself
          if (cmdLine.includes('electron') && !cmdLine.includes('claude')) continue;

          const cwd = this.extractCwd(cmdLine);
          const sessionName = this.extractSessionName(cmdLine, cwd, name);

          tasks.push({
            id: `session-${pid}`,
            pid: parseInt(pid),
            name: sessionName,
            cwd: cwd,
            commandLine: cmdLine.substring(0, 500),
            type: 'claude-code',
          });
        }

        resolve(tasks);
      });
    });
  }

  async findClaudeProcessesWMIC() {
    return new Promise((resolve) => {
      const cmd = `wmic process where "name like '%node%' or name like '%claude%' or name like '%cmd%'" get ProcessId,Name,CommandLine /format:csv 2>nul`;
      exec(cmd, { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }

        const tasks = [];
        const lines = stdout.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length < 3) continue;

          const name = (parts[1] || '').trim();
          const pid = (parts[2] || '').trim();
          const cmdLine = parts.slice(3).join(',').trim();

          if (!pid || isNaN(parseInt(pid))) continue;

          // Detect Claude Code via various signatures
          const isClaude =
            cmdLine.includes('claude') ||
            cmdLine.includes('@anthropic') ||
            cmdLine.includes('claude-code') ||
            cmdLine.includes('claude_cli') ||
            (cmdLine.includes('node') && cmdLine.includes('anthropic')) ||
            name.toLowerCase().includes('claude');

          if (!isClaude) continue;

          // Skip self
          if (cmdLine.includes('cc-island') || cmdLine.includes('CC Island')) continue;

          const cwd = this.extractCwd(cmdLine);
          const sessionName = this.extractSessionName(cmdLine, cwd, name);

          tasks.push({
            id: `session-${pid}`,
            pid: parseInt(pid),
            name: sessionName,
            cwd: cwd,
            commandLine: cmdLine.substring(0, 500),
            type: 'claude-code',
          });
        }

        resolve(tasks);
      });
    });
  }

  extractCwd(cmdLine) {
    // Claude Code often has the working directory in the command
    const cwdMatch = cmdLine.match(/(?:--cwd|--dir|cd)\s+["']?([^"'\s]+)/i);
    if (cwdMatch && fs.existsSync(cwdMatch[1])) {
      return cwdMatch[1];
    }
    // Try to find by Claude's project marker
    const projectMatch = cmdLine.match(/["']?([A-Z]:[\\\/][^"'\s]+)["']?/);
    if (projectMatch && fs.existsSync(projectMatch[1])) {
      return projectMatch[1];
    }
    return os.homedir();
  }

  extractSessionName(cmdLine, cwd, processName) {
    const promptMatch = cmdLine.match(/--prompt\s+["']?([^"']+)/);
    if (promptMatch) {
      return promptMatch[1].substring(0, 50);
    }
    const dirName = path.basename(cwd);
    return `${dirName}`;
  }

  async checkCompletion(task) {
    if (task.pid === 0) return false;

    return new Promise((resolve) => {
      exec(`tasklist /FI "PID eq ${task.pid}" /NH 2>nul`, { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(true);
          return;
        }
        // Process exists = still working
        resolve(!stdout.includes(`${task.pid}`));
      });
    });
  }

  async readConversation(task) {
    const claudeDir = path.join(os.homedir(), '.claude');
    const possiblePaths = [];

    // Claude Code stores conversations in various locations
    if (fs.existsSync(claudeDir)) {
      try {
        const entries = fs.readdirSync(claudeDir);
        for (const entry of entries) {
          const full = path.join(claudeDir, entry);
          if (fs.statSync(full).isDirectory() && entry !== 'plugins' && entry !== 'node_modules') {
            const convDir = path.join(full, 'conversations');
            if (fs.existsSync(convDir)) possiblePaths.push(convDir);
          }
          if (entry.endsWith('.jsonl')) possiblePaths.push(full);
          if (entry === 'history.jsonl') possiblePaths.push(full);
        }
      } catch (e) { /* ignore */ }
    }

    // Also check project-local .claude
    if (task.cwd) {
      const localClaude = path.join(task.cwd, '.claude');
      if (fs.existsSync(localClaude)) {
        possiblePaths.push(localClaude);
      }
    }

    for (const logPath of possiblePaths) {
      try {
        if (!fs.existsSync(logPath)) continue;
        const stat = fs.statSync(logPath);

        if (stat.isDirectory()) {
          const files = fs.readdirSync(logPath)
            .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
            .map((f) => ({ name: f, mtime: fs.statSync(path.join(logPath, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);

          if (files.length > 0) {
            const msgs = this.parseConversationFile(path.join(logPath, files[0].name));
            if (msgs.length > 0) return msgs;
          }
        } else {
          const msgs = this.parseConversationFile(logPath);
          if (msgs.length > 0) return msgs;
        }
      } catch (e) { /* ignore */ }
    }

    return [];
  }

  parseConversationFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const messages = [];

      if (filePath.endsWith('.jsonl')) {
        const lines = content.trim().split('\n');
        for (const line of lines.slice(-30)) {
          try {
            const entry = JSON.parse(line);
            if (entry.role || entry.type) {
              messages.push({
                role: entry.role || entry.type || 'unknown',
                content: typeof entry.content === 'string'
                  ? entry.content.substring(0, 300)
                  : (entry.content ? JSON.stringify(entry.content).substring(0, 300) : ''),
                timestamp: entry.timestamp || entry.created_at || new Date().toISOString(),
              });
            }
          } catch (e) { /* skip malformed lines */ }
        }
      } else {
        const data = JSON.parse(content);
        const entries = Array.isArray(data) ? data : (data.messages || data.conversation || []);
        for (const entry of entries.slice(-30)) {
          messages.push({
            role: entry.role || entry.type || 'unknown',
            content: typeof entry.content === 'string'
              ? entry.content.substring(0, 300)
              : JSON.stringify(entry.content || '').substring(0, 300),
            timestamp: entry.timestamp || entry.created_at || new Date().toISOString(),
          });
        }
      }

      return messages;
    } catch (e) {
      return [];
    }
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
    return { ...session, messages: session.messages || [] };
  }

  async sendToSession(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (!session.messages) session.messages = [];
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });
    session.lastActivity = new Date().toISOString();
    this.emit('sessions-updated', this.getSessions());
    return true;
  }
}

module.exports = { SessionMonitor };
