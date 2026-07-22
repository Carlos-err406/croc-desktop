import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { shareText } from '@choochmeque/tauri-plugin-sharekit-api';
import { Camera, Check, Copy, Loader2, Lock, Plus, Share2, Terminal, X } from 'lucide-react';
import type { StatEntry } from '@/lib/services/ipc';
import type { UseSend } from '@/lib/useSend';
import { croc } from '@/lib/services/ipc';
import { typeColor } from '@/lib/badge';
import { copyText } from '@/lib/clipboard';
import { Button } from '@/components/ui/button';
import { StatusChip, type ChipStatus } from '@/components/ui/status-chip';
import { MiddleTruncate } from '@/components/ui/middle-truncate';
import { CrocBadge } from '@/components/CrocLogo';

const TITLE: Record<string, string> = {
  idle: 'Send files',
  staging: 'Ready to send',
  starting: 'Starting…',
  waiting: 'Share your code',
  transferring: 'Sending…',
  done: 'Sent',
  error: 'Send failed',
};

function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  return (
    <span
      className={`shrink-0 font-heading font-semibold text-white ${
        small ? 'rounded-[5px] px-1.5 py-0.5 text-[10px]' : 'rounded-[6px] px-[7px] py-[3px] text-[11px]'
      }`}
      style={{ background: typeColor(type) }}
    >
      {type}
    </span>
  );
}

