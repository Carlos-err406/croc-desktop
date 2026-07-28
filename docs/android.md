# Building for Android

The Android app is the same Tauri app as the desktop one — same React frontend, same
Rust backend, same croc engine, same `croc://` code/QR contract. What differs is how
croc is shipped and driven, plus a handful of features the platform can't support.

## Quick start

```sh
export ANDROID_HOME=~/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/<version>
export JAVA_HOME=$(brew --prefix openjdk@17)

npm ci
npm run android:init     # tauri android init + scripts/android-configure.mjs
npm run android:dev      # or: npm run android:build
```

Also needed: **Go 1.25+** (croc is compiled, not downloaded — see below) and
`rustup target add aarch64-linux-android`.

`src-tauri/gen/android/` is generated and **git-ignored**. Our customisations live in
`scripts/android-configure.mjs`, which `android:init` runs for you — so regenerating the
project stays safe and Tauri template updates come along for free. Re-run
`npm run android:init` after upgrading `@tauri-apps/cli`. Never hand-edit `gen/android`;
the next `init` discards it.

## How croc runs on Android

Desktop bundles croc as a Tauri `externalBin` sidecar and drives it through a pty.
Neither works here.

### croc is compiled from source, not downloaded

The published `Linux-ARM64` release asset is a **non-PIE** executable (ELF type `EXEC`),
and Android has refused non-PIE binaries since API 21 — it would never start.
`scripts/fetch-croc.mjs --android` cross-compiles the pinned croc with `GOOS=android`,
whose default build mode is PIE. CGO stays off, so no NDK toolchain is involved in
croc's own build.

**arm64 only.** `android/arm` and `android/amd64` both require external (cgo) linking,
so 32-bit ARM and x86_64 would need the NDK's clang. `abiFilters` declares arm64-v8a so
the APK is honest about it rather than installing and then failing to transfer. On an
Apple Silicon host the emulator is arm64 too, so this is still fully testable.

### croc ships as `libcroc.so`

