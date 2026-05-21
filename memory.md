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

### 7. setBounds 替代 setPosition 防窗口大小变化
- `win.setPosition(x, y)` 在 Electron 中可能触发 resize，导致窗口大小抖动
- 应使用 `win.setBounds({ x, y, width: w, height: h })` 保持尺寸不变

### 8. Windows 进程 MainWindowHandle 可能为 0
- 控制台程序 (cmd.exe, node.exe) 的 MainWindowHandle 常为零
- 需通过父进程或子进程窗口树查找可聚焦的窗口
- SendKeys 是模拟键盘输入的最可靠方式

### 9. 公网隧道应多服务 fallback
- serveo.net 在中国大陆访问不稳定
- 按优先级依次尝试: bore.pub (HTTP), localhost.run (SSH), serveo.net (SSH)
- SSH 连接设置超时 (ConnectTimeout=10) 防卡死

### 10. iLink Bot API 是微信官方合法通道
- 2026年3月腾讯开放 `ilinkai.weixin.qq.com` 个人号 Bot API
- 支持 WebSocket 长连接 + HTTP 轮询双模式
- 替代之前的逆向/Hook灰色方案

### 11. CSS hover transform 会在拖拽时造成视觉抖动
- `transform: scale(1.02)` 在 hover 时触发，拖拽过程中鼠标在元素上反复触发
- 解决：拖拽时添加 `.dragging` class，用 `:not(.dragging)` 排除 hover 缩放
- `.dynamic-island:hover:not(.dragging) { transform: scale(1.02); }`

### 12. local-server.js 中不能定义同名方法
- ES class 中后定义的同名方法会覆盖前面的
- 两个 `startTunnel` 方法导致多服务 fallback 逻辑丢失
- 用 tryTunnel/tryBoreTunnel/trySSHTunnel 拆分替代重复定义

### 14. 每次测试必须完整流程：杀进程 → 构建 → 提示音 → 启动

- 旧进程会锁住 `release\win-unpacked\CC Island.exe` 导致构建失败
- 只杀本项目路径下的进程，不能影响用户其他目录的 CC Island 实例
- 启动必须用 `release\win-unpacked\CC Island.exe`（打包版），不是 `npm run electron:preview`

```bash
wmic process where "commandline like '%cc-island%'" delete
npm run electron:build
# 提示音
start "" "release\win-unpacked\CC Island.exe"
```

### 15. 微信消息链路必须完整连接

- Python 桥接输出 `MESSAGE:{json}` → Electron 解析 → emit 事件 → main.js 转发
- 每个环节都要显式连接，否则消息静默丢失
- 公网路径：手机 → Socket.IO → localServer → sessionMonitor → SendKeys

### 16. app.asar 孤儿文件锁：可写不可删时不要死磕

- `app-builder.exe` 崩溃后可能留下孤儿文件句柄，锁住 `release\win-unpacked\resources\app.asar`
- **诊断特征：** 文件可读、可覆盖写入，但不可删除/重命名 → `FILE_SHARE_DELETE` 缺失的删除锁
- **错误做法：** 反复尝试 `rm`、`Remove-Item`、`MoveFileEx`、`cmd /c del` → 全部徒劳
- **正确做法：**
  1. 创建临时 yml 配置覆盖 `directories.output` 为新目录（如 `release-temp`）
  2. 用 `npx electron-builder -c temp.yml` 构建到临时目录
  3. 用 `[System.IO.File]::WriteAllBytes()` 把新 `app.asar` 覆盖写入被锁文件
  4. 将其余产物从临时目录复制回 `release`
  5. 清理临时目录和配置文件
- **治本：** 重启电脑释放孤儿句柄；正常流程中杀进程（#14）可预防
- **注意：** `electron-builder -c` 是**替换**配置而非深度合并，临时 yml 需包含所有必要字段（productName、win、nsis 等），否则产物命名回退到 npm `name` 字段

### 17. 禁止用 `npx asar pack dist` 更新 app.asar

- `npx asar pack dist app.asar` 只包含 `dist/` 目录，覆盖后 Electron 找不到 `electron/main.js`、`node_modules`、`package.json`，应用无法启动
- app.asar 必须包含完整的 `files` 配置：dist + electron + python + mobile + assets + node_modules + package.json
- **正确做法：** 始终用 `electron-builder` 完整构建 app.asar，用覆盖写入方式更新被锁文件

