import { contextBridge, ipcRenderer } from 'electron';
import { crocInvokerFactory } from './ipc/croc/preload';

// --------- Expose the typed IPC surface to the renderer as `window.ipc` ---------
contextBridge.exposeInMainWorld('ipc', {
  ...crocInvokerFactory(ipcRenderer),
});
