/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string;
    VITE_PUBLIC: string;
  }
}

// Exposed in `preload.ts`, consumed in the renderer.
interface Window {
  ipc: import('./ipc/types').IPC;
}
