## What this changes

<!-- One or two sentences. Link the issue it closes, if there is one. -->

## Why

<!-- What was wrong or missing. If a croc or Android quirk forced the approach, say so —
     that context is worth keeping in the history. -->

## How it was tested

<!-- CI never performs a real transfer, so please describe one you ran. -->

- [ ] `npm run lint` and `npm run format:check`
- [ ] `npm run typecheck`
- [ ] `npm run build:vite`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] Ran a real transfer end to end (say which: file / folder / text, and against what
      peer — the app, the `croc` CLI, a phone)

Platforms exercised: <!-- macOS / Windows / Linux / Android + which device -->

## Checklist

- [ ] Whole change is staged, **including `src-tauri/src/`** if the Rust side moved
- [ ] No version bumps (`package.json`, `tauri.conf.json`, `Cargo.toml` are set at release time)
- [ ] No repo-wide reformatting mixed in
- [ ] Android: nothing added that can't cross-compile to `aarch64-linux-android`, and no
      edits to the generated `src-tauri/gen/android/` (use `scripts/android-configure.mjs`)
