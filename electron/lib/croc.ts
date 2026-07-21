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
  percent: number; // per-file percent (croc reports one bar per file)
  transferredHuman?: string | null;
  totalHuman?: string | null;
  speedHuman?: string | null;
  etaHuman?: string | null;
  file?: string | null; // filename this progress line is for
  index?: number | null; // N in the trailing "N/M" (files completed so far)
  count?: number | null; // M in the trailing "N/M" (total files)
}

export interface CrocFileInfo {
  name: string;
  totalHuman: string;
  count?: number; // set when croc reports "N files" (a batch), else a single file
}

type CrocEvents = {
  log: [line: string];
  waiting: []; // send: code live / receive: connecting
  peer: []; // the other side connected
  'file-info': [info: CrocFileInfo];
  progress: [progress: CrocProgress];
  done: [];
  error: [payload: { message: string }];
  exit: [payload: { code: number }];
};

/**
 * Shared plumbing for a croc child process spawned through a pseudo-terminal
 * (croc's progress is TTY-gated). Parses stdout into typed events. Subclasses
 * only build the argv + env for `send` vs `receive`.
 */
abstract class CrocProcess extends EventEmitter {
  protected proc: IPty | null = null;
  private sawProgress = false;
  private finished = false;
  private lineBuf = '';
  private logCount = 0;
  private totalLines = 0;

  private static readonly MAX_LOG_EMITS = 1000;
  private static readonly MAX_TOTAL_LINES = 100_000;

  protected async launch(args: string[], extraEnv: Record<string, string>): Promise<void> {
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
      throw new Error(`node-pty failed to load. Run \`npm run postinstall\`. (${msg})`);
    }

    const extraPath = ['/opt/homebrew/bin', '/usr/local/bin'].join(path.delimiter);
    const env = {
      ...process.env,
      PATH: `${process.env.PATH || ''}${path.delimiter}${extraPath}`,
      ...extraEnv,
    };

    this.proc = pty.spawn(bin, args, {
      name: 'xterm-256color',
      // croc truncates the filename in its progress bar to fit the terminal
      // width and appends a literal "..."; a very wide PTY gives it room to
      // print full filenames (verified: ~8 chars at 80 cols, full at ≥1000).
      cols: 1000,
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
    this.lineBuf += data;
    const parts = this.lineBuf.split(/\r\n|\r|\n/);
    this.lineBuf = parts.pop() ?? '';
    for (const raw of parts) this.handleLine(raw);
  }

  private handleLine(raw: string): void {
    if (this.finished) return;
    this.totalLines += 1;
    if (this.totalLines > CrocProcess.MAX_TOTAL_LINES) {
      this.finished = true;
      this.emit('error', { message: 'Aborted: unexpected runaway output from croc.' });
      this.cancel();
      return;
    }

    const line = raw.replace(ANSI, '').trim();
    if (!line) return;

    if (this.logCount < CrocProcess.MAX_LOG_EMITS) {
      this.logCount += 1;
      this.emit('log', line);
    }

    // The other side connected: "Sending (->ip)" / "Receiving (<-ip)".
    if (/(?:Sending|Receiving)\s*\((?:->|<-)/.test(line)) this.emit('peer');

    // What's being transferred: "Sending 'f' (293 kB)" / "Receiving 3 files (1.2 MB)".
    const info = line.match(
      /^(?:Sending|Receiving)\s+(?:(\d+)\s+files?|'?(.+?)'?)\s+\(([\d.]+\s*[kKmMgGtT]?i?[bB])\)/
    );
    if (info && !/\((?:->|<-)/.test(line) && info[1] !== '0') {
      const count = info[1];
      const name = count ? `${count} files` : info[2];
      this.emit('file-info', {
        name,
        totalHuman: info[3],
        count: count ? parseInt(count, 10) : undefined,
      });
    }

    // A genuine progress line MUST carry transfer stats "(x/y unit[, speed])",
    // so a stray "%" or an announce line is never mistaken for progress.
    const stats = line.match(
      /\(\s*([\d.]+(?:\s*[kKmMgGtT]?i?[bB])?)\s*\/\s*([\d.]+\s*[kKmMgGtT]?i?[bB])(?:,\s*([\d.]+\s*[kKmMgGtT]?i?[bB]\/s))?/
    );
    if (stats) {
      const pctM = line.match(/(\d{1,3})%/);
      const eta = line.match(/\[([\dhms:]+)\s*:\s*([\dhms:]+)\]/);
      // Filename prefix (croc prints "name  57% |…"), and a trailing "N/M" file counter.
      const fileM = line.match(/^(.+?)\s+\d{1,3}%/);
      const nm = line.match(/(\d+)\s*\/\s*(\d+)\s*$/);
      // croc pads/truncates the progress description to the PTY width and
      // appends a literal "..." (three ASCII dots). Strip that trailing marker
      // (and its padding) so it isn't shown, isn't mistaken for a missing file
      // extension (→ "FILE" badge), and doesn't collide with our own ellipsis.
      const file = fileM ? fileM[1].trim().replace(/\s*(?:\.{3,}|…)\s*$/, '').trimEnd() || null : null;
      this.sawProgress = true;
      this.emit('progress', {
        percent: pctM ? Math.min(100, parseInt(pctM[1], 10)) : 0,
        transferredHuman: stats[1],
        totalHuman: stats[2],
        speedHuman: stats[3] ?? null,
        etaHuman: eta ? eta[2] : null,
        file,
        index: nm ? parseInt(nm[1], 10) : null,
        count: nm ? parseInt(nm[2], 10) : null,
      });
      return;
    }

    if (
      !this.sawProgress &&
      /(code is|on the other computer|sending|connecting|securing channel)/i.test(line)
    ) {
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

// Typed event signatures merged onto the base (and inherited by subclasses).
interface CrocProcess {
  emit<K extends keyof CrocEvents>(event: K, ...args: CrocEvents[K]): boolean;
  on<K extends keyof CrocEvents>(event: K, listener: (...args: CrocEvents[K]) => void): this;
}

export interface CrocSendOptions {
  code: string;
  relay?: string;
  zip?: boolean; // `send --zip`: bundle a folder into one transfer (croc auto-extracts on receive)
}

/** `croc [--relay X] send [--zip] <files...>` with the code via CROC_SECRET. */
export class CrocSend extends CrocProcess {
  async start(paths: string[], opts: CrocSendOptions): Promise<void> {
    const args: string[] = [];
    if (opts.relay) args.push('--relay', opts.relay);
    args.push('send');
    // `--zip` collapses a folder's per-file protocol overhead into a single
    // transfer (~6× faster for many files); croc auto-extracts it on the other
    // end. It only affects folders — a no-op for loose files — so it's safe to
    // always pass when enabled.
    if (opts.zip) args.push('--zip');
    args.push(...paths);
    await this.launch(args, { CROC_SECRET: opts.code });
  }
}

export interface CrocReceiveOptions {
  code: string;
  out: string;
  relay?: string;
}

/** `croc [--relay X] --out DIR --yes --overwrite` with the code via CROC_SECRET. */
export class CrocReceive extends CrocProcess {
  async start(opts: CrocReceiveOptions): Promise<void> {
    const args: string[] = [];
    if (opts.relay) args.push('--relay', opts.relay);
    if (opts.out) args.push('--out', opts.out);
    args.push('--yes', '--overwrite');
    await this.launch(args, { CROC_SECRET: opts.code });
  }
}
