const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// Window APIs
const ShowWindow = user32.func('bool ShowWindow(void* hWnd, int nCmdShow)');
const ShowWindowAsync = user32.func('bool ShowWindowAsync(void* hWnd, int nCmdShow)');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(void* hWnd)');
const BringWindowToTop = user32.func('bool BringWindowToTop(void* hWnd)');
const IsIconic = user32.func('bool IsIconic(void* hWnd)');
const GetForegroundWindow = user32.func('void* GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void* hWnd, void* lpdwProcessId)');
const SwitchToThisWindow = user32.func('void SwitchToThisWindow(void* hWnd, bool fAltTab)');
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, void* dwExtraInfo)');
const VkKeyScanW = user32.func('int16 VkKeyScanW(uint16 ch)');
const GetStdHandle = kernel32.func('void* GetStdHandle(int32 nStdHandle)');
const WriteConsoleInputW = kernel32.func('bool WriteConsoleInputW(void* hConsoleInput, void* lpBuffer, uint32 nLength, uint32* lpNumberOfEventsWritten)');
const CreateFileW = kernel32.func('void* CreateFileW(string16 lpFileName, uint32 dwDesiredAccess, uint32 dwShareMode, void* lpSecurityAttributes, uint32 dwCreationDisposition, uint32 dwFlagsAndAttributes, void* hTemplateFile)');
const FindWindowW = user32.func('void* FindWindowW(void* lpClassName, string16 lpWindowName)');
const GetWindowTextW = user32.func('int GetWindowTextW(void* hWnd, string16 lpString, int nMaxCount)');
const SetWindowPos = user32.func('bool SetWindowPos(void* hWnd, void* hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)');
const SendMessageW = user32.func('void* SendMessageW(void* hWnd, uint32 Msg, void* wParam, void* lParam)');
const GetWindowPlacement = user32.func('bool GetWindowPlacement(void* hWnd, void* lpwndpl)');
const SetWindowPlacement = user32.func('bool SetWindowPlacement(void* hWnd, void* lpwndpl)');

// Console APIs
const AttachConsole = kernel32.func('bool AttachConsole(uint32 dwProcessId)');
const FreeConsole = kernel32.func('bool FreeConsole()');
const GetConsoleWindow = kernel32.func('void* GetConsoleWindow()');
const GenerateConsoleCtrlEvent = kernel32.func('bool GenerateConsoleCtrlEvent(uint32 dwCtrlEvent, uint32 dwProcessGroupId)');
const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()');

// Useful constants
const SW_HIDE = 0;
const SW_SHOWNORMAL = 1;
const SW_SHOWMINIMIZED = 2;
const SW_SHOWMAXIMIZED = 3;
const SW_SHOW = 5;
const SW_MINIMIZE = 6;
const SW_SHOWMINNOACTIVE = 7;
const SW_SHOWNA = 8;
const SW_RESTORE = 9;
const SW_SHOWDEFAULT = 10;
const SW_FORCEMINIMIZE = 11;
const STD_INPUT_HANDLE = -10;

// HWND special values: pass as BigInt to void* params
const HWND_TOPMOST = -1n;
const HWND_NOTOPMOST = -2n;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_SHOWWINDOW = 0x0040;

const WM_SYSCOMMAND = 0x0112;
const SC_RESTORE = 0xF120;
const SC_MAXIMIZE = 0xF030;

/**
 * Get the console window handle for a given terminal PID.
 * Attaches to the process console, gets the window handle, then detaches.
 */
function getConsoleWindowForPid(pid) {
  if (!pid || pid === 0) return null;
  try {
    FreeConsole();
    // Small delay needed between FreeConsole and AttachConsole
    const start = Date.now();
    while (Date.now() - start < 30) { /* spin */ }

    if (!AttachConsole(pid)) return null;

    const start2 = Date.now();
    while (Date.now() - start2 < 80) { /* spin */ }

    const hwnd = GetConsoleWindow();
    FreeConsole();
    return hwnd || null;
  } catch (e) {
    try { FreeConsole(); } catch (e2) {}
    return null;
  }
}

/**
 * Aggressively restore and focus a window, even if minimized.
 * Uses multiple strategies: SetWindowPlacement, WM_SYSCOMMAND, SwitchToThisWindow.
 */
function forceRestoreAndFocus(hwnd) {
  if (!hwnd) return false;

  // Strategy 1: SetWindowPlacement — proper restore from minimized
  // WINDOWPLACEMENT struct (44 bytes)
  const wp = Buffer.alloc(44);
  wp.writeUInt32LE(44, 0); // length
  GetWindowPlacement(hwnd, wp);
  const showCmd = wp.readUInt32LE(8); // offset 8 = showCmd

  if (showCmd === SW_SHOWMINIMIZED || showCmd === SW_MINIMIZE || IsIconic(hwnd)) {
    wp.writeUInt32LE(SW_SHOWNORMAL, 8); // set showCmd = SW_SHOWNORMAL
    SetWindowPlacement(hwnd, wp);
    // Spin-wait for window to restore
    const start = Date.now();
    while (Date.now() - start < 300) { /* spin */ }
  }

  // Strategy 2: System command restore
  SendMessageW(hwnd, WM_SYSCOMMAND, BigInt(SC_RESTORE), null);
  const start2 = Date.now();
  while (Date.now() - start2 < 150) { /* spin */ }

  // Strategy 3: SwitchToThisWindow — bypasses foreground lock
  SwitchToThisWindow(hwnd, false);
  const start3 = Date.now();
  while (Date.now() - start3 < 100) { /* spin */ }

  // Strategy 4: Temporary TOPMOST to bring above always-on-top windows
  SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
  const start4 = Date.now();
  while (Date.now() - start4 < 80) { /* spin */ }
  SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

  BringWindowToTop(hwnd);
  return true;
}

