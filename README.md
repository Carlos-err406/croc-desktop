# Croc Desktop

A cross-platform (macOS / Windows / Linux) desktop GUI for [**croc**](https://github.com/schollz/croc), schollz's secure peer-to-peer file transfer tool.

Drag in a file or folder → get a code → share it. The receiver runs `croc`, enters the code, and the transfer runs end-to-end encrypted through croc's PAKE relay. No account, no cloud storage.

> **v1 is send-only** (drag & drop → code + QR → live progress). Receive, transfer history, and relay/settings are planned.

## How it works

Croc Desktop does **not** reimplement the croc protocol — it drives the real, battle-tested `croc` CLI and parses its output.

- **`croc`'s progress output is TTY-gated** (it prints nothing to a plain pipe), so transfers are spawned through a **pseudo-terminal** ([`node-pty`](https://github.com/microsoft/node-pty)). This is the only reliable way to capture the live progress bar cross-platform.
- We generate the code phrase ourselves and pass it via `croc send --code <code>`, so there's no fragile stdout parsing for the code.
- Progress/status is streamed from the main process to the renderer over a `croc:event` IPC channel and rendered with a shadcn/ui progress bar.

`croc` must be available at runtime — found via `CROC_BIN`, a bundled binary in the packaged app, or on `PATH` (e.g. `brew install croc`).

## Stack

- **Electron** + [`vite-plugin-electron`](https://github.com/electron-vite/vite-plugin-electron) (Vite 5)
- **React 18 + TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (new-york)
- `node-pty` (pseudo-terminal), `qrcode` (receiver QR)

## Project layout

```
electron/
  main.ts                 app entry: window + IPC registration
  preload.ts              exposes window.ipc via contextBridge
  lib/
    croc.ts               CrocSend: spawns croc via node-pty, parses events
    codephrase.ts         human-friendly code generator
    window.ts, config.ts  window creation + paths
  ipc/croc/               feature IPC module
    channels.ts           channel names + streamed event types
    main.ts               handlers (send, cancel, pick, show) + $try
    preload.ts            invoker factory (+ onCrocEvent stream, pathForFile)
src/
  app.tsx, main.tsx
  components/app/          Dropzone, SendApp (state machine), SendPanel
  components/ui/           shadcn components
  lib/services/ipc.ts      typed wrapper over window.ipc
utils/try.ts               Go-style [error, result] helper
```

## Develop

```bash
npm install        # also rebuilds node-pty for Electron's ABI (install-app-deps)
npm run dev        # Vite dev server + Electron with HMR
```

## Build installers

```bash
npm run build          # current OS
npm run build:mac      # dmg + zip (x64 + arm64)
npm run build:win      # nsis
npm run build:linux    # AppImage + deb
```

Output lands in `dist-release/`.

## Notes

- The dev-only "Insecure Content-Security-Policy" console warning is expected; Electron suppresses it in packaged builds. A production CSP is a planned hardening step.
- To bundle a `croc` binary with the installer, drop platform binaries under `vendor/croc/<os>/<arch>/` and wire them into `electron-builder.json5` `extraResources`. Otherwise the app uses `croc` from `PATH`.
