import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { IPty } from 'node-pty';

// Strip ANSI escape sequences (colors, cursor moves) from croc's TTY output.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const CROC_EXE = process.platform === 'win32' ? 'croc.exe' : 'croc';

/**
 * Resolve the croc binary. Priority:
 *   1. CROC_BIN env override
 *   2. bundled binary shipped with the packaged app (resources/croc)
 *   3. a binary on PATH (dev machines / Homebrew installs)
 */
export function findCrocBinary(): string | null {
  if (process.env.CROC_BIN && fs.existsSync(process.env.CROC_BIN)) {
    return process.env.CROC_BIN;
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'croc', CROC_EXE);
    if (fs.existsSync(bundled)) return bundled;
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  const extraDirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  for (const dir of [...pathDirs, ...extraDirs]) {
    if (!dir) continue;
    try {
      const candidate = path.join(dir, CROC_EXE);
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export interface CrocProgress {
  percent: number;
  transferredHuman?: string | null;
  totalHuman?: string | null;
  speedHuman?: string | null;
  etaHuman?: string | null;
}

export interface CrocFileInfo {
  name: string;
  totalHuman: string;
}

export interface CrocSendOptions {
  code: string;
  relay?: string;
}

type CrocSendEvents = {
  log: [line: string];
  waiting: [];
  peer: [];
  'file-info': [info: CrocFileInfo];
  progress: [progress: CrocProgress];
  done: [];
  error: [payload: { message: string }];
  exit: [payload: { code: number }];
};

// Merge typed event signatures onto the EventEmitter base.
export declare interface CrocSend {
  on<K extends keyof CrocSendEvents>(event: K, listener: (...args: CrocSendEvents[K]) => void): this;
  emit<K extends keyof CrocSendEvents>(event: K, ...args: CrocSendEvents[K]): boolean;
}

/**
 * A single croc `send` transfer, spawned through a pseudo-terminal so croc
 * emits its (TTY-gated) progress bar, which we parse into typed events.
 */
export class CrocSend extends EventEmitter {
  private proc: IPty | null = null;
  private sawProgress = false;
  private finished = false;
  private lineBuf = '';
  private logCount = 0;
  private totalLines = 0;

  // The UI only keeps the tail of the log; cap emissions so a chatty (or
  // misbehaving) process can't flood IPC.
  private static readonly MAX_LOG_EMITS = 1000;
  // Absolute backstop against a runaway output loop (never hit by a real transfer).
  private static readonly MAX_TOTAL_LINES = 100_000;

  async start(paths: string[], opts: CrocSendOptions): Promise<void> {
    const bin = findCrocBinary();
    if (!bin) {
      throw new Error(
        'croc binary not found. Install croc (e.g. `brew install croc`) or set CROC_BIN.'
      );
    }

    let pty: typeof import('node-pty');
    try {
      pty = await import('node-pty');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `node-pty failed to load. Run \`npm run postinstall\` to build it for Electron. (${msg})`
      );
    }

    // croc v10 refuses a code as a CLI arg (`--code`); it must come via the
    // CROC_SECRET env var. Global flags like --relay must precede the subcommand.
    const args: string[] = [];
    if (opts.relay) args.push('--relay', opts.relay);
    args.push('send', ...paths);

    // Ensure common install dirs are on PATH for the spawned process.
    const extraPath = ['/opt/homebrew/bin', '/usr/local/bin'].join(path.delimiter);
    const env = {
      ...process.env,
      PATH: `${process.env.PATH || ''}${path.delimiter}${extraPath}`,
      CROC_SECRET: opts.code,
    };

    this.proc = pty.spawn(bin, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: os.homedir(),
      env,
    });

    this.proc.onData((data) => this.ingest(data));
    this.proc.onExit(({ exitCode }) => {
      if (this.lineBuf) {
        this.handleLine(this.lineBuf);
        this.lineBuf = '';
      }
      if (!this.finished) {
        this.finished = true;
        if (exitCode === 0) this.emit('done');
        else this.emit('error', { message: `croc exited with code ${exitCode}.` });
      }
      this.emit('exit', { code: exitCode });
    });
  }

  private ingest(data: string): void {
    if (this.finished) return;
    // croc redraws its progress bar with carriage returns; treat both \r and \n
    // as line boundaries so each bar redraw is a fresh parseable line.
    this.lineBuf += data;
    const parts = this.lineBuf.split(/\r\n|\r|\n/);
    this.lineBuf = parts.pop() ?? '';
    for (const raw of parts) this.handleLine(raw);
  }

  private handleLine(raw: string): void {
    if (this.finished) return;

    // Runaway backstop: kill and error out rather than allocate without bound.
    this.totalLines += 1;
    if (this.totalLines > CrocSend.MAX_TOTAL_LINES) {
      this.finished = true;
      this.emit('error', { message: 'Aborted: unexpected runaway output from croc.' });
      this.cancel();
      return;
    }

    const line = raw.replace(ANSI, '').trim();
    if (!line) return;

    if (this.logCount < CrocSend.MAX_LOG_EMITS) {
      this.logCount += 1;
      this.emit('log', line);
    }

    // A receiver connected: croc prints "Sending (->1.2.3.4:9009)".
    if (/Sending\s*\(->/.test(line)) this.emit('peer');

    // What we're sending: "Sending 'file.txt' (293 kB)" / "Sending 3 files (1.2 MB)".
    // (croc emits a transient "Sending 0 files (...)" first — ignore that.)
    const info = line.match(
      /^Sending\s+(?:(\d+)\s+files?|'?(.+?)'?)\s+\(([\d.]+\s*[kKmMgGtT]?i?[bB])\)/
    );
    if (info && !/\(->/.test(line) && info[1] !== '0') {
      const count = info[1];
      const name = count ? `${count} files` : info[2];
      this.emit('file-info', { name, totalHuman: info[3] });
    }

    // Progress bar line: has a percent and, usually, "(x/y unit, speed/s)".
    // croc shares the unit across transferred/total, e.g. "(41/41 B, 62 kB/s)".
    const pct = line.match(/(\d{1,3})%/);
    if (pct) {
      const percent = Math.min(100, parseInt(pct[1], 10));
      const stats = line.match(
        /\(\s*([\d.]+(?:\s*[kKmMgGtT]?i?[bB])?)\s*\/\s*([\d.]+\s*[kKmMgGtT]?i?[bB])(?:,\s*([\d.]+\s*[kKmMgGtT]?i?[bB]\/s))?/
      );
      const eta = line.match(/\[([\dhms:]+)\s*:\s*([\dhms:]+)\]/);
      this.sawProgress = true;
      this.emit('progress', {
        percent,
        transferredHuman: stats ? stats[1] : null,
        totalHuman: stats ? stats[2] : null,
        speedHuman: stats ? stats[3] : null,
        etaHuman: eta ? eta[2] : null,
      });
      return;
    }

    // Before any progress and before a peer connects, we're waiting on the relay.
    if (!this.sawProgress && /(sending|code is|on the other computer)/i.test(line)) {
      this.emit('waiting');
    }
  }

  cancel(): void {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        /* already gone */
      }
    }
  }
}