/**
 * Type text via simulated keystrokes (Ctrl+V paste + Enter).
 * Requires the target window to have focus.
 */
function typeTextViaPaste(text) {
  const VK_CONTROL = 0x11;
  const VK_V = 0x56;
  const VK_RETURN = 0x0D;
  const KEYEVENTF_KEYUP = 0x0002;

  // Ctrl down
  keybd_event(VK_CONTROL, 0, 0, null);
  // V down
  keybd_event(VK_V, 0, 0, null);
  // V up
  keybd_event(VK_V, 0, KEYEVENTF_KEYUP, null);
  // Ctrl up
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, null);

  // Brief delay
  const start = Date.now();
  while (Date.now() - start < 50) { /* spin */ }

  // Enter
  keybd_event(VK_RETURN, 0, 0, null);
  keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, null);
}

/**
 * Write text directly to a console's input buffer via WriteConsoleInputW.
 * This does NOT require window focus — works even when minimized.
 * Types only the characters, does NOT send Enter.
 * @param {number} pid - Terminal process PID
 * @param {string} text - Text to type
 * @returns {boolean} success
 */
function writeConsoleInput(pid, text) {
  if (!pid || pid === 0) return false;
  try {
    FreeConsole();
    let s = Date.now(); while (Date.now() - s < 30) {}

    if (!AttachConsole(pid)) {
      FreeConsole();
      return false;
    }

    s = Date.now(); while (Date.now() - s < 80) {}

    const GENERIC_READ = 0x80000000; const GENERIC_WRITE = 0x40000000;
    const FILE_SHARE_READ = 1; const FILE_SHARE_WRITE = 2;
    const OPEN_EXISTING = 3;

    const coninHandle = CreateFileW('CONIN$',
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      null, OPEN_EXISTING, 0, null);

    if (!coninHandle || coninHandle === -1n) {
      FreeConsole();
      return false;
    }

    const chars = text;
    const recordCount = chars.length * 2; // keydown+keyup per char
    const buf = Buffer.alloc(recordCount * 20);

    let idx = 0;
    const writeRecord = (keyDown, vkCode, unicodeChar, scanCode = 0) => {
      const off = idx * 20;
      buf.writeUInt16LE(1, off);
      buf.writeInt32LE(keyDown ? 1 : 0, off + 4);
      buf.writeUInt16LE(1, off + 8);
      buf.writeUInt16LE(vkCode, off + 10);
      buf.writeUInt16LE(scanCode, off + 12);
      buf.writeUInt16LE(unicodeChar, off + 14);
      buf.writeUInt32LE(0, off + 16);
      idx++;
    };

    for (const ch of chars) {
      const code = ch.charCodeAt(0);
      writeRecord(true, 0, code);
      writeRecord(false, 0, code);
    }

    const writtenBuf = Buffer.alloc(4);
    const result = WriteConsoleInputW(coninHandle, buf, recordCount, writtenBuf);
    const written = writtenBuf.readUInt32LE(0);

    FreeConsole();
    return result && written > 0;
  } catch (e) {
    try { FreeConsole(); } catch (e2) {}
    return false;
  }
}

/**
 * Send a single Enter key to a console via WriteConsoleInputW.
 */
function sendEnterToConsole(pid) {
  if (!pid || pid === 0) return false;
  try {
    FreeConsole();
    let s = Date.now(); while (Date.now() - s < 30) {}

    if (!AttachConsole(pid)) {
      FreeConsole();
      return false;
    }

    s = Date.now(); while (Date.now() - s < 80) {}

    const GENERIC_READ = 0x80000000; const GENERIC_WRITE = 0x40000000;
    const FILE_SHARE_READ = 1; const FILE_SHARE_WRITE = 2;
    const OPEN_EXISTING = 3;

    const coninHandle = CreateFileW('CONIN$',
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      null, OPEN_EXISTING, 0, null);

    if (!coninHandle || coninHandle === -1n) {
      FreeConsole();
      return false;
    }

    const buf = Buffer.alloc(2 * 20);
    const writeRecord = (keyDown, off) => {
      buf.writeUInt16LE(1, off);
      buf.writeInt32LE(keyDown ? 1 : 0, off + 4);
      buf.writeUInt16LE(1, off + 8);
      buf.writeUInt16LE(0x0D, off + 10);
      buf.writeUInt16LE(0x1C, off + 12);
      buf.writeUInt16LE(13, off + 14);
      buf.writeUInt32LE(0, off + 16);
    };
    writeRecord(true, 0);   // Enter keydown
    writeRecord(false, 20); // Enter keyup

    const writtenBuf = Buffer.alloc(4);
    const result = WriteConsoleInputW(coninHandle, buf, 2, writtenBuf);
    const written = writtenBuf.readUInt32LE(0);

    FreeConsole();
    return result && written > 0;
  } catch (e) {
    try { FreeConsole(); } catch (e2) {}
    return false;
  }
}

