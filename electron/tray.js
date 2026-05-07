const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let onToggle = null;

function createTrayIcon() {
  // Create a simple 16x16 tray icon programmatically
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAKBJREFUWEft1sENwjAQRNGxlUAJlEAJlEAJlEAJlEAJlKCUuIhEwB+tiX3GObxptbP6m12vEOLXEYAj/hMwd1sjAF/kOR2gqmq11oCZ2JngU9UH8PECmGTfgJmds7+UBMwEk0QL4Ly3JDOz7CdbAi7i9Qfm3zuXPgHECohBfuU+sK/NHz98Bc8AHJHV85xWQfsAeFCsQUy82X61a/gJAcTwfIP+AI32AAAAAElFTkSuQmCC'
  );
  return icon.resize({ width: 16, height: 16 });
}

function createTray(toggleCallback) {
  onToggle = toggleCallback;

  tray = new Tray(createTrayIcon());
  tray.setToolTip('CC Island - Claude Code 灵动岛');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '展开/收起灵动岛',
      click: () => {
        if (onToggle) onToggle();
      },
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        // Settings window can be added here
      },
    },
    { type: 'separator' },
    {
      label: '退出 CC Island',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (onToggle) onToggle();
  });

  return tray;
}

function getTray() {
  return tray;
}

module.exports = { createTray, getTray };
