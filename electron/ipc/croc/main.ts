import { app, BrowserWindow, dialog, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import $try from '@utils/try';
import { CrocReceive, CrocSend, generateCode } from '../../lib';
import { IPCRegisterFunction } from '../types';
import {
  CROC_CANCEL,
  CROC_DEFAULT_DIR,
  CROC_EVENT,
  CROC_PICK_FOLDER,
  CROC_PICK_PATHS,
  CROC_RECEIVE,
  CROC_SEND,
  CROC_SHOW_ITEM,
  CROC_STAT_PATHS,
  type CrocEvent,
  type CrocReceiveResult,
  type CrocSendResult,
  type StatEntry,
} from './channels';
import { log } from './utils';

/** Default download folder: ~/Downloads/Croc (created if missing). */
function defaultDownloadDir(): string {
  let base: string;
  try {
    base = app.getPath('downloads');
  } catch {
    base = path.join(process.env.HOME || process.cwd(), 'Downloads');
  }
  const dir = path.join(base, 'Croc');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function humanBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function badgeType(name: string, isDir: boolean): string {
  if (isDir) return 'DIR';
  const ext = path.extname(name).replace('.', '').toUpperCase();
  return ext ? ext.slice(0, 4) : 'FILE';
}

// Active transfers, keyed by transferId.
const transfers = new Map<string, CrocSend | CrocReceive>();

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

export const onStatPaths = (paths: string[]) =>
  $try<StatEntry[]>(async () => {
    const out: StatEntry[] = [];
    for (const p of paths) {
      try {
        const st = fs.statSync(p);
        const isDir = st.isDirectory();
        out.push({
          path: p,
          name: path.basename(p),
          size: isDir ? 0 : st.size,
          sizeHuman: isDir ? 'Folder' : humanBytes(st.size),
          type: badgeType(path.basename(p), isDir),
          isDir,
        });
      } catch {
        out.push({ path: p, name: path.basename(p), size: 0, sizeHuman: '', type: 'FILE', isDir: false });
      }
    }
    return out;
  });

export const onSend = (paths: string[], providedId?: string, relay?: string) =>
  $try<CrocSendResult>(async () => {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('No files selected.');
    }

    const transferId = providedId || randomUUID();
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
      await send.start(paths, { code, relay: relay || undefined });
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

export const onReceive = (code: string, opts?: { out?: string; relay?: string }, providedId?: string) =>
  $try<CrocReceiveResult>(async () => {
    const trimmed = (code || '').trim();
    if (!trimmed) throw new Error('Enter a transfer code.');

    const transferId = providedId || randomUUID();
    const out = opts?.out || defaultDownloadDir();
    const recv = new CrocReceive();
    transfers.set(transferId, recv);

    recv.on('log', (line) => emit({ transferId, type: 'log', line }));
    recv.on('waiting', () => emit({ transferId, type: 'waiting' }));
    recv.on('peer', () => emit({ transferId, type: 'peer' }));
    recv.on('file-info', (info) => emit({ transferId, type: 'file-info', info }));
    recv.on('progress', (progress) => emit({ transferId, type: 'progress', progress }));
    recv.on('done', () => emit({ transferId, type: 'done' }));
    recv.on('error', ({ message }) => emit({ transferId, type: 'error', message }));
    recv.on('exit', ({ code: exitCode }) => {
      emit({ transferId, type: 'exit', code: exitCode });
      transfers.delete(transferId);
    });

    try {
      log(`receive into ${out}`);
      await recv.start({ code: trimmed, out, relay: opts?.relay || undefined });
    } catch (err) {
      transfers.delete(transferId);
      throw err;
    }
    return { transferId, out };
  });

export const onCancel = (transferId: string) =>
  $try(async () => {
    const t = transfers.get(transferId);
    if (t) {
      log(`cancel ${transferId}`);
      t.cancel();
    }
    return true;
  });

export const onShowItem = (targetPath: string) =>
  $try(async () => {
    if (targetPath) shell.showItemInFolder(targetPath);
    return true;
  });

export const onPickFolder = () =>
  $try<string>(async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(parent, {
      title: 'Choose a download folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? '' : result.filePaths[0];
  });

export const onDefaultDir = () => $try<string>(async () => defaultDownloadDir());

export const crocRegister: IPCRegisterFunction = (ipcMain) => {
  ipcMain.handle(CROC_PICK_PATHS, () => onPickPaths());
  ipcMain.handle(CROC_PICK_FOLDER, () => onPickFolder());
  ipcMain.handle(CROC_DEFAULT_DIR, () => onDefaultDir());
  ipcMain.handle(CROC_STAT_PATHS, (_e, paths: string[]) => onStatPaths(paths));
  ipcMain.handle(CROC_SEND, (_e, paths: string[], transferId?: string, relay?: string) =>
    onSend(paths, transferId, relay)
  );
  ipcMain.handle(
    CROC_RECEIVE,
    (_e, code: string, opts?: { out?: string; relay?: string }, transferId?: string) =>
      onReceive(code, opts, transferId)
  );
  ipcMain.handle(CROC_CANCEL, (_e, transferId: string) => onCancel(transferId));
  ipcMain.handle(CROC_SHOW_ITEM, (_e, targetPath: string) => onShowItem(targetPath));
};