/**
 * Clear existing input in a console by selecting all (Ctrl+A) and deleting (Backspace).
 * Uses WriteConsoleInputW with ctrlState modifier — doesn't kill the console.
 * @param {number} pid - Terminal process PID
 * @returns {boolean} success
 */
function clearConsoleInput(pid) {
  if (!pid || pid === 0) return false;
  try {
    FreeConsole();
    let s = Date.now(); while (Date.now() - s < 30) {}

    if (!AttachConsole(pid)) {
      FreeConsole();
      return false;
    }

    s = Date.now(); while (Date.now() - s < 80) {}

    const GENERIC_READ = 0x80000000; const GENERIC_WRITE = 0x40000000;
    const FILE_SHARE_READ = 1; const FILE_SHARE_WRITE = 2;
    const OPEN_EXISTING = 3;
    const LEFT_CTRL_PRESSED = 0x0008;

    const coninHandle = CreateFileW('CONIN$',
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      null, OPEN_EXISTING, 0, null);

    if (!coninHandle || coninHandle === -1n) {
      FreeConsole();
      return false;
    }

    // 2 records: Ctrl+A down, Ctrl+A up, Backspace down, Backspace up
    const buf = Buffer.alloc(4 * 20);

    const writeRecord = (off, keyDown, vkCode, unicodeChar, scanCode = 0, ctrlState = 0) => {
      buf.writeUInt16LE(1, off);
      buf.writeInt32LE(keyDown ? 1 : 0, off + 4);
      buf.writeUInt16LE(1, off + 8);
      buf.writeUInt16LE(vkCode, off + 10);
      buf.writeUInt16LE(scanCode, off + 12);
      buf.writeUInt16LE(unicodeChar, off + 14);
      buf.writeUInt32LE(ctrlState, off + 16);
    };

    // Ctrl+A down (select all)
    writeRecord(0, true, 0x41, 1, 0x1E, LEFT_CTRL_PRESSED);
    // Ctrl+A up
    writeRecord(20, false, 0x41, 1, 0x1E, 0);
    // Backspace down (delete selection)
    writeRecord(40, true, 0x08, 8, 0x0E, 0);
    // Backspace up
    writeRecord(60, false, 0x08, 8, 0x0E, 0);

    const writtenBuf = Buffer.alloc(4);
    const result = WriteConsoleInputW(coninHandle, buf, 4, writtenBuf);
    const written = writtenBuf.readUInt32LE(0);

    FreeConsole();
    return result && written > 0;
  } catch (e) {
    try { FreeConsole(); } catch (e2) {}
    return false;
  }
}

/**
 * Send Ctrl+C to a console process via GenerateConsoleCtrlEvent.
 * This actually generates a CTRL_C_EVENT signal, unlike WriteConsoleInputW which can't.
 * @param {number} pid - Terminal process PID
 * @returns {boolean} success
 */
function sendCtrlC(pid) {
  if (!pid || pid === 0) return false;
  try {
    FreeConsole();
    let s = Date.now(); while (Date.now() - s < 30) {}

    if (!AttachConsole(pid)) {
      FreeConsole();
      return false;
    }

    s = Date.now(); while (Date.now() - s < 50) {}

    // 0 = CTRL_C_EVENT, 0 = send to all processes sharing this console
    const result = GenerateConsoleCtrlEvent(0, 0);

    FreeConsole();
    return result;
  } catch (e) {
    try { FreeConsole(); } catch (e2) {}
    return false;
  }
}

module.exports = {
  getConsoleWindowForPid,
  forceRestoreAndFocus,
  typeTextViaPaste,
  writeConsoleInput,
  sendEnterToConsole,
  sendCtrlC,
  clearConsoleInput,
  // Direct API access for advanced use
  ShowWindow, SetForegroundWindow, BringWindowToTop, IsIconic,
  SwitchToThisWindow, FindWindowW, GetWindowTextW, SetWindowPos,
  AttachConsole, FreeConsole, GetConsoleWindow, GetCurrentThreadId,
  GetForegroundWindow, GetWindowThreadProcessId,
  SendMessageW, GetWindowPlacement, SetWindowPlacement,
  // Constants
  SW_HIDE, SW_SHOWNORMAL, SW_SHOWMINIMIZED, SW_RESTORE, SW_SHOW,
  HWND_TOPMOST, HWND_NOTOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
  WM_SYSCOMMAND, SC_RESTORE,
};
