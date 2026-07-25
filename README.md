# Croc Desktop

A friendly, cross-platform (**macOS · Windows · Linux**) desktop app for [**croc**](https://github.com/schollz/croc) — schollz's secure peer-to-peer file transfer tool.

Drop in a file, folder, or some text → get a one-time code (and a QR) → share it. The other device enters the code and the transfer runs **end-to-end encrypted, straight between the two machines**. No account, no cloud storage, nothing kept on a server.

<p align="center">
  <img src="screenshots/send.png" alt="Sharing a transfer: one-time code, QR, and live connection status" width="820">
</p>

## Features

- **Send files, folders, or text** — drag & drop, a file/folder picker, or paste (⌘/Ctrl-V) images, text, or copied files.
- **One-time code + QR** — share the code, or let the peer scan the QR. The QR encodes a `croc://` deep link, so a phone camera opens the companion app straight into receiving.
- **Receive** — type or paste a code, or scan a QR with your camera. Auto-fills a code from the clipboard.
- **Live progress** on a per-file timeline, mirrored onto the Dock/taskbar.
- **Self-healing transfers** — a dropped transfer **auto-reconnects** (both ends retry the same code), and interrupted downloads **resume** from where they left off instead of restarting.
- **Auto-accept or review** incoming files, with desktop notifications when a transfer finishes or needs you.
- **Transfer history** — re-send or reveal past transfers; nothing leaves the device.
- **Custom & bookmarked codes**, a relay picker + reachability test, and light/dark themes.
- **Deep links** — `croc://` and shareable `https://` links open the app straight into receiving.
- **Self-contained** — the correct `croc` binary is **bundled**, so there's nothing to install. It **auto-updates** itself, signed.

## Screenshots

| Receive | History |
| --- | --- |
| ![Receive](screenshots/receive.png) | ![History](screenshots/history.png) |

| Settings | About |
| --- | --- |
| ![Settings](screenshots/settings.png) | ![About](screenshots/about.png) |

## Install

Grab the latest build from the [**Releases**](https://github.com/Carlos-err406/croc-desktop/releases/latest) page:

- **macOS** — `.dmg` (universal). The app is not notarized, so on first launch right-click → **Open** (or *System Settings → Privacy & Security → Open Anyway*).
- **Windows** — `.exe` installer.
- **Linux** — `.AppImage` (portable) or `.deb`.

The app updates itself automatically from then on (toggleable in Settings).

## Android companion

Pair with your phone using the recommended companion app, [**croc-app**](https://github.com/Dking08/croc-app) — scan the desktop QR to receive, or send from the phone to the desktop. There's a link to it on the **About** screen.

## How it works

Croc Desktop does **not** reimplement the croc protocol — it drives the real `croc` CLI and parses its output.

- **`croc`'s progress output is TTY-gated** (it prints nothing to a plain pipe), so transfers run through a **pseudo-terminal** ([`portable-pty`](https://crates.io/crates/portable-pty)) — the only reliable way to capture the live progress bar cross-platform.
- The code phrase is generated app-side and passed via the `CROC_SECRET` env var (croc v10 refuses a code as a plain CLI arg), so there's no fragile stdout parsing for the code.
- Status/progress is parsed in Rust and **streamed to the UI over a Tauri event channel**, then rendered with the app's own progress timeline.
- The matching `croc` binary is **bundled as a sidecar** (pinned to a version compatible with the Android app), preferred over any system `croc`.

## Stack

- **[Tauri v2](https://tauri.app)** — Rust backend, native webview (no bundled Chromium)
- **React 18 + TypeScript**, **Vite**
- **Tailwind CSS v4** + **shadcn/ui** (new-york)
- Rust: `portable-pty` (pseudo-terminal), `qrcode` (QR), `reqwest`; Tauri plugins for updater, deep-link, single-instance, notifications, dialog, opener

## Develop

Prerequisites: **Node.js**, **Rust** (stable), and the [Tauri v2 system prerequisites](https://tauri.app/start/prerequisites/) for your OS. The bundled `croc` binary is fetched automatically (`scripts/fetch-croc.mjs`) — no Go toolchain needed for the desktop build.

```bash
npm install
npm run dev        # Tauri dev: fetches croc, starts Vite + the app with HMR
```

Useful checks:

```bash
npm run typecheck  # tsc --noEmit
npm run build:vite # type-check + build the frontend only
```

## Build

```bash
npm run build      # tauri build → .dmg / .exe / .AppImage / .deb for the current OS
```

Releases are cut by pushing a `v*` tag: CI builds, signs, and auto-publishes the installers plus the updater manifest for all three platforms.

## Credits

Built on [schollz/croc](https://github.com/schollz/croc). Croc Desktop is an independent GUI and is not affiliated with the croc project.
