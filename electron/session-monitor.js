const { EventEmitter } = require('events');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class SessionMonitor extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.pollInterval = null;
    this.POLL_MS = 5000;
  }

  start() {
    this.scanSessions();
    this.pollInterval = setInterval(() => this.scanSessions(), this.POLL_MS);
  }

  stop() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }

  // Generate a stable session key from working directory + process signature
  // This prevents duplicate sessions from subprocesses sharing the same CWD
  makeSessionKey(pid, cwd) {
    // Use CWD as primary key — one Claude Code session = one working directory
    const normalized = cwd.replace(/\\/g, '/').toLowerCase();
    return `claude-${crypto.createHash('md5').update(normalized).digest('hex').substring(0, 8)}`;
  }

  async scanSessions() {
    try {
      const processes = await this.findClaudeProcesses();
      const currentKeys = new Set();

      for (const proc of processes) {
        const key = this.makeSessionKey(proc.pid, proc.cwd);
        currentKeys.add(key);

        if (!this.sessions.has(key)) {
          const session = {
            ...proc,
            id: key,
            status: 'working',
            startTime: new Date().toISOString(),
            messages: [],
            lastActivity: new Date().toISOString(),
            workingDuration: 0,
          };
          this.sessions.set(key, session);
          console.log(`[SessionMonitor] New: ${proc.name} (${key}) pid=${proc.pid} parent=${proc.parentPid} terminal=${proc.terminalPid} cwd=${proc.cwd}`);
        } else {
          const existing = this.sessions.get(key);
          existing.pid = proc.pid; // update PID in case process restarted
          existing.parentPid = proc.parentPid || 0;
          existing.terminalPid = proc.terminalPid || 0;
          existing.commandLine = proc.commandLine;
          existing.lastActivity = new Date().toISOString();

          const isDone = await this.checkCompletion(proc);
          if (isDone && existing.status === 'working' && proc.pid > 0) {
            existing.status = 'completed';
            existing.completedTime = new Date().toISOString();
            console.log(`[SessionMonitor] Done: ${proc.name}`);
          } else if (!isDone && existing.status === 'completed') {
            existing.status = 'working';
          }

          const messages = await this.readConversation(proc);
          if (messages.length > 0) {
            existing.messages = messages;
          }

          existing.workingDuration = Math.floor(
            (Date.now() - new Date(existing.startTime).getTime()) / 1000
          );
        }
      }

      // Mark sessions no longer seen
      for (const [key, session] of this.sessions) {
        if (!currentKeys.has(key)) {
          session.status = 'disconnected';
        }
      }

      // Clean stale disconnected after 5 minutes
      const now = Date.now();
      for (const [key, session] of this.sessions) {
        if (session.status === 'disconnected' && now - new Date(session.lastActivity).getTime() > 300000) {
          this.sessions.delete(key);
        }
      }

      this.emit('sessions-updated', this.getSessions());
    } catch (err) {
      console.error('[SessionMonitor] Scan error:', err.message);
    }
  }

  async findClaudeProcesses() {
    return new Promise((resolve) => {
      // Use PowerShell to find genuine Claude Code processes
      // Claude Code CLI: command line contains "@anthropic-ai/claude-code" or runs "claude" binary
      // Claude Code Desktop: process name is "Claude" or "Claude Code"
      const psCmd = `powershell -NoProfile -Command "$procs = Get-CimInstance Win32_Process; $results = @(); foreach ($p in $procs) { $cl = if($p.CommandLine) { $p.CommandLine } else { '' }; $nm = if($p.Name) { $p.Name } else { '' }; if ($cl -match '@anthropic-ai/claude-code' -or $cl -match 'claude-code' -or $cl -match '(^|[\\\\/ ])claude(\\.exe)?( |$)' -or $nm -match '^claude(\\.exe)?$' -or $nm -match '^Claude' -or $nm -match 'Claude Code') { $results += $p } }; $results | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Csv -NoTypeInformation" 2>nul`;

      exec(psCmd, { timeout: 10000 }, async (err, stdout) => {
        if (err || !stdout || stdout.trim().length === 0) {
          this.findClaudeProcessesWMIC().then(resolve);
          return;
        }

        const tasks = [];
        const lines = stdout.trim().split('\n').slice(1);

        for (const line of lines) {
          const parts = line.replace(/^"|"$/g, '').split('","');
          if (parts.length < 3) continue;

          const pid = parts[0].replace(/"/g, '').trim();
          const parentPid = parts[1].replace(/"/g, '').trim();
          const name = parts[2].replace(/"/g, '').trim();
          const cmdLine = parts.slice(3).join('","').replace(/"/g, '').trim();

          if (!pid || isNaN(parseInt(pid))) continue;

          // Skip our own process
          if (cmdLine.includes('cc-island') || cmdLine.includes('CC Island')) continue;
          if (cmdLine.includes('electron') && !cmdLine.includes('claude')) continue;
          // Skip this very PowerShell command
          if (cmdLine.includes('Get-CimInstance')) continue;

          const cwd = await this.extractCwd(pid, cmdLine);
          const sessionName = this.extractSessionName(cmdLine, cwd, name);
          const terminalPid = await this.findTerminalPid(parseInt(pid), parseInt(parentPid) || 0);

          tasks.push({
            pid: parseInt(pid),
            parentPid: parseInt(parentPid) || 0,
            terminalPid: terminalPid,
            name: sessionName,
            cwd: cwd,
            commandLine: cmdLine.substring(0, 500),
          });
        }

        resolve(tasks);
      });
    });
  }

  async findTerminalPid(pid, parentPid) {
    // Walk up parent chain to find CMD/PowerShell/Windows Terminal/conhost
    const terminalNames = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'windowsterminal.exe', 'conhost.exe']);
    let currentPid = parentPid || pid;
    const chain = [];
    for (let i = 0; i < 10; i++) {
      if (!currentPid || currentPid === 0) break;
      const info = await this.getProcessInfo(currentPid);
      if (!info) break;
      const name = (info.Name || '').toLowerCase();
      chain.push(`${name}(${currentPid})`);
      if (terminalNames.has(name)) {
        console.log(`[SessionMonitor] Terminal for pid=${pid}: ${chain.join(' -> ')}`);
        return currentPid;
      }
      if (!info.ParentProcessId || info.ParentProcessId === 0) break;
      currentPid = info.ParentProcessId;
    }
    console.log(`[SessionMonitor] No terminal found for pid=${pid}: ${chain.join(' -> ')}`);
    return parentPid || pid;
  }

  async extractCwd(pid, cmdLine) {
    // Method 1: Parse from command line
    const cwdMatch = cmdLine.match(/(?:--cwd|--dir)\s+["']?([^"'\s]+)/i);
    if (cwdMatch && fs.existsSync(cwdMatch[1])) return cwdMatch[1];

    // Method 2: Walk up parent chain to find a CMD/terminal with a real CWD
    try {
      const cwd = await this.queryProcessCwdViaParent(pid);
      if (cwd && cwd !== os.homedir() && fs.existsSync(cwd)) return cwd;
    } catch (e) { /* ignore */ }

    // Method 3: Extract Windows path from command line (skip claude.exe install paths)
    const pathMatch = cmdLine.match(/([A-Z]:\\[^"'\s]+)/i);
    if (pathMatch) {
      const candidate = pathMatch[1];
      // Skip paths that look like claude.exe install locations
      if (!candidate.toLowerCase().includes('claude') || !candidate.toLowerCase().endsWith('.exe')) {
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(candidate);
        if (fs.existsSync(parent)) return parent;
      }
    }

    return os.homedir();
  }

  async queryProcessCwdViaParent(pid) {
    // Walk up parent chain to find CMD/PowerShell/Windows Terminal, then get its CWD
    let currentPid = pid;
    for (let i = 0; i < 10; i++) {
      const info = await this.getProcessInfo(currentPid);
      if (!info) break;
      const name = (info.Name || '').toLowerCase();
      if (name === 'cmd.exe' || name === 'powershell.exe' || name === 'pwsh.exe' || name === 'windowsterminal.exe') {
        // Try to get CWD from /proc-style or working directory
        const cwd = await this.getCwdFromWindow(info.Name, info.CommandLine);
        if (cwd) return cwd;
      }
      if (!info.ParentProcessId || info.ParentProcessId === 0) break;
      currentPid = info.ParentProcessId;
    }
    return null;
  }

  async getProcessInfo(pid) {
    return new Promise((resolve) => {
      const ps = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object Name,ParentProcessId,CommandLine | ConvertTo-Json"`;
      exec(ps, { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) { resolve(null); return; }
        try {
          const obj = JSON.parse(stdout.trim());
          resolve({
            Name: (obj.Name || '').trim(),
            ParentProcessId: parseInt(obj.ParentProcessId) || 0,
            CommandLine: (obj.CommandLine || '').trim(),
          });
        } catch (e) { resolve(null); }
      });
    });
  }

  async getCwdFromWindow(processName, cmdLine) {
    // Try to extract CWD from CMD /K or /C patterns
    const cdMatch = cmdLine.match(/cd\s+["']?([^"'&|]+)/i);
    if (cdMatch && fs.existsSync(cdMatch[1].trim())) return cdMatch[1].trim();
    // Try pushd
    const pushdMatch = cmdLine.match(/pushd\s+["']?([^"'&|]+)/i);
    if (pushdMatch && fs.existsSync(pushdMatch[1].trim())) return pushdMatch[1].trim();
    return null;
  }

  async findClaudeProcessesWMIC() {
    return new Promise((resolve) => {
      // Narrower WMIC query — only look for processes likely to be Claude
      const cmd = `wmic process where "name='node.exe' or name='claude.exe' or name='Claude.exe' or name like 'Claude%'" get ProcessId,ParentProcessId,Name,CommandLine /format:csv 2>nul`;
      exec(cmd, { timeout: 5000 }, async (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }

        const tasks = [];
        const lines = stdout.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length < 3) continue;

          const pid = (parts[1] || '').trim();
          const parentPid = (parts[2] || '').trim();
          const name = (parts[3] || '').trim();
          const cmdLine = parts.slice(4).join(',').trim();

          if (!pid || isNaN(parseInt(pid))) continue;

          // Strict detection: only real Claude processes
          const isClaude =
            cmdLine.includes('@anthropic-ai/claude-code') ||
            cmdLine.includes('claude-code') ||
            cmdLine.includes('\\claude ') ||
            (name.toLowerCase().includes('claude') && !cmdLine.includes('cc-island') && !cmdLine.includes('CC Island'));

          if (!isClaude) continue;
          if (cmdLine.includes('cc-island') || cmdLine.includes('CC Island')) continue;
          if (cmdLine.includes('Select-Object') || cmdLine.includes('Get-CimInstance')) continue;

          const cwd = await this.extractCwd(pid, cmdLine);
          const sessionName = this.extractSessionName(cmdLine, cwd, name);

          const terminalPid = await this.findTerminalPid(parseInt(pid), parseInt(parentPid) || 0);
          tasks.push({
            pid: parseInt(pid),
            parentPid: parseInt(parentPid) || 0,
            terminalPid: terminalPid,
            name: sessionName,
            cwd: cwd,
            commandLine: cmdLine.substring(0, 500),
          });
        }

        resolve(tasks);
      });
    });
  }

  extractSessionName(cmdLine, cwd, processName) {
    const promptMatch = cmdLine.match(/--prompt\s+["']?([^"']+)/);
    if (promptMatch) return promptMatch[1].substring(0, 50);

    // Use working directory name as session name
    const dirName = path.basename(cwd);
    return dirName;
  }

  async checkCompletion(task) {
    if (task.pid === 0) return false;
    return new Promise((resolve) => {
      exec(`tasklist /FI "PID eq ${task.pid}" /NH 2>nul`, { timeout: 3000 }, (err, stdout) => {
        if (err) { resolve(true); return; }
        resolve(!stdout.includes(`${task.pid}`));
      });
    });
  }

  async readConversation(task) {
    const claudeDir = path.join(os.homedir(), '.claude');
    const possiblePaths = [];

    if (fs.existsSync(claudeDir)) {
      try {
        const entries = fs.readdirSync(claudeDir);
        for (const entry of entries) {
          const full = path.join(claudeDir, entry);
          try {
            if (fs.statSync(full).isDirectory() && entry !== 'plugins' && entry !== 'node_modules') {
              const convDir = path.join(full, 'conversations');
              if (fs.existsSync(convDir)) possiblePaths.push(convDir);
            }
          } catch (e) { /* ignore */ }
          if (entry.endsWith('.jsonl')) possiblePaths.push(full);
          if (entry === 'history.jsonl') possiblePaths.push(full);
        }
      } catch (e) { /* ignore */ }
    }

    // Check project-local .claude
    if (task.cwd) {
      const localClaude = path.join(task.cwd, '.claude');
      if (fs.existsSync(localClaude)) possiblePaths.push(localClaude);
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
          } catch (e) { /* skip */ }
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

  // Focus the CMD/console window for this session
  async focusSessionWindow(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pid) { console.log('[Focus] No session for', sessionId); return false; }
    const targetPid = session.pid;
    const parentPid = session.parentPid || 0;
    const terminalPid = session.terminalPid || parentPid || targetPid;
    console.log('[Focus] sessionId=' + sessionId + ' targetPid=' + targetPid + ' parentPid=' + parentPid + ' terminalPid=' + terminalPid + ' cwd=' + (session.cwd || ''));
    try {
      const psScript = `powershell -NoProfile -Command "
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
function Try-Focus([int]\$pid) {
  if (-not \$pid -or \$pid -eq 0) { Write-Output \"skip: pid=0\"; return \$false }
  \$p = Get-Process -Id \$pid -ErrorAction SilentlyContinue
  if (-not \$p) { Write-Output \"no process: \$pid\"; return \$false }
  \$h = \$p.MainWindowHandle
  Write-Output \"check: \$pid name=\$(\$p.ProcessName) handle=\$h visible=\$([WinFocus]::IsWindowVisible(\$h))\"
  if (\$h -ne [IntPtr]::Zero -and [WinFocus]::IsWindowVisible(\$h)) {
    [WinFocus]::ShowWindow(\$h, 9) | Out-Null
    Start-Sleep -Milliseconds 80
    [WinFocus]::SetForegroundWindow(\$h) | Out-Null
    Write-Output \"focused: \$pid\"
    return \$true
  }
  return \$false
}
\$terminalPid = ${terminalPid}
\$parentPid = ${parentPid}
\$targetPid = ${targetPid}
Write-Output \"terminal=\$terminalPid parent=\$parentPid target=\$targetPid\"
if (Try-Focus \$terminalPid) { exit 0 }
if (\$parentPid -ne \$terminalPid -and (Try-Focus \$parentPid)) { exit 0 }
if (\$targetPid -ne \$terminalPid -and \$targetPid -ne \$parentPid -and (Try-Focus \$targetPid)) { exit 0 }
\$current = \$terminalPid
for (\$i = 0; \$i -lt 5; \$i++) {
  if (-not \$current -or \$current -eq 0) { break }
  \$proc = Get-CimInstance Win32_Process -Filter \"ProcessId=\$current\" -ErrorAction SilentlyContinue
  if (-not \$proc) { break }
  \$current = [int]\$proc.ParentProcessId
  if (Try-Focus \$current) { exit 0 }
}
exit 1
\""`;
      const { exec } = require('child_process');
      return await new Promise((resolve) => {
        exec(psScript, { timeout: 10000 }, (err, stdout, stderr) => {
          if (stdout) console.log('[Focus stdout]', stdout.trim());
          if (stderr) console.log('[Focus stderr]', stderr.trim());
          if (err) console.error('[Focus] FAILED for', sessionId, err.message);
          else console.log('[Focus] OK for', sessionId);
          resolve(!err);
        });
      });
    } catch (e) {
      console.error('[Focus] exception:', e.message);
      return false;
    }
  }

  async sendToSession(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (!session.messages) session.messages = [];
    session.messages.push({
      role: 'user', content: message, timestamp: new Date().toISOString(),
    });
    session.lastActivity = new Date().toISOString();

    const targetPid = session.pid;
    const parentPid = session.parentPid || 0;
    const terminalPid = session.terminalPid || parentPid || targetPid;
    const escapedMsg = message.replace(/'/g, "''");

    const psScript = `powershell -NoProfile -Command "
Add-Type -AssemblyName System.Windows.Forms;
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinSend {
  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
function Try-Focus([int]\$pid) {
  if (-not \$pid -or \$pid -eq 0) { return \$false }
  \$p = Get-Process -Id \$pid -ErrorAction SilentlyContinue
  if (-not \$p) { return \$false }
  if (\$p.MainWindowHandle -ne [IntPtr]::Zero -and [WinSend]::IsWindowVisible(\$p.MainWindowHandle)) {
    [WinSend]::ShowWindow(\$p.MainWindowHandle, 9) | Out-Null
    Start-Sleep -Milliseconds 80
    [WinSend]::SetForegroundWindow(\$p.MainWindowHandle) | Out-Null
    return \$true
  }
  return \$false
}
\$terminalPid = ${terminalPid}
\$parentPid = ${parentPid}
\$targetPid = ${targetPid}
\$focused = Try-Focus \$terminalPid
if (-not \$focused -and \$parentPid -ne \$terminalPid) { \$focused = Try-Focus \$parentPid }
if (-not \$focused -and \$targetPid -ne \$terminalPid -and \$targetPid -ne \$parentPid) { \$focused = Try-Focus \$targetPid }
if (-not \$focused) {
  \$current = \$terminalPid
  for (\$i = 0; \$i -lt 5; \$i++) {
    if (-not \$current -or \$current -eq 0) { break }
    \$proc = Get-CimInstance Win32_Process -Filter \"ProcessId=\$current\" -ErrorAction SilentlyContinue
    if (-not \$proc) { break }
    \$current = [int]\$proc.ParentProcessId
    \$focused = Try-Focus \$current
    if (\$focused) { break }
  }
}
if (\$focused) {
  Start-Sleep -Milliseconds 150;
  [System.Windows.Forms.Clipboard]::SetText('${escapedMsg}');
  Start-Sleep -Milliseconds 50;
  [System.Windows.Forms.SendKeys]::SendWait('^v');
  Start-Sleep -Milliseconds 100;
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
  Write-Output 'sent'
} else {
  Write-Output 'no-window'
}
"`;
    const { exec } = require('child_process');
    return await new Promise((resolve) => {
      exec(psScript, { timeout: 10000 }, (err, stdout, stderr) => {
        if (stdout) console.log('[Send]', stdout.trim(), 'sessionId=' + sessionId);
        if (stderr) console.error('[Send stderr]', stderr.trim());
        if (err) console.error('[Send] FAILED for', sessionId, err.message);
        this.emit('sessions-updated', this.getSessions());
        resolve(!err);
      });
    });
  }
}

module.exports = { SessionMonitor };
