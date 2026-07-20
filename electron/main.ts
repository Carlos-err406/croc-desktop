import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import registerIPCs from './ipc/register';
import { createWindow } from './lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// APP_ROOT is used by lib/config.ts to locate the built renderer.
process.env.APP_ROOT = path.join(__dirname, '..');

app.whenReady().then(() => {
  createWindow();

  // Register once; handlers resolve the current window dynamically.
  registerIPCs(ipcMain, null);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
