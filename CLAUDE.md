# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project overview

CC Island is a Windows desktop "Dynamic Island" (灵动岛) widget for Claude Code. A floating pill-shaped overlay sits on the desktop (always-on-top), monitors all local Claude Code CMD sessions in real time, and provides WeChat-based remote control via QR code.

**Tech stack:** Electron 40.9.3 + React 18 + Vite 5 (renderer), Express + Socket.IO (local server), Python wxauto (WeChat bridge), electron-builder 25.1.8 (packaging).

## Essential commands

```bash
# Build React frontend only
npm run build

# Full build: Vite + electron-builder NSIS installer
npm run electron:build

# Dev mode (Vite dev server + Electron)
npm run electron:dev

# Preview without packaging (build then run electron)
npm run electron:preview
```

**Electron binary mirror** (required in China):
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

**Output:** Installer at `release\CC Island Setup 1.0.0.exe`, portable at `release\win-unpacked\CC Island.exe`.

## Architecture

```
Electron Main Process (electron/main.js)
  ├── IslandWindow — frameless, transparent, always-on-top floating pill
  ├── SessionList Window — expandable panel shown on click
  ├── SystemTray (electron/tray.js) — tray icon + context menu
  ├── SessionMonitor (electron/session-monitor.js)
  │     PowerShell/WMIC scan for real Claude processes every 5s
  │     Uses CWD-hash as session key (not PID) to prevent duplicates
  ├── WechatBridge (electron/wechat-bridge.js)
  │     Spawns Python wxauto subprocess, manages WeChat message relay
  └── LocalServer (electron/local-server.js)
        Express + Socket.IO, REST API, SSH tunnel (serveo.net) for public URL

IPC: preload.js → contextBridge → window.ccIsland API

Renderer (src/ via Vite → dist/)
  App.jsx — hash-based view router, session state, notification sounds
  DynamicIsland.jsx — pill UI with mousedown/mouseup drag-vs-click detection
  SessionList.jsx — filter/search bar, session cards
  SessionCard.jsx — expandable session detail with message input
  QRCodeModal.jsx — QR code display + tunnel start/stop toggle

Python (python/wechat_bridge.py)
  wxauto UIAutomation for WeChat PC control, falls back to stub mode
```

### Key design decisions

- **Drag vs click**: Island window body is `-webkit-app-region: drag` for moving. Session list window body is `-webkit-app-region: no-drag` so all interactive elements work. `App.jsx` sets this dynamically based on `window.location.hash`.
- **Session dedup**: CWD-hash as session key (one Claude session = one working directory, regardless of how many child processes it spawns).
- **Process detection**: PowerShell `Get-CimInstance Win32_Process` filters for `@anthropic-ai/claude-code` / `claude-code` in command line. Excludes CC Island's own electron process.
- **Public tunnel**: SSH reverse tunnel via `serveo.net`. QR codes auto-switch between LAN and public URLs.
- **Notification sounds**: Web Audio API generates tones — C-E-G chord for completion, triangle wave for new session, square wave for errors.

## Critical constraints

- **electron-builder is pinned to v25.1.8**. v26.x uses a Go-based app-builder that ignores the local NSIS cache and requires GitHub access for NSIS downloads.
- **NSIS cache**: `%LOCALAPPDATA%\electron-builder\Cache\nsis\` must contain `nsis-3.0.4.1.7z` and `nsis-resources-3.4.1.7z`.
- Windows-only (transparent frameless windows, PowerShell/WMIC, wxauto UIAutomation).
- All operations within `E:\我的项目\agent\cc-island\`.

## User preferences

1. After fixing bugs, auto-launch `release\win-unpacked\CC Island.exe` for testing.
2. Read bugs from `bug.md`, fix them, track completion in `task.md`.
3. Commit git at appropriate intervals after meaningful changes.
4. `bug.md` is the user's scratchpad — do NOT reformat, restructure, or modify format. Only read bugs from it.
5. Play completion sound via Web Audio API after finishing tasks.
6. Make all decisions autonomously — do not ask the user for approval.
