import { webUtils } from 'electron';
import {
  CROC_CANCEL,
  CROC_DEFAULT_DIR,
  CROC_EVENT,
  CROC_PICK_FOLDER,
  CROC_PICK_PATHS,
  CROC_RECEIVE,
  CROC_SEND,
  CROC_SHARE,
  CROC_SHOW_ITEM,
  CROC_STAT_PATHS,
  CROC_HISTORY_LIST,
  CROC_HISTORY_ADD,
  CROC_HISTORY_CLEAR,
  type CrocEvent,
  type HistoryDraft,
} from './channels';
import type {
  onCancel,
  onDefaultDir,
  onHistoryAdd,
  onHistoryClear,
  onHistoryList,
  onPickFolder,
  onPickPaths,
  onReceive,
  onSend,
  onShare,
  onShowItem,
  onStatPaths,
} from './main';

export const crocInvokerFactory = (ipcRenderer: Electron.IpcRenderer) => ({
  [CROC_PICK_PATHS]: (() => ipcRenderer.invoke(CROC_PICK_PATHS)) as typeof onPickPaths,
  [CROC_PICK_FOLDER]: (() => ipcRenderer.invoke(CROC_PICK_FOLDER)) as typeof onPickFolder,
  [CROC_DEFAULT_DIR]: (() => ipcRenderer.invoke(CROC_DEFAULT_DIR)) as typeof onDefaultDir,
  [CROC_STAT_PATHS]: ((paths: string[]) =>
    ipcRenderer.invoke(CROC_STAT_PATHS, paths)) as typeof onStatPaths,
  [CROC_SEND]: ((paths: string[], transferId?: string, relay?: string, zip?: boolean) =>
    ipcRenderer.invoke(CROC_SEND, paths, transferId, relay, zip)) as typeof onSend,
  [CROC_RECEIVE]: ((code: string, opts?: { out?: string; relay?: string }, transferId?: string) =>
    ipcRenderer.invoke(CROC_RECEIVE, code, opts, transferId)) as typeof onReceive,
  [CROC_CANCEL]: ((transferId: string) =>
    ipcRenderer.invoke(CROC_CANCEL, transferId)) as typeof onCancel,
  [CROC_SHOW_ITEM]: ((targetPath: string) =>
    ipcRenderer.invoke(CROC_SHOW_ITEM, targetPath)) as typeof onShowItem,
  [CROC_SHARE]: ((payload: { image?: string; text?: string }) =>
    ipcRenderer.invoke(CROC_SHARE, payload)) as typeof onShare,
  [CROC_HISTORY_LIST]: (() => ipcRenderer.invoke(CROC_HISTORY_LIST)) as typeof onHistoryList,
  [CROC_HISTORY_ADD]: ((draft: HistoryDraft) =>
    ipcRenderer.invoke(CROC_HISTORY_ADD, draft)) as typeof onHistoryAdd,
  [CROC_HISTORY_CLEAR]: (() => ipcRenderer.invoke(CROC_HISTORY_CLEAR)) as typeof onHistoryClear,

  // Subscribe to the main->renderer progress stream. Returns an unsubscribe fn.
  onCrocEvent: (handler: (event: CrocEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: CrocEvent) => handler(payload);
    ipcRenderer.on(CROC_EVENT, listener);
    return () => {
      ipcRenderer.removeListener(CROC_EVENT, listener);
    };
  },

  // Resolve a dropped/selected File to its absolute path (sanctioned API since
  // File.path was deprecated). Safe to call across the context bridge.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
