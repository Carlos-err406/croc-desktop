import { BrowserWindow } from 'electron';
import { crocInvokerFactory } from './croc/preload';

export type IPCRegisterFunction = (
  ipcMain: Electron.IpcMain,
  widget: BrowserWindow | null
) => void;

export type IPC = ReturnType<typeof crocInvokerFactory>;
