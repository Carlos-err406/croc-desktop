import { webUtils } from 'electron';
import {
  CROC_CANCEL,
  CROC_EVENT,
  CROC_PICK_PATHS,
  CROC_SEND,
  CROC_SHOW_ITEM,
  type CrocEvent,
} from './channels';
import type { onCancel, onPickPaths, onSend, onShowItem } from './main';

export const crocInvokerFactory = (ipcRenderer: Electron.IpcRenderer) => ({
  [CROC_PICK_PATHS]: (() => ipcRenderer.invoke(CROC_PICK_PATHS)) as typeof onPickPaths,
  [CROC_SEND]: ((paths: string[]) => ipcRenderer.invoke(CROC_SEND, paths)) as typeof onSend,
  [CROC_CANCEL]: ((transferId: string) =>
    ipcRenderer.invoke(CROC_CANCEL, transferId)) as typeof onCancel,
  [CROC_SHOW_ITEM]: ((targetPath: string) =>
    ipcRenderer.invoke(CROC_SHOW_ITEM, targetPath)) as typeof onShowItem,

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
