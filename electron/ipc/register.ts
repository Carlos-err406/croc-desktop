import { BrowserWindow } from 'electron';
import { crocRegister } from './croc/main';

export default function registerIPCs(
  ipcMain: Electron.IpcMain,
  widget: BrowserWindow | null
): void {
  [crocRegister].forEach((registerFn) => registerFn(ipcMain, widget));
}
