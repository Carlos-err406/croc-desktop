import { useRef, useState } from 'react';
import { Camera, Check, CheckCircle2, Copy, Loader2, Lock, Plus, Terminal, X } from 'lucide-react';
import type { StatEntry } from '@/lib/services/ipc';
import type { UseSend } from '@/lib/useSend';
import { croc } from '@/lib/services/ipc';
import { pathsFromFileList } from '@/lib/paths';
import { typeColor } from '@/lib/badge';
import { copyText } from '@/lib/clipboard';
import { Button } from '@/components/ui/button';
import { StatusChip, type ChipStatus } from '@/components/ui/status-chip';
import { MiddleTruncate } from '@/components/ui/middle-truncate';
import { CrocMark } from '@/components/CrocLogo';

const HEADING = 'var(--font-heading)';

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
      style={{
        fontFamily: HEADING,
        fontSize: small ? 10 : 11,
        fontWeight: 600,
        color: '#fff',
        borderRadius: small ? 5 : 6,
        padding: small ? '2px 6px' : '3px 7px',
        background: typeColor(type),
        flexShrink: 0,
      }}
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
  const depth = useRef(0);

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
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const paths = pathsFromFileList(e.dataTransfer.files);
    if (paths.length) send.stage(paths);
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header */}
      <div
        style={{
          padding: '26px 32px 0',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 600, letterSpacing: '.01em' }}>
            {TITLE[status]}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 3 }}>{subtitle}</div>
        </div>
        {chip && <StatusChip status={chip.s}>{chip.l}</StatusChip>}
      </div>

      {/* idle */}
      {(status === 'idle' || status === 'starting') && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '22px 32px 32px', minHeight: 0 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={browse}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && browse()}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => {
              e.preventDefault();
              depth.current += 1;
              setDragging(true);
            }}
            onDragLeave={() => {
              depth.current -= 1;
              if (depth.current <= 0) setDragging(false);
            }}
            onDrop={onDrop}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: `2px dashed ${dragging ? 'var(--brand)' : 'var(--border)'}`,
              borderRadius: 18,
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'center',
              outline: 'none',
              transition: 'border-color .15s',
            }}
          >
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: 22,
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 12px 30px -10px rgba(30,80,40,.35)',
              }}
            >
              <CrocMark width={52} height={34} fill="var(--brand-deep)" dot="#fff" />
            </div>
            <div style={{ fontFamily: HEADING, fontSize: 24, fontWeight: 600, marginTop: 22 }}>
              Drop files or a folder to send
            </div>
            <div style={{ fontSize: 14, color: 'var(--muted-foreground)', marginTop: 6, maxWidth: 340 }}>
              Croc creates a one-time code. Share it, and the transfer runs encrypted, straight to the
              other device.
            </div>
            <div style={{ marginTop: 22 }} onClick={(e) => e.stopPropagation()}>
              <Button onClick={browse}>Browse files…</Button>
            </div>
            {status === 'starting' && (
              <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted-foreground)', fontSize: 13 }}>
                <Loader2 className="size-4 animate-spin" /> Starting croc…
              </div>
            )}
          </div>
        </div>
      )}

      {/* staging */}
      {status === 'staging' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '22px 32px 28px', minHeight: 0, gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{countLabel} ready to send</span>
              <span onClick={send.clear} style={{ fontSize: 13, color: 'var(--muted-foreground)', cursor: 'pointer' }}>
                Clear all
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map((f) => (
                <div
                  key={f.path}
                  className="croc-file"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 11, background: 'var(--card)' }}
                >
                  <TypeBadge type={f.type} />
                  <MiddleTruncate text={f.name} style={{ flex: 1, fontSize: 13, fontWeight: 500 }} />
                  <span style={{ marginLeft: 'auto', paddingLeft: 8, fontSize: 12, color: 'var(--muted-foreground)', flexShrink: 0 }}>{f.sizeHuman}</span>
                  <span className="croc-file-x" onClick={() => send.removeEntry(f.path)} style={{ cursor: 'pointer', color: 'var(--muted-foreground)', display: 'flex' }}>
                    <X size={15} />
                  </span>
                </div>
              ))}
            </div>
            <div style={{ padding: 11, borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)' }}>
              Drop more files here, or use Add
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
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
        <div style={{ flex: 1, display: 'flex', gap: 20, padding: '20px 32px 28px', minHeight: 0 }}>
          {/* LEFT — transparent so it blends into the layout brand wash */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'transparent', minWidth: 0 }}>
            {status === 'waiting' && result && (
              <>
                <div style={{ background: 'linear-gradient(150deg,var(--brand),var(--brand-deep))', padding: '22px 24px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, letterSpacing: '.14em', color: 'rgba(255,255,255,.8)' }}>
                    <Lock size={13} /> TRANSFER CODE
                  </div>
                  <CopyCodeButton code={result.code} />
                  {result.qr && (
                    <div style={{ background: '#fff', borderRadius: 14, padding: 12, boxShadow: '0 16px 34px -14px rgba(20,5,60,.55)' }}>
                      <img src={result.qr} alt="QR" width={118} height={118} style={{ display: 'block' }} draggable={false} />
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,.85)' }}>
                    <Camera size={13} /> Point a phone camera to receive
                  </div>
                </div>
                <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <CopyPill value={result.code} label="Copy code" icon="code" />
                    <CopyPill value={result.receiveCommand.posix} label="Copy command" icon="cmd" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 12, color: 'var(--muted-foreground)' }}>
                    <Lock size={13} style={{ color: 'var(--success-text)' }} /> Code works once, then expires
                  </div>
                </div>
              </>
            )}

            {status === 'transferring' && (
              <div style={{ flex: 1, padding: '30px 26px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 22, minWidth: 0 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: HEADING, fontSize: 68, fontWeight: 600, lineHeight: 1, color: 'var(--brand-deep)' }}>{percent}%</div>
                  <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 8 }}>
                    {progress?.speedHuman ? `${progress.speedHuman}${progress.etaHuman ? ` · ETA ${progress.etaHuman}` : ''}` : 'Transferring…'}
                  </div>
                </div>
                <div style={{ width: '100%', maxWidth: 420, height: 12, borderRadius: 999, background: 'var(--secondary)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,var(--brand),var(--brand-deep))', width: `${percent}%`, transition: 'width .2s ease' }} />
                </div>
                {inFlight && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, width: '100%', minWidth: 0 }}>
                    <span style={{ position: 'relative', display: 'flex', width: 9, height: 9, flexShrink: 0 }}>
                      <span style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', background: 'var(--brand)', opacity: 0.5, animation: 'crocping 1.4s ease-out infinite' }} />
                      <span style={{ position: 'relative', width: 9, height: 9, borderRadius: '50%', background: 'var(--brand)' }} />
                    </span>
                    <span style={{ flexShrink: 0 }}>Sending</span>
                    <MiddleTruncate
                      text={send.fileInfo?.name ?? entries[0]?.name ?? ''}
                      style={{ flex: '0 1 auto', fontWeight: 500 }}
                    />
                    {progress?.transferredHuman && progress?.totalHuman && (
                      <span style={{ flexShrink: 0, color: 'var(--muted-foreground)' }}>
                        · {progress.transferredHuman} / {progress.totalHuman}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {status === 'done' && (
              <div style={{ flex: 1, padding: '30px 26px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--success-surface)', color: 'var(--success-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircle2 size={32} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: 'var(--success-text)' }}>
                  {countLabel} · {totalHuman} delivered securely
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button onClick={send.reset}>Send more</Button>
                  <Button variant="outline" onClick={onViewHistory}>
                    View in history
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT */}
          <div style={{ width: 332, display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 0, minHeight: 0 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 18, background: 'var(--card)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Connection</div>
              {buildSteps(status).map((s, i) => (
                <TimelineStep key={i} step={s} />
              ))}
            </div>
            <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 14, padding: '15px 16px', background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', minHeight: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Files</div>
              {fileRows.map((f) => (
                <div key={f.path} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                    <TypeBadge type={f.type} small />
                    <MiddleTruncate text={f.name} style={{ flex: 1 }} />
                    <span style={{ marginLeft: 'auto', paddingLeft: 6, fontSize: 12, color: f.showBar ? 'var(--brand-deep)' : 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      {f.showCheck && <Check size={13} style={{ color: 'var(--success-text)' }} />}
                      {f.showBar ? `${f.pct}%` : f.sizeHuman}
                    </span>
                  </div>
                  {f.showBar && (
                    <div style={{ height: 5, borderRadius: 999, background: 'var(--secondary)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: 'var(--brand)', width: `${f.pct}%`, transition: 'width .2s ease' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {(status === 'waiting' || inFlight) && (
              <Button variant="outline" className="w-full" onClick={send.cancel}>
                Cancel transfer
              </Button>
            )}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div style={{ padding: '0 32px 28px' }}>
          <div style={{ border: '1px solid var(--error-text)', background: 'var(--error-surface)', borderRadius: 14, padding: 16, color: 'var(--error-text)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Transfer failed</div>
            {error && <div style={{ fontSize: 13 }}>{error}</div>}
          </div>
          <div style={{ marginTop: 14 }}>
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
      style={{
        font: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'rgba(255,255,255,.14)',
        border: '1px solid rgba(255,255,255,.28)',
        borderRadius: 12,
        padding: '10px 18px',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 600, color: '#fff', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>
        {code}
      </span>
      {copied ? <Check size={18} color="#fff" /> : <Copy size={18} color="rgba(255,255,255,.85)" />}
    </button>
  );
}

function TimelineStep({ step }: { step: Step }) {
  const ring =
    step.kind === 'done'
      ? { bg: 'var(--success-surface)', fg: 'var(--success-text)', border: 'none' }
      : step.kind === 'active'
        ? { bg: 'transparent', fg: 'var(--warning-text)', border: '2px solid var(--warning-text)' }
        : step.kind === 'brand'
          ? { bg: 'transparent', fg: 'var(--brand)', border: '2px solid var(--brand)' }
          : { bg: 'var(--secondary)', fg: 'var(--muted-foreground)', border: 'none' };
  const titleColor = step.kind === 'pending' ? 'var(--muted-foreground)' : 'var(--foreground)';
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: ring.bg, color: ring.fg, border: ring.border }}>
          {step.kind === 'done' ? (
            <Check size={13} strokeWidth={3} />
          ) : step.kind === 'pending' ? (
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', opacity: 0.5 }} />
          ) : (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
          )}
        </span>
        {step.line && <span style={{ flex: 1, width: 2, minHeight: 16, background: 'var(--border)', margin: '3px 0' }} />}
      </div>
      <div style={{ paddingBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: titleColor }}>{step.title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{step.sub}</div>
      </div>
    </div>
  );
}
