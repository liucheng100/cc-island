const { EventEmitter } = require('events');
const { exec } = require('child_process');
const { clipboard } = require('electron');
const win32 = require('./win32-utils');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class SessionMonitor extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.pollInterval = null;
    this.heartbeatInterval = null;
    this.POLL_MS = 1000;
    this.HEARTBEAT_MS = 5000;
    this.STALE_TIMEOUT_MS = 15000;
    this.processInfoCache = new Map();
    this.cwdCache = new Map();
    this.scanRunning = false;
    this._lastMsgCount = new Map(); // sessionKey → message count, for delta detection
    this.commandQueues = new Map(); // sessionKey → string[]
    this._lastAutoSent = new Map(); // sessionKey → timestamp, prevent duplicate auto-send
    this._emptyScanStreak = 0; // count consecutive empty scans
    this._lastSessionsHash = ''; // track sessions state to skip redundant broadcasts
  }

  // === Command Queue ===
  getQueue(sessionId) { return this.commandQueues.get(sessionId) || []; }
  addToQueue(sessionId, command) {
    if (!this.commandQueues.has(sessionId)) this.commandQueues.set(sessionId, []);
    this.commandQueues.get(sessionId).push(command);
    this.emit('queue-updated', { sessionId, queue: this.getQueue(sessionId) });
  }
  removeFromQueue(sessionId, index) {
    const q = this.commandQueues.get(sessionId);
    if (q) { q.splice(index, 1); if (q.length === 0) this.commandQueues.delete(sessionId); }
    this.emit('queue-updated', { sessionId, queue: this.getQueue(sessionId) });
  }
  clearQueue(sessionId) {
    this.commandQueues.delete(sessionId);
    this.emit('queue-updated', { sessionId, queue: [] });
  }

  // Auto-send next queued command when task completes
  tryAutoSendNext(sessionId) {
    const q = this.commandQueues.get(sessionId);
    if (!q || q.length === 0) return false;
    // Prevent duplicate auto-send within 3s
    const lastSent = this._lastAutoSent.get(sessionId) || 0;
    if (Date.now() - lastSent < 3000) return false;
    const cmd = q.shift();
    if (q.length === 0) this.commandQueues.delete(sessionId);
    this._lastAutoSent.set(sessionId, Date.now());
    this.emit('queue-updated', { sessionId, queue: this.getQueue(sessionId) });
    this.sendToSession(sessionId, cmd);
    return true;
  }

  start() {
    this.scanSessions();
    this.pollInterval = setInterval(() => this.scanSessions(), this.POLL_MS);
    this.heartbeatInterval = setInterval(() => this.runHeartbeat(), this.HEARTBEAT_MS);
  }

  stop() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
  }

  makeSessionKey(pid, cwd, terminalPid) {
    const dir = (cwd && cwd !== os.homedir() && cwd !== 'C:\\' && cwd !== '/') ? cwd : 'home';
    const term = terminalPid || pid;
    const keySource = `${dir}::terminal-${term}`;
    const normalized = String(keySource).replace(/\\/g, '/').toLowerCase();
    return `claude-${crypto.createHash('md5').update(normalized).digest('hex').substring(0, 8)}`;
  }

  getStableCwd(pid, cwd) {
    if (!cwd || cwd === os.homedir() || cwd === 'C:\\' || cwd === '/') {
      return this.cwdCache.get(pid)?.cwd || cwd;
    }
    if (!this.cwdCache.has(pid) || this.cwdCache.get(pid).cwd !== cwd) {
      this.cwdCache.set(pid, { cwd, ts: Date.now() });
    }
    return cwd;
  }

  async scanSessions() {
    if (this.scanRunning) return;
    this.scanRunning = true;
    try {
      const processes = await this.findClaudeProcesses();
      const currentKeys = new Set();

      for (const proc of processes) {
        const meta = await this.readSessionMeta(proc.pid);
        const rawCwd = proc.cwd || meta.cwd || await this.extractCwd(proc.pid, proc.commandLine, proc.name);
        const cwd = this.getStableCwd(proc.pid, rawCwd);
        const terminalPid = proc.terminalPid || await this.findTerminalPid(proc.pid, proc.parentPid || 0);
        proc.cwd = cwd;
        proc.terminalPid = terminalPid;

        const key = this.makeSessionKey(proc.pid, cwd, terminalPid);
        currentKeys.add(key);
        const isNew = !this.sessions.has(key);

        if (isNew) {
          const convData = await this.readConversationByPid(proc.pid, meta.sessionId, cwd);
          const title = convData.title || this.extractSessionName(proc.commandLine, cwd, proc.name);

          const source = await this.getSourceLabel(terminalPid, proc.parentPid);
          const displayName = source ? `[${source}] ${title}` : title;

          const session = {
            id: key, pid: proc.pid, parentPid: proc.parentPid || 0,
            terminalPid, name: displayName, cwd, commandLine: proc.commandLine,
            sessionId: meta.sessionId,
            status: meta.status === 'busy' ? 'answering' : (convData.status || 'working'),
            startTime: new Date().toISOString(), messages: convData.messages || [],
            lastActivity: new Date().toISOString(), workingDuration: 0,
            _lastFileMtime: convData.fileMtime || 0,
          };
          this.sessions.set(key, session);
          this._lastMsgCount.set(key, convData.messages ? convData.messages.length : 0);
          console.log(`[SessionMonitor] New: ${title} (${key}) pid=${proc.pid} terminal=${terminalPid} cwd=${cwd} status=${session.status}`);
        } else {
          const existing = this.sessions.get(key);
          existing.pid = proc.pid;
          existing.parentPid = proc.parentPid || 0;
          existing.terminalPid = terminalPid || existing.terminalPid;
          existing.commandLine = proc.commandLine;
          existing.sessionId = meta.sessionId || existing.sessionId;
          existing.lastActivity = new Date().toISOString();

          const convData = await this.readConversationByPid(proc.pid, meta.sessionId || existing.sessionId, cwd);
          if (convData.messages && convData.messages.length > 0) {
            const prevCount = this._lastMsgCount.get(key) || 0;
            const newCount = convData.messages.length;
            if (newCount > prevCount) {
              const delta = convData.messages.slice(prevCount);
              this._lastMsgCount.set(key, newCount);
              existing.messages = convData.messages;
              this.emit('session-messages-changed', { sessionId: key, messages: existing.messages, delta, status: existing.status });
            } else if (newCount >= (existing.messages ? existing.messages.length : 0)) {
              existing.messages = convData.messages;
            }
          }
          if (convData.fileMtime) existing._lastFileMtime = convData.fileMtime;
          if (convData.title) {
            const source = await this.getSourceLabel(terminalPid, existing.parentPid);
            existing.name = source ? `[${source}] ${convData.title}` : convData.title;
          }
          const prev = existing.status;
          if (meta.status === 'busy') {
            existing.status = 'answering';
            existing._justSent = 0; // clear — Claude is actually working now
          } else if (meta.status === 'idle') {
            if (prev === 'answering' || prev === 'thinking') {
              // Don't complete if we just sent a message (<5s ago)
              if (!existing._justSent || Date.now() - existing._justSent > 5000) {
                existing.status = 'completed';
                // Auto-send next queued command
                if (this.commandQueues.has(key) && this.commandQueues.get(key).length > 0) {
                  setTimeout(() => this.tryAutoSendNext(key), 500);
                }
              }
            }
          } else if (convData.status) {
            existing.status = convData.status;
          }
          if (prev !== existing.status) console.log(`[SessionMonitor] Status: ${existing.name} ${prev} -> ${existing.status} (meta=${meta.status})`);
          existing.workingDuration = Math.floor((Date.now() - new Date(existing.startTime).getTime()) / 1000);
        }
      }

      // Cleanup stale sessions — require 2 consecutive empty scans to prevent false clear
      if (processes.length === 0) {
        this._emptyScanStreak++;
        if (this._emptyScanStreak < 2) return;
        this._lastSessionsHash = ''; // force broadcast when sessions cleared
      } else {
        this._emptyScanStreak = 0;
      }
      for (const [key, session] of this.sessions) {
        if (!currentKeys.has(key)) {
          console.log(`[SessionMonitor] Removed: ${session.name} (${key})`);
          this.sessions.delete(key);
        }
      }

      const sessions = this.getSessions();
      const hash = sessions.map(s => s.id + ':' + s.status + ':' + s.messageCount).sort().join(',');
      if (hash !== this._lastSessionsHash) {
        this._lastSessionsHash = hash;
        this.emit('sessions-updated', sessions);
      }
    } catch (err) {
      console.error('[SessionMonitor] Scan error:', err.message);
    } finally {
      this.scanRunning = false;
    }
  }

  async findClaudeProcesses() {
    return new Promise((resolve) => {
      // Step 1: tasklist via exec (handles encoding, buffers output)
      exec('tasklist /FO CSV /NH', { timeout: 5000 }, (tlErr, tlOut) => {
        if (tlErr || !tlOut) { resolve([]); return; }
        const candidateNames = new Set(['node.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'claude.exe']);
        const candidates = [];
        const lines = tlOut.split('\n');
        for (const line of lines) {
          const m = line.match(/^"([^"]+)","(\d+)"/);
          if (!m) continue;
          const name = m[1].toLowerCase();
          if (!candidateNames.has(name)) continue;
          candidates.push({ pid: parseInt(m[2]), name: m[1] });
        }
        if (candidates.length === 0) { resolve([]); return; }

        // Step 2: get command lines via single batch wmic query
        const pidFilter = candidates.map(c => `ProcessId=${c.pid}`).join(' or ');
        exec(`wmic process where "${pidFilter}" get ProcessId,ParentProcessId,Name,CommandLine /format:csv 2>nul`, { timeout: 5000 }, (wmicErr, wmicOut) => {
          if (wmicErr || !wmicOut) { resolve([]); return; }
          const results = [];
          const wmicLines = wmicOut.split('\n').filter(l => l.trim());
          // Parse header to find column positions (wmic reorders columns!)
          let colIdx = { ProcessId: -1, ParentProcessId: -1, Name: -1, CommandLine: -1 };
          for (const line of wmicLines) {
            const firstComma = line.indexOf(',');
            if (firstComma < 0) continue;
            const headerPart = line.substring(0, firstComma);
            if (headerPart === 'Node') {
              const cols = line.substring(firstComma + 1).split(',');
              for (let i = 0; i < cols.length; i++) {
                const h = cols[i].trim();
                if (colIdx.hasOwnProperty(h)) colIdx[h] = i;
              }
              continue;
            }
            if (colIdx.ProcessId < 0) continue;
            const parts = line.substring(firstComma + 1).split(',');
            const pid = (parts[colIdx.ProcessId] || '').trim();
            const parentPid = (parts[colIdx.ParentProcessId] || '').trim();
            const name = (parts[colIdx.Name] || '').trim();
            const cmdLine = parts.slice(colIdx.CommandLine).join(',').trim();
            if (!pid || isNaN(parseInt(pid))) continue;
            const isClaude = cmdLine.includes('@anthropic-ai/claude-code') || cmdLine.includes('claude-code')
              || cmdLine.match(/[\\/]claude(\.exe)?[" ]/) || cmdLine.match(/^claude(\.exe)?[" ]/)
              || name.toLowerCase() === 'claude.exe';
            if (!isClaude) continue;
            if (cmdLine.includes('cc-island') || cmdLine.includes('CC Island') || cmdLine.includes('.vscode')) continue;
            results.push({ pid: parseInt(pid), parentPid: parseInt(parentPid) || 0, terminalPid: 0, name, cwd: '', commandLine: cmdLine.substring(0, 500) });
          }
          resolve(results);
        });
      });
    });
  }

  async extractCwd(pid, cmdLine, processName) {
    const cached = this.cwdCache.get(pid);
    if (cached && Date.now() - cached.ts < 60000) return cached.cwd;
    // Try --cwd/--dir from command line
    const cwdMatch = cmdLine.match(/(?:--cwd|--dir)\s+["']?([^"'\s]+)/i);
    if (cwdMatch && fs.existsSync(cwdMatch[1])) { this.cwdCache.set(pid, { cwd: cwdMatch[1], ts: Date.now() }); return cwdMatch[1]; }
    // For standalone claude.exe (uv/pipx), query CWD directly from the process
    if (processName === 'claude.exe') {
      const directCwd = await this.queryProcessCwd(pid);
      if (directCwd && fs.existsSync(directCwd)) { this.cwdCache.set(pid, { cwd: directCwd, ts: Date.now() }); return directCwd; }
    }
    const parentPid = await this.getParentPid(pid);
    if (parentPid) {
      const cwdFromTitle = await this.getCwdFromWindowTitle(parentPid);
      if (cwdFromTitle && fs.existsSync(cwdFromTitle)) { this.cwdCache.set(pid, { cwd: cwdFromTitle, ts: Date.now() }); return cwdFromTitle; }
    }
    try {
      const cwd = await this.queryProcessCwdViaParent(pid);
      if (cwd && cwd !== os.homedir() && fs.existsSync(cwd)) { this.cwdCache.set(pid, { cwd, ts: Date.now() }); return cwd; }
    } catch (e) {}
    return os.homedir();
  }

  // Query CWD of a process directly (works for standalone processes like claude.exe)
  async queryProcessCwd(pid) {
    return new Promise((resolve) => {
      // Use WMI to get the process's CommandLine, then try to extract CWD from it,
      // or fallback to checking the parent process's window title
      exec(`powershell -NoProfile -Command "
$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -EA SilentlyContinue
if (-not $p) { return }
# Try to get parent process's window title (the terminal CWD)
$parent = Get-CimInstance Win32_Process -Filter \\"ProcessId=$($p.ParentProcessId)\\" -EA SilentlyContinue
if ($parent) {
  $parentProc = Get-Process -Id $parent.ProcessId -EA SilentlyContinue
  if ($parentProc -and $parentProc.MainWindowTitle) {
    $title = $parentProc.MainWindowTitle
    if ($title -match '([A-Z]:\\\\[^\\\\s]+)') { Write-Output $matches[1]; return }
  }
}
# Fallback: check if claude.exe's own command line contains a path
if ($p.CommandLine -match '[A-Z]:[\\\\/][^\\"\\s]+') {
  $possible = $matches[0]
  while (-not (Test-Path $possible -PathType Container) -and $possible -match '[\\\\/]') {
    $possible = Split-Path $possible -Parent
  }
  if (Test-Path $possible -PathType Container) { Write-Output $possible }
}
"`, { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) { resolve(null); return; }
        const cwd = stdout.trim();
        resolve(fs.existsSync(cwd) ? cwd : null);
      });
    });
  }

  async getParentPid(pid) {
    return new Promise((resolve) => {
      exec(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction SilentlyContinue).ParentProcessId"`, { timeout: 3000 }, (err, stdout) => {
        if (err || !stdout) { resolve(0); return; }
        resolve(parseInt(stdout.trim()) || 0);
      });
    });
  }

  async findTerminalPid(pid, parentPid) {
    const terminalNames = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'windowsterminal.exe', 'conhost.exe', 'winterminal.exe']);
    let cur = parentPid || pid;
    for (let i = 0; i < 10; i++) {
      if (!cur || cur === 0) break;
      const info = await this.getProcessInfo(cur);
      if (!info) break;
      if (terminalNames.has((info.Name || '').toLowerCase())) return cur;
      if (!info.ParentProcessId || info.ParentProcessId === 0) break;
      cur = info.ParentProcessId;
    }
    return parentPid || pid;
  }

  async queryProcessCwdViaParent(pid) {
    let cur = pid;
    for (let i = 0; i < 10; i++) {
      const info = await this.getProcessInfo(cur);
      if (!info) break;
      const name = (info.Name || '').toLowerCase();
      if (name === 'cmd.exe' || name === 'powershell.exe' || name === 'pwsh.exe' || name === 'windowsterminal.exe') {
        const cwd = await this.getCwdFromWindowTitle(cur);
        if (cwd) return cwd;
      }
      if (!info.ParentProcessId || info.ParentProcessId === 0) break;
      cur = info.ParentProcessId;
    }
    return null;
  }

  async getCwdFromWindowTitle(pid) {
    return new Promise((resolve) => {
      exec(`powershell -NoProfile -Command "$p=Get-Process -Id ${pid} -EA SilentlyContinue; if($p-and$p.MainWindowTitle){$t=$p.MainWindowTitle;if($t-match'([A-Z]:\\\\[^\\s]+)'){Write-Output $matches[1]}elseif($t-match'([A-Z]:)'){Write-Output $t}}"`, { timeout: 3000 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) { resolve(null); return; }
        const title = stdout.trim();
        const m = title.match(/([A-Z]:\\[^:*?"<>|]+)/i);
        if (m && fs.existsSync(m[1])) { resolve(m[1]); return; }
        if (fs.existsSync(title)) { resolve(title); return; }
        resolve(null);
      });
    });
  }

  async getProcessInfo(pid) {
    const cached = this.processInfoCache.get(pid);
    if (cached && Date.now() - cached.ts < 30000) return cached.info;
    return new Promise((resolve) => {
      exec(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object Name,ParentProcessId | ConvertTo-Csv -NoTypeInformation"`, { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) { this.processInfoCache.set(pid, { info: null, ts: Date.now() }); resolve(null); return; }
        try {
          const lines = stdout.trim().split('\n').slice(1);
          if (lines.length === 0) { this.processInfoCache.set(pid, { info: null, ts: Date.now() }); resolve(null); return; }
          const parts = lines[0].replace(/"/g, '').split(',');
          const info = { Name: (parts[0] || '').trim(), ParentProcessId: parseInt(parts[1]) || 0 };
          this.processInfoCache.set(pid, { info, ts: Date.now() });
          resolve(info);
        } catch (e) { this.processInfoCache.set(pid, { info: null, ts: Date.now() }); resolve(null); }
      });
    });
  }

  async getSourceLabel(terminalPid, parentPid) {
    if (!terminalPid || terminalPid === 0) terminalPid = parentPid;
    if (!terminalPid || terminalPid === 0) return null;
    const info = await this.getProcessInfo(terminalPid);
    if (!info) return null;
    const name = (info.Name || '').toLowerCase();
    if (name === 'cmd.exe') return 'CMD';
    if (name === 'powershell.exe' || name === 'pwsh.exe') {
      if (info.ParentProcessId) {
        const gp = await this.getProcessInfo(info.ParentProcessId);
        if (gp && (gp.Name || '').toLowerCase() === 'code.exe') return 'VSCode';
      }
      return 'PowerShell';
    }
    if (name === 'windowsterminal.exe') return '终端';
    if (name === 'code.exe') return 'VSCode';
    return null;
  }

  extractSessionName(cmdLine, cwd, processName) {
    const m = cmdLine.match(/--prompt\s+["']?([^"']+)/);
    if (m) return m[1].substring(0, 50);
    if (cwd && cwd !== os.homedir()) return path.basename(cwd);
    return 'Claude Session';
  }

  async readSessionMeta(pid) {
    const f = path.join(os.homedir(), '.claude', 'sessions', `${pid}.json`);
    try {
      if (!fs.existsSync(f)) return {};
      const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
      return {
        sessionId: d.sessionId || null,
        cwd: d.cwd || null,
        status: d.status || null,
        updatedAt: d.updatedAt || null,
      };
    } catch (e) { return {}; }
  }

  findProjectDir(cwd) {
    if (!cwd || cwd === os.homedir()) return null;
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return null;
    const normalized = cwd.replace(/\\/g, '/').toLowerCase();
    try {
      for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const projDir = path.join(projectsDir, entry.name);
        const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
        if (files.length === 0) continue;
        const sorted = files.map(f => ({ name: f, mtime: fs.statSync(path.join(projDir, f)).mtime })).sort((a, b) => b.mtime - a.mtime);
        const firstLine = fs.readFileSync(path.join(projDir, sorted[0].name), 'utf-8').split('\n')[0];
        try {
          const e = JSON.parse(firstLine);
          if (e.cwd && e.cwd.replace(/\\/g, '/').toLowerCase() === normalized) return projDir;
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  async readConversationByPid(pid, sessionId, cwd) {
    const result = { messages: [], title: null, status: null, fileMtime: 0 };
    let convPath = null;
    if (sessionId) {
      const projDir = this.findProjectDir(cwd);
      if (projDir) {
        const candidate = path.join(projDir, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) convPath = candidate;
      }
      if (!convPath) {
        const projectsDir = path.join(os.homedir(), '.claude', 'projects');
        if (fs.existsSync(projectsDir)) {
          try {
            for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
              if (!entry.isDirectory()) continue;
              const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
              if (fs.existsSync(candidate)) { convPath = candidate; break; }
            }
          } catch (e) {}
        }
      }
    }
    if (!convPath && cwd) {
      const projDir = this.findProjectDir(cwd);
      if (projDir) {
        try {
          const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'))
            .map(f => ({ path: path.join(projDir, f), mtime: fs.statSync(path.join(projDir, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);
          if (files.length > 0) convPath = files[0].path;
        } catch (e) {}
      }
    }
    if (!convPath || !fs.existsSync(convPath)) return result;
    result.fileMtime = fs.statSync(convPath).mtime.getTime();
    try {
      const content = fs.readFileSync(convPath, 'utf-8');
      const lines = content.trim().split('\n');
      const messages = [];
      let lastUserContent = null;
      const now = Date.now();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'file-history-snapshot' || entry.isMeta || entry.type === 'system') continue;
          const msg = entry.message;
          if (!msg || !msg.role) continue;
          let content = '';
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content.filter(c => c.type === 'text').map(c => c.text || '').join(' ')
              || msg.content.filter(c => c.type === 'tool_use').map(c => `[${c.name}]`).join(' ');
          }
          if (!content || content.trim().length === 0) continue;
          if (content.startsWith('<local-command') || content.startsWith('<command-name>')
              || content.startsWith('<command-message>') || content.startsWith('<local-command-stdout>')) continue;
          if (msg.role === 'user' && content.length > 5
              && !content.includes('<command-name>') && !content.includes('<local-command')) {
            lastUserContent = content.substring(0, 80);
          }
          messages.push({ role: msg.role, content: content.substring(0, 500), timestamp: entry.timestamp || new Date().toISOString() });
        } catch (e) {}
      }
      result.messages = messages;
      result.title = lastUserContent || (cwd ? path.basename(cwd) : null);
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        const fileAge = now - fs.statSync(convPath).mtime.getTime();
        if (lastMsg.role === 'assistant') {
          if (fileAge < 30000) result.status = 'answering';
          else result.status = 'completed';
        } else if (lastMsg.role === 'user') {
          if (fileAge < 5000) result.status = 'thinking';
          else result.status = 'completed';
        }
      }
    } catch (e) { console.error('[SessionMonitor] Error reading conversation:', e.message); }
    return result;
  }

  // Batch-check which PIDs are still alive, clean up dead sessions
  async runHeartbeat() {
    if (this.sessions.size === 0) return;
    const entries = Array.from(this.sessions.entries());
    const pids = entries.map(([, s]) => s.pid);

    // Batch check all PIDs with a single PowerShell call
    const alivePids = await this.checkPidsAlive(pids);
    const aliveSet = new Set(alivePids);
    const now = Date.now();
    let changed = false;

    for (const [key, session] of entries) {
      let dead = false;

      if (!aliveSet.has(session.pid)) {
        // PID not found — double-check if terminal window still exists
        const terminalPid = session.terminalPid || session.parentPid || session.pid;
        if (session.pid !== terminalPid && aliveSet.has(terminalPid)) {
          // Terminal still alive, claude process may have restarted — keep session for now
          session.lastActivity = new Date().toISOString();
          continue;
        }
        const hwnd = win32.getConsoleWindowForPid(terminalPid);
        if (!hwnd) {
          dead = true;
        }
      }

      // Staleness timeout — unseen by scan for too long
      const lastSeen = new Date(session.lastActivity).getTime();
      if (!dead && (now - lastSeen > this.STALE_TIMEOUT_MS)) {
        const hwnd = win32.getConsoleWindowForPid(session.terminalPid || session.parentPid || session.pid);
        if (!hwnd) {
          dead = true;
        }
      }

      if (dead) {
        console.log(`[Heartbeat] Dead session: ${session.name} (${key}) pid=${session.pid}`);
        this.sessions.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.emit('sessions-updated', this.getSessions());
    }
  }

  // Batch check: return array of PIDs that still exist
  checkPidsAlive(pids) {
    return new Promise((resolve) => {
      if (pids.length === 0) { resolve([]); return; }
      const list = pids.join(',');
      exec(`powershell -NoProfile -Command "
$ids = @(${list})
$alive = @()
foreach ($id in $ids) {
  try { Get-Process -Id $id -ErrorAction Stop | Out-Null; $alive += $id } catch {}
}
Write-Output ($alive -join ',')
"`, { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) { resolve([]); return; }
        const result = stdout.trim().split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
        resolve(result);
      });
    });
  }

  getSessions() {
    return Array.from(this.sessions.values()).map((s) => ({ ...s, messageCount: s.messages ? s.messages.length : 0 }));
  }

  getSessionDetail(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return { ...session, messages: session.messages || [] };
  }

  async focusSessionWindow(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) { console.log('[Focus] No session for', sessionId); return false; }
    const terminalPid = session.terminalPid || session.parentPid || session.pid;
    console.log('[Focus] sessionId=' + sessionId + ' terminal=' + terminalPid);
    try {
      const hwnd = win32.getConsoleWindowForPid(terminalPid)
        || win32.getConsoleWindowForPid(session.pid);
      if (!hwnd) { console.log('[Focus] No console window found for', sessionId); return false; }
      win32.forceRestoreAndFocus(hwnd);
      console.log('[Focus] OK for', sessionId);
      return true;
    } catch (e) { console.error('[Focus] exception:', e.message); return false; }
  }

  async sendToSession(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };
    if (!session.messages) session.messages = [];
    const newMsg = { role: 'user', content: message, timestamp: new Date().toISOString() };
    session.messages.push(newMsg);
    this._lastMsgCount.set(sessionId, session.messages.length);
    session.lastActivity = new Date().toISOString();
    // Immediately show thinking state on all clients
    session.status = 'thinking';
    session._justSent = Date.now();
    this.emit('sessions-updated', this.getSessions());
    // Push delta to socket clients immediately (no wait for scan)
    this.emit('session-messages-changed', {
      sessionId,
      messages: session.messages,
      delta: [newMsg],
      status: session.status,
    });
    const terminalPid = session.terminalPid || session.parentPid || session.pid;
    console.log('[Send] pid=' + session.pid + ' terminal=' + terminalPid + ' msg=' + message.substring(0, 50));
    try {
      const wciOk = win32.writeConsoleInput(terminalPid, message);
      if (!wciOk) {
        const hwnd = win32.getConsoleWindowForPid(terminalPid)
          || win32.getConsoleWindowForPid(session.pid);
        if (!hwnd) { console.log('[Send] No console window for', sessionId); return { success: false, error: '找不到 CMD 窗口' }; }
        win32.forceRestoreAndFocus(hwnd);
        clipboard.writeText(message);
        let s = Date.now(); while (Date.now() - s < 100) {}
        win32.typeTextViaPaste();
        console.log('[Send] Fallback paste OK sessionId=' + sessionId);
        return { success: true };
      }
      await new Promise((r) => setTimeout(r, 300));
      win32.sendEnterToConsole(terminalPid);
      console.log('[Send] WCI + Enter OK sessionId=' + sessionId);
      const verified = await this.verifyMessageSent(session, message);
      if (verified) return { success: true };
      console.log('[Send] Not seen, retrying Enter for sessionId=' + sessionId);
      await new Promise((r) => setTimeout(r, 300));
      win32.sendEnterToConsole(terminalPid);
      await this.verifyMessageSent(session, message);
      return { success: true };
    } catch (e) {
      console.error('[Send] exception:', e.message);
      return { success: false, error: e.message };
    }
  }

  async verifyMessageSent(session, message) {
    const cwd = session.cwd;
    if (!cwd) return true;
    const projDir = this.findProjectDir(cwd);
    if (!projDir) return true;
    const maxWait = 5000;
    const pollInterval = 500;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval));
      try {
        const files = fs.readdirSync(projDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(projDir, f)).mtime }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) continue;
        const latestPath = path.join(projDir, files[0].name);
        const content = fs.readFileSync(latestPath, 'utf-8');
        const lines = content.trim().split('\n');
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
          try {
            const entry = JSON.parse(lines[i]);
            const msg = entry.message;
            if (msg && msg.role === 'user') {
              let msgContent = '';
              if (typeof msg.content === 'string') {
                msgContent = msg.content;
              } else if (Array.isArray(msg.content)) {
                msgContent = msg.content.filter(c => c.type === 'text').map(c => c.text || '').join(' ');
              }
              if (msgContent.includes(message) || message.includes(msgContent)) {
                console.log('[Send] Verified: message found in conversation');
                return true;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    console.log('[Send] Verification timeout — message not confirmed');
    return false;
  }
}

module.exports = { SessionMonitor };