Android only executes files from the extracted native-library directory — app-writable
storage is mounted no-exec — and only `lib*.so` files get packaged. So croc lands in
`jniLibs/arm64-v8a/libcroc.so`, with `extractNativeLibs="true"` (AGP defaults it to
`false` above minSdk 23, which would leave nothing on disk) and `keepDebugSymbols` for
that file (AGP's native-library stripping would corrupt a Go executable).

`MainActivity.onCreate` sets `CROC_BIN` to
`${applicationInfo.nativeLibraryDir}/libcroc.so` before `super.onCreate`, because Rust
can't read `ApplicationInfo` without JNI. `find_croc_binary()` already preferred that
variable, so the engine needed no change.

### Pipes, not a pty

`croc::transport` spawns croc with stdout and stderr dup'd onto **one** pipe and
`COLUMNS=1000` set. Both fds must share a single pipe: two pipes on two threads would
make arrival order nondeterministic, and the parser detects an unanswered prompt as the
newline-less tail of the stream.

This was the port's load-bearing assumption, and it is now measured rather than assumed.
Against croc **v10.6.0**, with stdout and stderr redirected to files and stdin from
`/dev/null` (no TTY anywhere):

| Question | Result |
| --- | --- |
| Does a transfer complete with no TTY? | Yes — 21 MB, exit 0 |
| Is progress emitted? | Yes: `testfile.bin 100% \|████\| (21/21 MB, 224 MB/s)` |
| Is the peer line emitted? | Yes: `Sending (->192.168.10.210:59146)` |
| Does `COLUMNS` control truncation? | Yes. At 80: `a-really-... 100%`. At 1000: the full 69-char filename |
| Do prompts work on a pipe? | Yes: `Accept 'prompted.bin' (200.0 kB)? (Y/n)`, answered by writing `y\n` to stdin |

All of those match the existing parser's regexes, which is why one parser serves both
transports. Note the last row in particular: **review mode works over pipes**, which no
prior art established (croc-app always passes `--yes --overwrite`).

The desktop pty is kept anyway — see "Why desktop still uses a pty" below.

### DNS needs help

Android ships no `/etc/resolv.conf`, so croc's pure-Go resolver falls back to
`127.0.0.1:53` and fails every lookup — including the one croc performs on its own
default relay at startup. Two fixes, because neither covers the other's case:

- `--internal-dns` is added to every Android invocation
  (`croc::platform_global_flags`), switching croc to its built-in list of public
  resolvers.
- A custom relay's hostname is resolved app-side with the platform resolver
  (`croc::resolve_relay`), because croc's stub resolver only knows public DNS and would
  never find a relay on the local network.

### Storage

Android's picker returns `content://` URIs, which croc — an ordinary subprocess —
cannot open. Each pick is streamed into `cacheDir/croc-send/` via the fs plugin's
`Fs::open()` (which resolves a content URI to a real `std::fs::File` through the
ContentResolver) and croc is given the copy's real path. `croc_clear_staged` empties
that directory when a send finishes or resets.

The copy briefly doubles the space a send needs — the unavoidable cost of SAF. It's
streamed, so the cost is disk, never memory.

Receives land in the app's data dir, since there is no public Downloads path a
subprocess can write to. `HOME` and `TMPDIR` are pointed at app-private storage, because
croc writes config (including the `--internal-dns` marker) and temp zips relative to
them.

## What's different from desktop

| Feature | On Android |
| --- | --- |
| Send files, code + QR, progress, history, text, relay picker | Same code |
| Review-mode prompts (accept / overwrite / resume) | Same code, over a stdin pipe |
| File picking | SAF picker, staged through the cache |
| Receive location | App data dir (no path-returning folder picker exists) |
| Folder sends | Off — SAF gives tree URIs, not paths |
| Drag-drop, paste-to-send, reveal in folder, ⌘N, multi-window, menus | Off |
| Dock/taskbar progress | Off (foreground-service notification instead) |
| Nearby devices / local-only mode | Off — needs a `MulticastLock` we don't hold yet |
| Auto-update | Off — to be replaced by a GitHub check + install intent |

Capability gating lives in `src/lib/platform.ts` (frontend) and `#[cfg(mobile)]` /
`#[cfg(desktop)]` (Rust). Commands that can't work get **mobile stubs** rather than
disappearing, so the IPC contract is identical on both platforms and no call site needs
a platform branch. Layout is driven by CSS breakpoints instead of platform checks, so a
narrow desktop window reflows exactly like a phone.

## Why desktop still uses a pty

The measurements above show pipes would work on desktop too, which would let
`portable-pty` be dropped everywhere (it is the sole consumer of 7 crates in
`Cargo.lock`). That is deliberately **not** part of this change: it would mean
re-validating a shipped transfer engine on macOS, Windows and Linux for no user-visible
gain, and Windows — where ConPTY and pipes differ most — is the least convenient
platform to check. `croc::transport` keeps both behind one interface, so switching later
is a change of default rather than a second refactor.

## Not yet built

- **Foreground service + wake lock** for background transfers. The permissions are
  declared but the service isn't implemented, so a transfer will likely die when the app
  is backgrounded. This is the biggest remaining gap.
- **Share-target payload handling.** The `ACTION_SEND` / `SEND_MULTIPLE` intent filters
  are registered, but nothing reads the incoming URIs into the Send screen yet.
- **Save-to-Downloads / Share** for received files (MediaStore + FileProvider).
- **In-app update check + install intent.** `REQUEST_INSTALL_PACKAGES` is declared;
  `useUpdater()` is a context and `UpdateBanner` only reads from it, so reimplementing
  its three plugin calls as Rust commands would carry the UI over unchanged. Android
  cannot install silently — the system installer always confirms.
- **`assetlinks.json`** on the Pages site with the release signing cert's SHA-256,
  without which https App Links show a chooser instead of opening the app. The `croc://`
  scheme works regardless.
- **Release signing.** CI produces a *debug* APK, which needs no secrets.
