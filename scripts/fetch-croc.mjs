#!/usr/bin/env node
/**
 * Lay down the pinned `croc` for whichever target is building.
 *
 * - Desktop (default): DOWNLOAD the release asset to Tauri externalBin sidecars at
 *   src-tauri/binaries/croc-<target-triple>[.exe].
 * - Android (`--android`): COMPILE croc from source into
 *   gen/android/app/src/main/jniLibs/<abi>/libcroc.so.
 *
 * Android can't use the published binaries: they're GOOS=linux builds and therefore
 * non-PIE (ELF type EXEC), and Android has refused to execute non-PIE binaries since
 * API 21 — it would never start. Compiling with GOOS=android gets a PIE binary
 * (its default build mode). Needs a Go toolchain; no NDK, because CGO stays off.
 *
 * It's named libcroc.so because Android only executes files from the extracted
 * native-library directory (app-writable storage is mounted no-exec) and only
 * packages lib*.so.
 *
 * Runs from beforeBuildCommand / beforeDevCommand so builds are self-contained.
 * Idempotent: skips when the pinned version is already present.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync,
  chmodSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ONE pinned croc for every platform we ship — desktop and Android. croc is
// protocol-sensitive across minor lines (a 10.4.x peer and a 10.6.x peer don't
// interoperate reliably, because v10.5.0 changed LAN relay behavior), so the
// version must not fork per platform. EXPECTED_CROC_VERSION in src-tauri/src/croc.rs
// mirrors this and the UI warns on a mismatch.
const CROC_VERSION = 'v10.6.0';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries');
const BASE = `https://github.com/schollz/croc/releases/download/${CROC_VERSION}`;
const STAMP = join(BIN_DIR, '.version');

// arm64 only, deliberately: android/arm and android/amd64 both require external
// (cgo) linking, so they'd need the NDK's clang. arm64 covers essentially every
// Android device in use — and on an Apple Silicon host the emulator is arm64 too,
// so this is still testable. croc-app ships arm64-only for the same reason.
const ANDROID_JNI_DIR = join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'jniLibs');
const ANDROID_STAMP = join(ANDROID_JNI_DIR, '.croc-version');
const CROC_MODULE = `github.com/schollz/croc/v10@${CROC_VERSION}`;
const ANDROID_PLAN = [{ abi: 'arm64-v8a', goarch: 'arm64' }];

// croc release asset -> Rust target triple, per host OS.
const PLAN = {
  darwin: [
    { asset: `croc_${CROC_VERSION}_macOS-ARM64.tar.gz`, triple: 'aarch64-apple-darwin' },
    { asset: `croc_${CROC_VERSION}_macOS-64bit.tar.gz`, triple: 'x86_64-apple-darwin' },
  ],
  linux: [{ asset: `croc_${CROC_VERSION}_Linux-64bit.tar.gz`, triple: 'x86_64-unknown-linux-gnu' }],
  win32: [{ asset: `croc_${CROC_VERSION}_Windows-64bit.zip`, triple: 'x86_64-pc-windows-msvc', exe: true }],
};

const ANDROID = process.argv.includes('--android');
const OS = platform();
const specs = ANDROID ? ANDROID_PLAN : PLAN[OS];
if (!specs) {
  console.error(`[fetch-croc] unsupported platform: ${OS}`);
  process.exit(1);
}

// Android names it libcroc.so per ABI; desktop keeps Tauri's sidecar naming.
const destFor = (s) =>
  s.abi
    ? join(ANDROID_JNI_DIR, s.abi, 'libcroc.so')
    : join(BIN_DIR, `croc-${s.triple}${s.exe ? '.exe' : ''}`);
const UNIVERSAL = join(BIN_DIR, 'croc-universal-apple-darwin'); // macOS lipo output (CI universal build)
const stampFile = () => (ANDROID ? ANDROID_STAMP : STAMP);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });

function upToDate() {
  const stamp = stampFile();
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8').trim() !== CROC_VERSION) return false;
  const needed = specs.map(destFor);
  if (!ANDROID && OS === 'darwin') needed.push(UNIVERSAL);
  return needed.every(existsSync);
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (entry.name === name) return p;
  }
  return null;
}

function fetchOne(s) {
  const tmp = mkdtempSync(join(tmpdir(), 'croc-'));
  try {
    const archive = join(tmp, s.asset);
    console.log(`[fetch-croc] downloading ${s.asset}`);
    // Retry with backoff so a transient GitHub blip (504s, dropped connections)
    // doesn't fail the build. curl treats 5xx/timeouts as retryable.
    run('curl', [
      '-fsSL',
      '--retry', '5',
      '--retry-delay', '3',
      '--retry-all-errors',
      '--retry-max-time', '180',
      '--connect-timeout', '30',
      '-o', archive,
      `${BASE}/${s.asset}`,
    ]);
    run('tar', [s.asset.endsWith('.zip') ? '-xf' : '-xzf', archive, '-C', tmp]);
    const binName = s.exe ? 'croc.exe' : 'croc';
    const found = findFile(tmp, binName);
    if (!found) throw new Error(`'${binName}' not found inside ${s.asset}`);
    const dest = destFor(s);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(found, dest);
    if (!s.exe) chmodSync(dest, 0o755);
    console.log(`[fetch-croc] -> ${dest}`);
    return dest;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Cross-compile croc for one Android ABI into jniLibs/<abi>/libcroc.so. */
function buildAndroid(s) {
  const dest = destFor(s);
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`[fetch-croc] building croc ${CROC_VERSION} for android/${s.goarch}`);

  // `go install` refuses to cross-compile with GOBIN set and drops the result in
  // $GOPATH/bin/<goos>_<goarch>/ instead — so clear GOBIN and read that path back.
  const env = { ...process.env, GOOS: 'android', GOARCH: s.goarch, CGO_ENABLED: '0' };
  delete env.GOBIN;
  execFileSync('go', ['install', '-trimpath', '-ldflags=-s -w', CROC_MODULE], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });

  const gopath = execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8', env }).trim();
  const built = join(gopath, 'bin', `android_${s.goarch}`, 'croc');
  if (!existsSync(built)) throw new Error(`go install produced nothing at ${built}`);
  copyFileSync(built, dest);
  chmodSync(dest, 0o755);
  console.log(`[fetch-croc] -> ${dest}`);
  return dest;
}

if (upToDate()) {
  console.log(`[fetch-croc] croc ${CROC_VERSION} already present — skipping`);
  process.exit(0);
}

if (ANDROID) {
  mkdirSync(ANDROID_JNI_DIR, { recursive: true });
  specs.forEach(buildAndroid);
  writeFileSync(ANDROID_STAMP, `${CROC_VERSION}\n`);
  console.log(`[fetch-croc] done (croc ${CROC_VERSION}, android jniLibs)`);
  process.exit(0);
}

mkdirSync(BIN_DIR, { recursive: true });
const produced = specs.map(fetchOne);

if (OS === 'darwin') {
  console.log('[fetch-croc] lipo -> universal');
  run('lipo', ['-create', ...produced, '-output', UNIVERSAL]);
  chmodSync(UNIVERSAL, 0o755);
  console.log(`[fetch-croc] -> ${UNIVERSAL}`);
}

writeFileSync(stampFile(), `${CROC_VERSION}\n`);
console.log(`[fetch-croc] done (croc ${CROC_VERSION})`);
