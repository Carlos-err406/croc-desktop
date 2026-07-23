#!/usr/bin/env node
/**
 * Fetch the pinned `croc` release and lay it down as Tauri externalBin sidecars
 * at src-tauri/binaries/croc-<target-triple>[.exe]. Runs from beforeBuildCommand /
 * beforeDevCommand so local builds and CI are self-contained (no croc on PATH needed).
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

const CROC_VERSION = 'v10.6.0';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries');
const BASE = `https://github.com/schollz/croc/releases/download/${CROC_VERSION}`;
const STAMP = join(BIN_DIR, '.version');

// croc release asset -> Rust target triple, per host OS.
const PLAN = {
  darwin: [
    { asset: `croc_${CROC_VERSION}_macOS-ARM64.tar.gz`, triple: 'aarch64-apple-darwin' },
    { asset: `croc_${CROC_VERSION}_macOS-64bit.tar.gz`, triple: 'x86_64-apple-darwin' },
  ],
  linux: [{ asset: `croc_${CROC_VERSION}_Linux-64bit.tar.gz`, triple: 'x86_64-unknown-linux-gnu' }],
  win32: [{ asset: `croc_${CROC_VERSION}_Windows-64bit.zip`, triple: 'x86_64-pc-windows-msvc', exe: true }],
};

const OS = platform();
const specs = PLAN[OS];
if (!specs) {
  console.error(`[fetch-croc] unsupported platform: ${OS}`);
  process.exit(1);
}

const destFor = (s) => join(BIN_DIR, `croc-${s.triple}${s.exe ? '.exe' : ''}`);
const UNIVERSAL = join(BIN_DIR, 'croc-universal-apple-darwin'); // macOS lipo output (CI universal build)
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });

function upToDate() {
  if (!existsSync(STAMP) || readFileSync(STAMP, 'utf8').trim() !== CROC_VERSION) return false;
  const needed = specs.map(destFor);
  if (OS === 'darwin') needed.push(UNIVERSAL);
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
    run('curl', ['-fsSL', '-o', archive, `${BASE}/${s.asset}`]);
    run('tar', [s.asset.endsWith('.zip') ? '-xf' : '-xzf', archive, '-C', tmp]);
    const binName = s.exe ? 'croc.exe' : 'croc';
    const found = findFile(tmp, binName);
    if (!found) throw new Error(`'${binName}' not found inside ${s.asset}`);
    const dest = destFor(s);
    copyFileSync(found, dest);
    if (!s.exe) chmodSync(dest, 0o755);
    console.log(`[fetch-croc] -> ${dest}`);
    return dest;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (upToDate()) {
  console.log(`[fetch-croc] croc ${CROC_VERSION} already present — skipping`);
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

writeFileSync(STAMP, `${CROC_VERSION}\n`);
console.log(`[fetch-croc] done (croc ${CROC_VERSION})`);
