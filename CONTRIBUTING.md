# Contributing to Crocodile 🐊

Thanks for wanting to help. This is a small, personally maintained project, so the
fastest path to a merged change is a short conversation before a long diff.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Everything you
contribute is licensed under the repo's [MIT license](LICENSE).

## Scope: what belongs here

Crocodile is a **GUI over the real `croc` CLI** — it drives the bundled binary and
parses its output. It does not reimplement the transfer protocol.

- **UI, app behaviour, packaging, deep links, output parsing** → here.
- **The transfer protocol, relays, encryption, croc's own flags** → upstream at
  [schollz/croc](https://github.com/schollz/croc). If a transfer fails the same way
  with `croc` on the command line, it's an upstream issue.

## Before you start

- **Bugs** — open an issue. Say which platform and app version, and which `croc`
  version was on *both* ends (About screen, or `croc --version`). Version mismatches
  across a croc minor break peers, and that looks like an app bug.
- **Features** — open an issue first, or comment on an existing one. Check
  [BACKLOG.md](BACKLOG.md): a lot of ideas are already parked there with feasibility
  notes, including what croc itself makes impossible.
- **Security issues** — don't open an issue. See [SECURITY.md](SECURITY.md).

## Getting set up

Prerequisites and commands live in the README's [Develop](README.md#develop) section:
**Node.js** + **Rust** (stable) + the [Tauri v2 system
prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run dev        # fetches the croc sidecar, starts Vite + the app with HMR
```

Android needs more — SDK/NDK, JDK 17, Go 1.25+, and the
`aarch64-linux-android` Rust target. [docs/android.md](docs/android.md) is the real
guide: how croc is compiled for Android, how content URIs are staged, and what's been
verified on hardware.

`src-tauri/gen/android/` is generated and git-ignored. **Never edit it** — put
customisations in `scripts/android-configure.mjs`, or they vanish on the next
`android:init`.

## Where things live

| Path | What's in it |
| --- | --- |
| `src/components/screens/` | Send, Receive, History, Settings, About |
| `src/components/ui/` | shadcn/ui primitives (new-york) — prefer `npx shadcn add` over hand-writing |
| `src/lib/` | IPC wrappers, prefs, transfer hooks (`useSend`, `useReceive`), platform detection |
| `src-tauri/src/commands.rs` | Tauri commands — the frontend's whole API surface |
| `src-tauri/src/croc.rs` | Spawning croc + the single output parser (pty and pipe share it), `EXPECTED_CROC_VERSION` |
| `src-tauri/src/android_*.rs` | SAF, MediaStore, share-sheet — Android-only paths |
| `scripts/fetch-croc.mjs` | Pins and fetches/builds the bundled croc (`CROC_VERSION`) |
| `docs/android.md` | The Android port, in detail |

## Checks before you open a PR

Run what CI runs. All of these must pass:

```bash
npm run lint                                   # ESLint
npm run format:check                           # Prettier — `npm run format` fixes it
npm run typecheck                              # tsc --noEmit
npm run build:vite                             # type-check + build the frontend
cargo fmt --manifest-path src-tauri/Cargo.toml --check
node scripts/fetch-croc.mjs                    # the Rust check needs the sidecar present
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Rust needs `rustup component add rustfmt clippy` once, and **Rust 1.80+** — the crate
uses `std::sync::LazyLock`.

CI also cross-compiles the crate for `aarch64-linux-android` on every PR, so a change
that only builds on desktop will fail there. Two constraints keep that green:

- **No C build scripts in the Android dependency set.** `reqwest` and the updater are
  desktop-only because their rustls path pulls in `ring`. Gate new deps behind
  `#[cfg(not(target_os = "android"))]` if they don't cross-compile.
- **Feature parity is not assumed.** Android has no pty, no folder sends, no
  "reveal in folder". Check `src/lib/platform.ts` before adding UI that needs a path.

## Test the transfer by hand

CI never performs a transfer, so anything touching send, receive, or the parser needs a
real one. The cheapest second peer is the `croc` CLI at the **same version** the app
bundles (`v10.6.0` today):

```bash
croc send ./some-file          # then receive it in the app
CROC_SECRET=<code> croc        # or receive what the app sent
```

Worth exercising when you've been near that code: a **text** send, a **folder** send, a
**large** file (progress and the per-file timeline), and — if you touched retry or
resume — killing one end mid-transfer to confirm it reconnects and resumes instead of
restarting. For Android changes, please say in the PR what you ran on a real device;
emulators don't reproduce the storage or DNS behaviour.

## Code style

Match the surrounding code. It's ordinary React + TypeScript with Tailwind v4
utilities, and plain Rust with the platform-specific parts split into their own modules.
Comments explain *why* something is the way it is — that's the house style, and it's
worth keeping where a workaround exists because of a croc or Android quirk.

Formatting is not a matter of taste here — let the tools decide:

- **Prettier** (`.prettierrc`) — single quotes, 100 columns. `npm run format` fixes the
  whole tree. Markdown is in `.prettierignore` on purpose: the docs are hand-wrapped,
  and Prettier reflows tables and list continuations in ways that fight that.
- **ESLint** (`.eslintrc.cjs`) — `eslint:recommended` plus typescript-eslint and
  react-hooks. Type-aware rules are off by design; `npm run typecheck` already runs the
  compiler. Warnings fail CI (`--max-warnings 0`), including `react-hooks/exhaustive-deps`.
  If a dependency is deliberately omitted, disable that line **with a comment saying
  why** rather than silently loosening the rule.
- **rustfmt + clippy** — defaults, and clippy runs with `-D warnings`.

Prefix a genuinely unused parameter with `_` to opt it out of the unused-vars rule.

## Commits and PRs

Commit history here reads as plain statements of what changed and why it mattered:

```
Android: give croc a writable cwd, or text sends and receives die
Android: pass --ignore-stdin, or croc sends stdin instead of the files
Nearby devices: selected peer stays active, radio-style (v2.4.1)
```

- One concern per commit. Keep unrelated formatting out of it.
- **Stage the whole change — including `src-tauri/src/`.** A past release shipped with
  the Rust half missing because only the frontend got staged. `git diff --stat HEAD`
  before you push.
- **Don't bump the version** in a PR. Releases are cut separately (below).
- Fill in the PR template: what changed, how you tested it, which platforms you ran.

## Versioning and releases

For context, and for whoever cuts the release:

Versions follow **semver by impact** — major for breaking, minor for a feature, patch
for a fix. **Bumping the bundled croc is a major release**: peers across a croc minor
can't talk to each other, so desktop and Android must ship the same croc, pinned in
both `scripts/fetch-croc.mjs` (`CROC_VERSION`) and `src-tauri/src/croc.rs`
(`EXPECTED_CROC_VERSION`).

Three files must agree on the app version: `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. **One version across every
platform** — Android derives its `versionCode` from the semver, so a per-platform
version stream would produce duplicate codes and break updates.

Pushing a `v*` tag is what publishes: CI builds and signs the desktop installers, the
updater manifest, and the Android APK into a single GitHub release.
