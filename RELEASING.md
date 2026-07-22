# Releasing

Builds are produced by GitHub Actions. There is no local release step.

## Workflows

- **CI** (`.github/workflows/ci.yml`) — runs on every push to `main` and every
  PR. Installs deps (rebuilding the native `node-pty`), typechecks, and builds
  the renderer + Electron main. No installers are produced.
- **Release** (`.github/workflows/release.yml`) — runs on a `v*` tag. One job
  per OS; each builds every arch its electron-builder target lists (the macOS
  Apple-Silicon runner cross-builds x64 too — electron-builder rebuilds
  `node-pty` per arch):

  | Runner         | Platform | Arch(s)   | Artifacts           |
  | -------------- | -------- | --------- | ------------------- |
  | macos-14       | mac      | universal | `.dmg`, `.zip`      |
  | windows-latest | win      | x64       | `.exe` (NSIS)       |
  | ubuntu-latest  | linux    | x64       | `.AppImage`, `.deb` |

  The macOS build is a **universal** binary (Apple Silicon + Intel in one),
  so users never pick the wrong architecture and never hit Rosetta.

## Cutting a release

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.2.0`).
2. Commit it.
3. Tag with a matching `v` prefix and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

   > The tag must match `package.json`'s version — electron-builder names the
   > GitHub Release after the package version.

4. The Release workflow builds all platforms and uploads them to a **draft**
   GitHub Release. Review it under *Releases*, then publish when ready.

To sanity-check that packaging still works without cutting a release (e.g. after
a build-config change), trigger the Release workflow manually (*Actions → Release
→ Run workflow*). Manual runs build all platforms but publish nothing — a green
run means the packaging succeeded. Installers are only produced by tag releases.

## Not yet configured

- **Code signing / notarization.** Builds are currently **unsigned**. On macOS
  users must right-click → Open (Gatekeeper); on Windows they'll see a SmartScreen
  prompt. To sign, add the certs as GitHub secrets and wire them into the Release
  workflow:
  - macOS: `CSC_LINK` (base64 `.p12`) + `CSC_KEY_PASSWORD`, and an Apple API key
    (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) for notarization;
    then drop the `CSC_IDENTITY_AUTO_DISCOVERY: false` override.
  - Windows: `CSC_LINK` + `CSC_KEY_PASSWORD` (code-signing cert).
- **Lint in CI.** `npm run lint` has no ESLint config yet, so it isn't wired
  into CI. Add a config and a `lint` step when ready.

## App icon

`build/icon.png` (1024×1024, the croc mark) is the source icon. electron-builder
auto-derives `.icns` (macOS) and `.ico` (Windows) from it at build time and uses
the PNG directly on Linux — no per-platform config needed. Replace that one file
to rebrand.