### 18. 打包后 console.log/error/warn 会导致 EBADF 崩溃

- Electron 打包后无终端 attached，`stdout`/`stderr` 文件描述符无效（bad file descriptor）
- `console.log()` 等调用会抛出 `EBADF: bad file descriptor, write` 异常导致进程崩溃
- **解决：** 在 `main.js` 最顶部（所有 require 之前）覆盖 console 方法，加 try-catch

```js
const _log = console.log.bind(console);
const _error = console.error.bind(console);
const _warn = console.warn.bind(console);
console.log = (...args) => { try { _log(...args); } catch (e) {} };
console.error = (...args) => { try { _error(...args); } catch (e) {} };
console.warn = (...args) => { try { _warn(...args); } catch (e) {} };
```

### 19. 动画回调中的竞态条件 — 状态变更前必须校验

- `collapse-animation-done` IPC 回调中直接缩小窗口尺寸，但用户可能在动画期间又展开了
- **错误：** 回调中无脑执行缩小，导致窗口在展开后又缩回去
- **正确：** 回调开始时检查 `isIslandExpanded`，若已为 `true` 则 `return` 跳过

```js
ipcMain.handle('collapse-animation-done', () => {
  if (isIslandExpanded) return; // 动画期间用户又展开了，放弃缩小
  // ...缩小窗口
});
```

### 20. 根容器 user-select: none 会阻断所有子元素文字选择

- `.dynamic-island { user-select: none }` 使整个灵动岛内文字不可选，包括消息内容
- **解决：** 在需要选择的子元素上显式设置 `user-select: text; cursor: text`（消息列表、输入框）

### 21. React 多 tab 输入框状态隔离

- 切换 tab 时输入框内容应各自保留，使用对象 map `const [inputValues, setInputValues] = useState({})`
- 读取：`inputValues[selectedId] || ''`
- 写入：`setInputValues(prev => ({ ...prev, [id]: value }))`
- 切换 tab 后自动 `inputRef.current?.focus()` 聚焦输入框

### 22. Tab 键切换会话的方式

- 容器 div 设 `tabIndex={-1}` 使其可接收键盘事件
- `onKeyDown` 中拦截 Tab：`e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1)`
- 点击侧边栏时 `containerRef.current?.focus()` 确保键盘事件可达
- 同时保留 click 点击切换，两种方式并存

### 23. 浅色主题颜色避免硬编码淡色值

- 硬编码的淡色（如 `#c7d2fe` 浅紫）在暗色主题可见，但在浅色主题下与白底对比度不足
- **原则：** 所有主题敏感的颜色都使用 CSS 变量，`[data-theme="light"]` 覆盖
- accent 颜色在浅色主题需要略加深（如 `#6366f1` → `#4f46e5`）以保证白底上可读

### 24. useEffect 中引用的变量必须在使用前声明

- `const` 变量存在暂时性死区（TDZ），在声明前访问会抛出 `ReferenceError`，导致整个组件崩溃白屏
- Vite 构建不会报错（只做语法检查），运行时才会炸
- **典型错误：**
```js
// ❌ useEffect 在 recentMessages 声明之前引用它
useEffect(() => { ... }, [recentMessages.length]);
const recentMessages = ...;

// ✅ 把 useEffect 移到变量声明之后
const recentMessages = ...;
useEffect(() => { ... }, [recentMessages.length]);
```
- **教训：** 写完代码后检查所有 useEffect 的依赖数组，确保引用的变量都在 useEffect 之前声明

### 25. Claude 进程检测需兼容 uv/pipx 等非 npm 安装方式

- npm 安装：命令行包含 `@anthropic-ai/claude-code` 或 `claude-code`
- uv/pipx 安装（如 `C:\Users\Administrator\.local\bin\claude.exe`）：命令行可能只是 `claude.exe`，没有完整路径前缀
- **问题：** 旧的正则 `[\\\\/]claude(\\\\.exe)?[" ]` 要求路径分隔符在 `claude` 前面，不匹配独立的 `claude.exe` 进程名
- **修复：** 新增 `elseif ($p.Name -eq 'claude.exe') { $isClaude = $true }` 和命令行匹配 `'^claude(\\\\.exe)?[" ]'`（行首匹配）
- WMIC fallback 同步修复：`name === 'claude.exe'` 直接判定为 Claude 进程
