# Memory — Lessons Learned & Mistakes To Avoid

> 每个坑只踩一次。在此记录所有经验教训。

---

## 🚫 禁止再犯的错误

### 1. `exec` 回调内使用 `await` 必须加 `async`
- `child_process.exec(cmd, (err, out) => { await ... })` ← 回调缺少 `async`
- 正确: `child_process.exec(cmd, async (err, out) => { await ... })`
- 后果: 语法错误导致整个 Node.js 模块加载失败，应用崩溃灰屏

### 2. `-webkit-app-region: drag` 会拦截所有 DOM 事件
- Electron 中设置 drag 后，鼠标事件被 OS 窗口管理器拦截，React 的 onClick/onMouseDown 无法触发
- 解决方案: 使用纯 JS 拖拽（mousedown → mousemove → IPC moveWindow → mouseup）
- 不在 CSS 中设置 `-webkit-app-region`，用 JS 控制一切

### 3. AudioContext 默认 suspend
- Electron/Chromium 中 AudioContext 创建后处于 `suspended` 状态
- 必须在第一次用户交互（mousedown）后 `audioCtx.resume()`
- 否则所有 Web Audio API 声音都不会播放

### 4. 打包后的 app 不能写日志到 asar 内
- asar 是只读归档，fs.writeFile 到 asar 路径会静默失败
- 日志应写到 `app.getPath('userData')` 或已知可写目录

### 5. electron-builder v26 的 Go app-builder 不认本地 NSIS 缓存
- v26 使用 Go 二进制处理 NSIS，强制从 GitHub 下载 nsis-3.0.4.1.7z
- 本地 `%LOCALAPPDATA%\electron-builder\Cache\nsis\` 对它无效
- **必须锁定 v25.1.8**（JS 版本，认本地缓存）

### 6. session 去重用 CWD 而非 PID
- Claude Code 会 fork 多个子进程，每个有不同 PID
- 用 PID 作 key 会导致同一会话出现多个重复条目
- 用 `md5(cwd)` 作 key，一个工作目录 = 一个会话

---

## ✅ 正确模式

### 进程检测
- 用 PowerShell `Get-CimInstance Win32_Process` 过滤 `@anthropic-ai/claude-code`
- 排除自身进程（`cc-island`/`CC Island`）
- 排除 PowerShell 自身命令（`Get-CimInstance`/`Select-Object`）

### 窗口拖拽
```js
// renderer: mousedown 记录起点，mousemove 计算 delta 发送 IPC
window.ccIsland.moveWindow(dx, dy);
// main: 接收 delta 移动窗口
ipcMain.on('move-window', (event, dx, dy) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.setPosition(win.getPosition()[0] + dx, win.getPosition()[1] + dy);
});
```

### NSIS 安装包
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run electron:build  # electron-builder@25.1.8
```
- 需预下载 `nsis-3.0.4.1.7z` 和 `nsis-resources-3.4.1.7z` 到 `%LOCALAPPDATA%\electron-builder\Cache\nsis\`

### 蜂鸣通知
- 使用 Web Audio API 生成音调，无需外部音频文件
- 必须在首次 mousedown 时 resume AudioContext
