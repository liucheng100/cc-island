# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作提供指引。

---

## 项目概述

CC Island 是一个 Windows 桌面"灵动岛"小组件，用于 Claude Code。一个浮动药丸形悬浮窗始终置顶在桌面上，实时监控所有本地 Claude Code CMD 会话，并通过二维码提供微信远程控制功能。

**技术栈：** Electron 40.9.3 + React 18 + Vite 5（渲染进程）、Express + Socket.IO（本地服务器）、Python wxauto（微信桥接）、electron-builder 25.1.8（打包）。

## 常用命令

```bash
# 仅构建 React 前端
npm run build

# 完整构建：Vite + electron-builder NSIS 安装包
npm run electron:build

# 开发模式（Vite 开发服务器 + Electron）
npm run electron:dev

# 预览模式（构建后直接运行 electron，不打包）
npm run electron:preview
```

**Electron 镜像**（国内必需）：
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

**输出：** 安装包在 `release\CC Island Setup 1.0.0.exe`，便携版在 `release\win-unpacked\CC Island.exe`。

## 架构

```
Electron 主进程 (electron/main.js)
  ├── IslandWindow — 无边框、透明、始终置顶的浮动药丸窗
  ├── SessionList Window — 点击后展开的会话面板
  ├── SystemTray (electron/tray.js) — 托盘图标 + 右键菜单
  ├── SessionMonitor (electron/session-monitor.js)
  │     每5秒用 PowerShell/WMIC 扫描真实 Claude 进程
  │     用 CWD 哈希作为会话 key（非 PID）防重复
  ├── WechatBridge (electron/wechat-bridge.js)
  │     启动 Python wxauto 子进程，管理微信消息转发
  │     备选：wechat-ilink.js 使用 iLink Bot API（腾讯官方通道）
  └── LocalServer (electron/local-server.js)
        Express + Socket.IO、REST API、SSH 隧道 (serveo.net) 提供公网 URL

IPC：preload.js → contextBridge → window.ccIsland API

渲染进程 (src/ 经 Vite → dist/)
  App.jsx — 哈希路由、会话状态管理、通知音效
  DynamicIsland.jsx — 药丸 UI，mousedown/mouseup 区分拖拽与点击
  SessionList.jsx — 搜索筛选栏、会话卡片列表
  SessionCard.jsx — 可展开的会话详情，含消息输入框
  QRCodeModal.jsx — 二维码显示 + 隧道启停开关
  StatusIndicator.jsx — 会话状态徽章（工作中/思考中/已完成/错误）

Python (python/wechat_bridge.py)
  wxauto UIAutomation 控制微信 PC 端，失败时回退到 stub 模式
```

### 关键设计决策

- **拖拽 vs 点击：** 灵动岛窗口使用纯 JS 拖拽（mousedown → mousemove → IPC `moveWindow` → mouseup）。不用 `-webkit-app-region: drag`，因为它会拦截所有 DOM 事件导致 React 处理器失效。会话列表窗口使用 `-webkit-app-region: no-drag` 保证交互元素可用。`App.jsx` 根据 `window.location.hash` 动态切换。
- **会话去重：** 用 CWD 哈希作为会话 key（一个工作目录 = 一个会话，不管 fork 多少子进程）。
- **进程检测：** PowerShell `Get-CimInstance Win32_Process` 过滤 `@anthropic-ai/claude-code` / `claude-code` 命令行，排除 CC Island 自身进程。
- **公网隧道：** 通过 `serveo.net` 建立 SSH 反向隧道。二维码自动在局域网和公网 URL 间切换。
- **通知音效：** Web Audio API 生成音调 — C-E-G 和弦表示完成，三角波表示新会话，方波表示错误。AudioContext 初始为 `suspended` 状态，必须在首次用户交互时 `resume()`。
- **窗口定位：** 使用 `win.setBounds()` 而非 `win.setPosition()` — 后者会触发 resize 导致窗口大小抖动。

## 关键约束

- **electron-builder 锁定 v25.1.8**。v26.x 使用 Go 版 app-builder，会忽略本地 NSIS 缓存，强制从 GitHub 下载。
- **NSIS 缓存：** `%LOCALAPPDATA%\electron-builder\Cache\nsis\` 必须包含 `nsis-3.0.4.1.7z` 和 `nsis-resources-3.4.1.7z`。
- 仅限 Windows（透明无边框窗口、PowerShell/WMIC、wxauto UIAutomation）。
- 所有操作在 `E:\我的项目\agent\cc-island\` 内进行。

## 用户偏好
1. memory.md是经验教训，你每次对话需要按照里面的记忆做，已经犯过的错不能再犯了，同时你需要把本次对话所有踩过的坑都记录进去，有价值的经验也要记录进去
2. 从 `bug.md` 读取 bug，修复后在 `task.md` 中跟踪进度。
3. 在有意义的变更后适时提交 git。
4. `bug.md` 是用户的便签本 — 不要重新排版、重构或修改其格式，只从中读取 bug。
5. 每次完成任务我会在终端播放提示音。
6. 每次完成任务后自动启动 `release\win-unpacked\CC Island.exe` 进行测试。
7. 自主决策 — 不需要向用户请示。
8. 用中文交流。
9. 按照 bug.md 的顺序解决 bug。