function totalBytes(entries: StatEntry[]) {
  return entries.reduce((a, e) => a + e.size, 0);
}
function humanBytes(n: number): string {
  if (n <= 0) return '0 B';
  if (n < 1000) return `${Math.round(n)} B`;
  const u = ['kB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

interface Step {
  kind: 'done' | 'active' | 'brand' | 'pending';
  title: string;
  sub: string;
  line: boolean;
}
function buildSteps(status: string): Step[] {
  if (status === 'waiting')
    return [
      { kind: 'done', title: 'Relay connected', sub: 'croc.schollz.com', line: true },
      { kind: 'done', title: 'Code generated', sub: 'PAKE secret ready', line: true },
      { kind: 'active', title: 'Waiting for peer', sub: 'share the code to continue', line: true },
      { kind: 'pending', title: 'Transfer', sub: 'starts when peer joins', line: false },
    ];
  if (status === 'transferring')
    return [
      { kind: 'done', title: 'Relay connected', sub: 'croc.schollz.com', line: true },
      { kind: 'done', title: 'Code generated', sub: 'PAKE secret ready', line: true },
      { kind: 'done', title: 'Peer connected', sub: 'secure channel open', line: true },
      { kind: 'brand', title: 'Transferring', sub: 'streaming encrypted bytes', line: false },
    ];
  return [
    { kind: 'done', title: 'Relay connected', sub: 'croc.schollz.com', line: true },
    { kind: 'done', title: 'Code generated', sub: 'PAKE secret ready', line: true },
    { kind: 'done', title: 'Peer connected', sub: 'secure channel open', line: true },
    { kind: 'done', title: 'Transfer complete', sub: 'all bytes delivered', line: false },
  ];
}

function CopyPill({ value, label, icon }: { value: string; label: string; icon: 'code' | 'cmd' }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={icon === 'code' ? 'default' : 'outline'}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }
      }}
    >
      {copied ? <Check /> : icon === 'code' ? <Copy /> : <Terminal />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function SendScreen({ send, onViewHistory }: { send: UseSend; onViewHistory: () => void }) {
  const { status, entries, result, progress, error } = send;
  const [dragging, setDragging] = useState(false);
  const [sharedCopied, setSharedCopied] = useState(false);

  // Tauri delivers native file drops (with real filesystem paths, incl. folders)
  // at the window level — HTML5 DnD in a webview yields no paths. Subscribe while
  // the Send screen is mounted; a ref gives the handler the latest status so a
  // drop only stages when we're idle/staging (never mid-transfer).
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        const idle = statusRef.current === 'idle' || statusRef.current === 'starting';
        if (p.type === 'enter' || p.type === 'over') {
          if (idle) setDragging(true);
        } else if (p.type === 'leave') {
          setDragging(false);
        } else if (p.type === 'drop') {
          setDragging(false);
          if ((idle || statusRef.current === 'staging') && p.paths.length) {
            send.stage(p.paths);
          }
        }
      })
      .then((f) => {
        unlisten = f;
      });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the OS share sheet with the code + join command as text (works in
  // every target — Messages, Mail, Notes, AirDrop, chat apps). The in-app QR
  // panel handles scanning. If the share sheet is unavailable, copy the code.
  const shareTransfer = async () => {
    if (!result) return;
    const text =
      `Sending you files with croc — code: ${result.code}\n` +
      `Scan the QR, or run:  ${result.receiveCommand.posix}`;
    try {
      await shareText(text);
    } catch {
      if (await copyText(result.code)) {
        setSharedCopied(true);
        setTimeout(() => setSharedCopied(false), 1600);
      }
    }
  };

  const total = totalBytes(entries);
  const totalHuman = humanBytes(total);
  const countLabel = `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`;
  const percent = progress?.percent ?? 0;
  const active = status === 'waiting' || status === 'transferring' || status === 'done';
  const inFlight = status === 'transferring' && percent < 100;
  const complete = status === 'done';

  const subtitle =
    status === 'staging'
      ? `${countLabel} · ${totalHuman} total`
      : status === 'waiting'
        ? 'The transfer starts the moment your peer joins.'
        : status === 'transferring'
          ? `${countLabel} · ${totalHuman}`
          : status === 'done'
            ? 'Your files were delivered end-to-end encrypted.'
            : status === 'error'
              ? 'Something interrupted the transfer.'
              : 'Drag anything in — Croc handles the rest.';

  const chip: { s: ChipStatus; l: string } | null = complete
    ? { s: 'success', l: 'Delivered' }
    : status === 'waiting'
      ? { s: 'warning', l: 'Waiting' }
      : status === 'transferring'
        ? { s: 'info', l: 'Transferring' }
        : status === 'error'
          ? { s: 'error', l: 'Failed' }
          : null;

  async function browse() {
    const [, paths] = await croc.pickPaths();
    if (paths && paths.length) send.stage(paths);
  }
  // per-file progress (sequential, weighted by size) — mirrors the design
  const transferred = total * (percent / 100);
  let acc = 0;
  const fileRows = entries.map((e) => {
    const start = acc;
    acc += e.size;
    let pct = 0;
    if (complete) pct = 100;
    else if (e.size === 0) pct = percent >= 100 ? 100 : 0;
    else if (transferred >= start + e.size) pct = 100;
    else if (transferred <= start) pct = 0;
    else pct = Math.round(((transferred - start) / e.size) * 100);
    return { ...e, pct, showBar: status === 'transferring' && pct < 100, showCheck: complete || (status === 'transferring' && pct >= 100) };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex items-start justify-between gap-4 px-8 pt-[26px]">
        <div>
          <div className="font-heading text-[26px] font-semibold tracking-[.01em]">{TITLE[status]}</div>
          <div className="mt-[3px] text-[13px] text-muted-foreground">{subtitle}</div>
        </div>
        {chip && <StatusChip status={chip.s}>{chip.l}</StatusChip>}
      </div>

      {/* idle */}
      {(status === 'idle' || status === 'starting') && (
        <div className="flex min-h-0 flex-1 flex-col px-8 pb-8 pt-[22px]">
          <div
            role="button"
            tabIndex={0}
            onClick={browse}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && browse()}
            className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-[18px] border-2 border-dashed bg-transparent text-center outline-none transition-colors duration-150 ${
              dragging ? 'border-brand' : 'border-border'
            }`}
          >
            <CrocBadge size={76} className="shadow-[0_12px_30px_-10px_rgba(30,80,40,.35)]" />
            <div className="mt-[22px] font-heading text-2xl font-semibold">Drop files or a folder to send</div>
            <div className="mt-1.5 max-w-[340px] text-sm text-muted-foreground">
              Croc creates a one-time code. Share it, and the transfer runs encrypted, straight to the
              other device.
            </div>
            <div className="mt-[22px]" onClick={(e) => e.stopPropagation()}>
              <Button onClick={browse}>Browse files…</Button>
            </div>
            {status === 'starting' && (
              <div className="mt-[18px] flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Starting croc…
              </div>
            )}
          </div>
        </div>
      )}

      {/* staging */}
      {status === 'staging' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 pb-7 pt-[22px]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border">
            <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
              <span className="text-sm font-semibold">{countLabel} ready to send</span>
              <span onClick={send.clear} className="cursor-pointer text-[13px] text-muted-foreground">
                Clear all
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
              {entries.map((f) => (
                <div
                  key={f.path}
                  className="croc-file flex items-center gap-3 rounded-[11px] border border-border bg-card px-3 py-[11px]"
                >
                  <TypeBadge type={f.type} />
                  <MiddleTruncate text={f.name} className="flex-1 text-[13px] font-medium" />
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{f.sizeHuman}</span>
                  <span
                    className="croc-file-x flex cursor-pointer text-muted-foreground"
                    onClick={() => send.removeEntry(f.path)}
                  >
                    <X size={15} />
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-[11px] text-center text-xs text-muted-foreground">
              Drop more files here, or use Add
            </div>
          </div>
          <div className="flex gap-2.5">
            <Button variant="outline" className="h-11 flex-1" onClick={browse}>
              <Plus /> Add more
            </Button>
            <Button className="h-11 flex-[2]" onClick={send.begin}>
              Generate code &amp; send
            </Button>
          </div>
        </div>
      )}

      {/* active: two-column */}
      {active && (
        <div className="flex min-h-0 flex-1 gap-5 px-8 pb-7 pt-5">
          {/* LEFT — transparent so it blends into the layout brand wash */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-transparent">
            {status === 'waiting' && result && (
              <>
                <div className="flex flex-col items-center gap-3 bg-[linear-gradient(150deg,var(--brand),var(--brand-deep))] px-6 pb-6 pt-[22px]">
                  <div className="flex items-center gap-[7px] text-[11px] tracking-[.14em] text-white/80">
                    <Lock size={13} /> TRANSFER CODE
                  </div>
                  <CopyCodeButton code={result.code} />
                  {result.qr && (
                    <div className="rounded-[14px] bg-white p-3 shadow-[0_16px_34px_-14px_rgba(20,5,60,.55)]">
                      <img src={result.qr} alt="QR" width={118} height={118} className="block" draggable={false} />
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-white/85">
                    <Camera size={13} /> Point a phone camera to receive
                  </div>
                </div>
                <div className="flex flex-1 flex-col justify-center gap-3 p-[18px]">
                  <Button className="w-full" onClick={shareTransfer}>
                    {sharedCopied ? <Check /> : <Share2 />} {sharedCopied ? 'Code copied' : 'Share…'}
                  </Button>
                  <div className="flex justify-center gap-2.5">
                    <CopyPill value={result.code} label="Copy code" icon="code" />
                    <CopyPill value={result.receiveCommand.posix} label="Copy command" icon="cmd" />
                  </div>
                  <div className="flex items-center justify-center gap-[7px] text-xs text-muted-foreground">
                    <Lock size={13} className="text-success-text" /> Code works once, then expires
                  </div>
                </div>
              </>
            )}

            {(status === 'transferring' || complete) && (
              <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[22px] px-[26px] py-[30px]">
                <div className="text-center">
                  <div className="font-heading text-[68px] font-semibold leading-none text-brand-deep">{complete ? 100 : percent}%</div>
                  <div className="mt-2 text-[13px] text-muted-foreground">
                    {complete
                      ? 'Transfer complete'
                      : progress?.speedHuman
                        ? `${progress.speedHuman}${progress.etaHuman ? ` · ETA ${progress.etaHuman}` : ''}`
                        : 'Transferring…'}
                  </div>
                </div>
                <div className="h-3 w-full max-w-[420px] overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-deep))] transition-[width] duration-200"
                    style={{ width: `${complete ? 100 : percent}%` }}
                  />
                </div>
                {complete ? (
                  <div className="flex w-full min-w-0 items-center justify-center gap-2 text-[13px] font-medium text-success-text">
                    <Check size={16} strokeWidth={3} className="shrink-0" />
                    {entries.length > 1 ? (
                      <span className="shrink-0">All {entries.length} items delivered securely</span>
                    ) : (
                      <>
                        <MiddleTruncate text={entries[0]?.name ?? send.fileInfo?.name ?? 'File'} className="flex-[0_1_auto] font-medium" />
                        <span className="shrink-0">delivered securely</span>
                      </>
                    )}
                  </div>
                ) : (
                  inFlight && (
                    <div className="flex w-full min-w-0 items-center justify-center gap-1.5 text-[13px]">
                      <span className="relative flex h-[9px] w-[9px] shrink-0">
                        <span className="absolute h-full w-full animate-[crocping_1.4s_ease-out_infinite] rounded-full bg-brand opacity-50" />
                        <span className="relative h-[9px] w-[9px] rounded-full bg-brand" />
                      </span>
                      <span className="shrink-0">Sending</span>
                      <MiddleTruncate
                        text={send.fileInfo?.name ?? entries[0]?.name ?? ''}
                        className="flex-[0_1_auto] font-medium"
                      />
                      {progress?.transferredHuman && progress?.totalHuman && (
                        <span className="shrink-0 text-muted-foreground">
                          · {progress.transferredHuman} / {progress.totalHuman}
                        </span>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* RIGHT */}
          <div className="flex min-h-0 w-[332px] shrink-0 flex-col gap-3.5">
            <div className="rounded-[14px] border border-border bg-card p-[18px]">
              <div className="mb-4 text-[13px] font-semibold">Connection</div>
              {buildSteps(status).map((s, i) => (
                <TimelineStep key={i} step={s} />
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto rounded-[14px] border border-border bg-card px-4 py-[15px]">
              <div className="text-[13px] font-semibold">Files</div>
              {fileRows.map((f) => (
                <div key={f.path} className="flex flex-col gap-[7px]">
                  <div className="flex items-center gap-[9px] text-[13px]">
                    <TypeBadge type={f.type} small />
                    <MiddleTruncate text={f.name} className="flex-1" />
                    <span
                      className={`ml-auto flex shrink-0 items-center gap-[5px] pl-1.5 text-xs ${
                        f.showBar ? 'text-brand-deep' : 'text-muted-foreground'
                      }`}
                    >
                      {f.showCheck && <Check size={13} className="text-success-text" />}
                      {f.showBar ? `${f.pct}%` : f.sizeHuman}
                    </span>
                  </div>
                  {f.showBar && (
                    <div className="h-[5px] overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-200"
                        style={{ width: `${f.pct}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {complete ? (
              <div className="flex gap-2.5">
                <Button className="flex-1" onClick={send.reset}>Send more</Button>
                <Button variant="outline" className="flex-1" onClick={onViewHistory}>
                  View in history
                </Button>
              </div>
            ) : (status === 'waiting' || inFlight) ? (
              <Button variant="outline" className="w-full" onClick={send.cancel}>
                Cancel transfer
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="px-8 pb-7">
          <div className="rounded-[14px] border border-error-text bg-error-surface p-4 text-error-text">
            <div className="mb-1 font-semibold">Transfer failed</div>
            {error && <div className="text-[13px]">{error}</div>}
          </div>
          <div className="mt-3.5">
            <Button onClick={send.reset}>Try again</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        if (await copyText(code)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }
      }}
      className="flex cursor-pointer items-center gap-3.5 rounded-xl border border-white/[.28] bg-white/[.14] px-[18px] py-2.5"
    >
      <span className="font-heading text-[26px] font-semibold tracking-[.03em] text-white whitespace-nowrap">
        {code}
      </span>
      {copied ? <Check size={18} className="text-white" /> : <Copy size={18} className="text-white/85" />}
    </button>
  );
}

function TimelineStep({ step }: { step: Step }) {
  const ring =
    step.kind === 'done'
      ? 'bg-success-surface text-success-text'
      : step.kind === 'active'
        ? 'border-2 border-warning-text text-warning-text'
        : step.kind === 'brand'
          ? 'border-2 border-brand text-brand'
          : 'bg-secondary text-muted-foreground';
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ${ring}`}>
          {step.kind === 'done' ? (
            <Check size={13} strokeWidth={3} />
          ) : step.kind === 'pending' ? (
            <span className="h-[5px] w-[5px] rounded-full bg-current opacity-50" />
          ) : (
            <span className="h-[7px] w-[7px] rounded-full bg-current" />
          )}
        </span>
        {step.line && <span className="my-[3px] min-h-4 w-0.5 flex-1 bg-border" />}
      </div>
      <div className="pb-3">
        <div className={`text-[13px] font-medium ${step.kind === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>
          {step.title}
        </div>
        <div className="text-xs text-muted-foreground">{step.sub}</div>
      </div>
    </div>
  );
}
