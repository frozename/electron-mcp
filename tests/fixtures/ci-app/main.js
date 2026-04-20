// Minimal Electron fixture used by the sprint 1/2/3 smoke tests in CI.
// The window loads index.html and wires up the navigation buttons the
// smokes expect. Kept deliberately small: no preload, no nodeIntegration,
// contextIsolation on.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: true,
    title: 'electron-mcp CI fixture',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
