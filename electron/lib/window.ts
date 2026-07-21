import { BrowserWindow } from 'electron';
import path from 'node:path';
import { getPreloadPath, getRendererDist } from './config';

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 940,
    minHeight: 640,
    title: 'Croc Desktop',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: true,
      enableWebSQL: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  if (VITE_DEV_SERVER_URL) {
    window.loadURL(VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(getRendererDist(), 'index.html'));
  }

  return window;
}
