import { BrowserWindow, dialog, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import $try from '@utils/try';
import { CrocSend, generateCode } from '../../lib';
import { IPCRegisterFunction } from '../types';
import {
  CROC_CANCEL,
  CROC_EVENT,
  CROC_PICK_PATHS,
  CROC_SEND,
  CROC_SHOW_ITEM,
  type CrocEvent,
  type CrocSendResult,
} from './channels';
import { log } from './utils';

// Active transfers, keyed by transferId.
const transfers = new Map<string, CrocSend>();

// Stream an event to whichever window is currently open (robust to the window
// being recreated on macOS `activate`).
function emit(event: CrocEvent): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send(CROC_EVENT, event);
}

export const onPickPaths = () =>
  $try(async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(parent, {
      title: 'Choose files or a folder to send',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

export const onSend = (paths: string[]) =>
  $try<CrocSendResult>(async () => {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('No files selected.');
    }

    const transferId = randomUUID();
    const code = generateCode();
    const send = new CrocSend();
    transfers.set(transferId, send);

    send.on('log', (line) => emit({ transferId, type: 'log', line }));
    send.on('waiting', () => emit({ transferId, type: 'waiting' }));
    send.on('peer', () => emit({ transferId, type: 'peer' }));
    send.on('file-info', (info) => emit({ transferId, type: 'file-info', info }));
    send.on('progress', (progress) => emit({ transferId, type: 'progress', progress }));
    send.on('done', () => emit({ transferId, type: 'done' }));
    send.on('error', ({ message }) => emit({ transferId, type: 'error', message }));
    send.on('exit', ({ code: exitCode }) => {
      emit({ transferId, type: 'exit', code: exitCode });
      transfers.delete(transferId);
    });

    try {
      log(`send ${paths.length} path(s), code ${code}`);
      await send.start(paths, { code });
    } catch (err) {
      transfers.delete(transferId);
      throw err;
    }

    let qr: string | null = null;
    try {
      qr = await QRCode.toDataURL(code, {
        margin: 1,
        width: 220,
        color: { dark: '#0b1220', light: '#ffffff' },
      });
    } catch {
      /* QR is a nicety; ignore failures */
    }

    return {
      transferId,
      code,
      qr,
      receiveCommand: {
        code,
        posix: `CROC_SECRET=${code} croc`,
        interactive: 'croc   # then paste the code when prompted',
      },
    };
  });

export const onCancel = (transferId: string) =>
  $try(async () => {
    const send = transfers.get(transferId);
    if (send) {
      log(`cancel ${transferId}`);
      send.cancel();
    }
    return true;
  });

export const onShowItem = (targetPath: string) =>
  $try(async () => {
    if (targetPath) shell.showItemInFolder(targetPath);
    return true;
  });

export const crocRegister: IPCRegisterFunction = (ipcMain) => {
  ipcMain.handle(CROC_PICK_PATHS, () => onPickPaths());
  ipcMain.handle(CROC_SEND, (_e, paths: string[]) => onSend(paths));
  ipcMain.handle(CROC_CANCEL, (_e, transferId: string) => onCancel(transferId));
  ipcMain.handle(CROC_SHOW_ITEM, (_e, targetPath: string) => onShowItem(targetPath));
};
