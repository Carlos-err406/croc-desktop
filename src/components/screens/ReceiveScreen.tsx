import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Folder, MessageSquareText, QrCode, X } from 'lucide-react';
import type { UseReceive } from '@/lib/useReceive';
import { croc } from '@/lib/services/ipc';
import { getPrefs } from '@/lib/prefs';
import { abbrevHome } from '@/lib/paths';
import { typeColor } from '@/lib/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MiddleTruncate } from '@/components/ui/middle-truncate';

function extType(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'FILE';
  return name.slice(dot + 1).toUpperCase().slice(0, 4);
}

function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="shrink-0 rounded-[5px] px-1.5 py-0.5 font-heading text-[10px] font-semibold text-white"
      style={{ background: typeColor(type) }}
    >
      {type}
    </span>
  );
}

interface Step {
  kind: 'done' | 'active' | 'brand' | 'pending';
  title: string;
  sub: string;
  line: boolean;
}
/**
 * Pull a croc transfer code out of clipboard text. Matches our `NNNN-word-word-word`
 * format (also croc's default), including when it's embedded in the "Code: …" share
 * text. Deliberately strict so arbitrary clipboard text never auto-fills the box.
 */
function extractCode(text: string): string | null {
  if (!text) return null;
  const labeled = text.match(/code[:\s]+(\S+)/i);
  const candidate = (labeled ? labeled[1] : text.trim()).replace(/[.,]+$/, '');
  return /^\d+-[a-z]+-[a-z]+-[a-z]+$/i.test(candidate) ? candidate : null;
}

function receiveSteps(status: string): Step[] {
  const s = (kind: Step['kind'], title: string, sub: string, line: boolean): Step => ({ kind, title, sub, line });
  if (status === 'connecting')
    return [
      s('done', 'Code entered', 'PAKE secret ready', true),
      s('active', 'Connecting to sender', 'securing channel', true),
      s('pending', 'Download', 'starts when paired', false),
    ];
  return [
    s('done', 'Code entered', 'PAKE secret ready', true),
    s('done', 'Peer connected', 'secure channel open', true),
    s(status === 'done' ? 'done' : 'brand', status === 'done' ? 'Download complete' : 'Downloading', status === 'done' ? 'all bytes received' : 'streaming encrypted bytes', false),
  ];
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

export function ReceiveScreen({ recv }: { recv: UseReceive }) {
  const { status, code, progress, fileInfo, perFile, totalFiles, currentFile, out, isText, text, prompt } = recv;

  const [copied, setCopied] = useState(false);
  const copyText = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  // Overall progress = average per-file percent across the total file count
  // (each file is one bar going 0→100, so this reaches 100% exactly once).
  const overall =
    status === 'done'
      ? 100
      : perFile.length
        ? Math.min(100, Math.round(perFile.reduce((a, f) => a + f.percent, 0) / Math.max(1, totalFiles)))
        : (progress?.percent ?? 0);
  const seen = Math.min(perFile.length, totalFiles);
  const [dir, setDir] = useState('');

  // Whole-download ETA, estimated from overall progress + elapsed time (croc's
  // own ETA is per-file and resets each file). Anchored at first byte, cleared
  // between transfers.
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (status === 'idle' || status === 'connecting') startRef.current = null;
    else if (status === 'receiving' && startRef.current === null) startRef.current = Date.now();
  }, [status]);
  const overallEta =
    status === 'receiving' && startRef.current !== null && overall > 0 && overall < 100
      ? formatDuration(((Date.now() - startRef.current) / 1000) * ((100 - overall) / overall))
      : '';

  useEffect(() => {
    const saved = getPrefs().downloadDir;
    if (saved) setDir(saved);
    else croc.defaultDir().then(([, d]) => d && setDir(d));
  }, []);

  // Auto-fill the code box from the clipboard when opening Receive (or refocusing
  // the app), if it holds a croc code and the box is empty — never overwrites typing.
  const statusRef = useRef(status);
  statusRef.current = status;
  const codeRef = useRef(code);
  codeRef.current = code;
  useEffect(() => {
    const tryFill = async () => {
      if (statusRef.current !== 'idle' || codeRef.current.trim()) return;
      // Native read (no WKWebView paste-consent prompt, no user-gesture needed).
      const [, text] = await croc.clipboardText();
      const detected = extractCode(text ?? '');
      if (detected && !codeRef.current.trim()) recv.setCode(detected);
    };
    void tryFill();
    window.addEventListener('focus', tryFill);
    return () => window.removeEventListener('focus', tryFill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savedDir = out || dir;

  const fileRows = perFile.map((f) => ({
    name: f.name,
    size: f.size,
    pct: f.percent,
    showBar: status === 'receiving' && f.percent < 100,
    showCheck: f.percent >= 100,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-8 pt-[26px]">
        <div className="font-heading text-[26px] font-semibold tracking-[.01em]">
          {isText ? (status === 'done' ? 'Received text' : 'Receiving text') : status === 'done' ? 'Received' : 'Receive files'}
        </div>
        <div className="mt-[3px] text-[13px] text-muted-foreground">
          {isText
            ? status === 'done'
              ? 'A text message from your peer.'
              : 'Receiving a text message from your peer.'
            : status === 'done'
              ? `Saved to ${abbrevHome(savedDir)}`
              : status === 'receiving'
                ? 'Downloading securely from your peer.'
                : 'Get files someone is sending you.'}
        </div>
      </div>

      {/* Interactive prompt: croc is blocked waiting for the user to accept /
          overwrite. Shown above the flow whenever one is pending. */}
      {prompt && (
        <div className="mx-8 mt-4 rounded-[14px] border border-brand/40 bg-brand-surface p-4">
          <div className="text-sm font-semibold text-brand-deep">
            {prompt.kind === 'accept'
              ? 'Incoming files'
              : prompt.kind === 'overwrite'
                ? 'File already exists'
                : prompt.kind === 'resume'
                  ? 'Resume download?'
                  : 'Confirm'}
          </div>
          <div className="mt-1 text-[13px] text-foreground">
            {prompt.kind === 'accept' ? (
              <>
                A peer wants to send you <b>{prompt.fname}</b>
                {prompt.size ? <> · {prompt.size}</> : null}. Accept the transfer?
              </>
            ) : prompt.kind === 'overwrite' ? (
              <>
                <b>{prompt.file}</b> already exists in your download folder. Replace it?
              </>
            ) : prompt.kind === 'resume' ? (
              <>
                Resume the partial download of <b>{prompt.file}</b>
                {prompt.percent != null ? <> ({Math.round(prompt.percent)}%)</> : null}?
              </>
            ) : (
              prompt.message
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => recv.respond(false)}>
              {prompt.kind === 'accept' ? 'Decline' : prompt.kind === 'overwrite' ? 'Keep existing' : 'No'}
            </Button>
            <Button size="sm" onClick={() => recv.respond(true)}>
              {prompt.kind === 'accept'
                ? 'Accept'
                : prompt.kind === 'overwrite'
                  ? 'Replace'
                  : prompt.kind === 'resume'
                    ? 'Resume'
                    : 'Yes'}
            </Button>
          </div>
        </div>
      )}

      {/* IDLE: enter code */}
      {status === 'idle' && (
        <div className="flex flex-1 items-center justify-center px-8 pb-8 pt-6">
          <div className="flex w-full max-w-[440px] flex-col items-center gap-2 text-center">
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-[18px] bg-brand-surface text-brand-deep">
              <Download size={30} />
            </div>
            <div className="font-heading text-[22px] font-semibold">Enter the transfer code</div>
            <div className="max-w-[340px] text-[13px] text-muted-foreground">
              Type the code the sender shared with you — or scan their QR with this device's camera.
            </div>
            <div className="mt-[18px] w-full text-left">
              <Input
                value={code}
                onChange={(e) => recv.setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && recv.begin()}
                placeholder="e.g. 7431-mirage-oxford"
                className="h-12 text-base"
                autoFocus
              />
            </div>
            <div className="mt-3 w-full">
              <Button className="h-11 w-full" disabled={!code.trim()} onClick={recv.begin}>
                Receive files
              </Button>
            </div>
            <div className="mt-3.5 flex items-center gap-2.5 text-xs text-muted-foreground">
              <span className="h-px w-11 bg-border" />
              or
              <span className="h-px w-11 bg-border" />
            </div>
            <div className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
              <QrCode size={15} /> Scan a QR code (coming soon)
            </div>
            <div className="mt-4 flex max-w-[380px] items-center gap-1.5 text-xs text-muted-foreground">
              <Folder size={13} className="shrink-0" /> Saving to{' '}
              <span className="font-medium text-foreground">{abbrevHome(savedDir)}</span>
            </div>
          </div>
        </div>
      )}

      {/* TEXT MESSAGE: `croc send --text` — show the body with a copy button */}
      {isText && status !== 'idle' && status !== 'error' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 pb-7 pt-5">
          {text == null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-[18px] rounded-2xl border border-border">
              <div className="h-11 w-11 animate-[crocspin_.8s_linear_infinite] rounded-full border-[3px] border-border border-t-brand" />
              <div className="text-sm text-muted-foreground">Receiving text message…</div>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-card px-5 py-[18px]">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <MessageSquareText size={15} /> TEXT MESSAGE
                </div>
                <pre className="m-0 select-text whitespace-pre-wrap break-words font-mono text-sm leading-[1.65] text-foreground">
                  {text}
                </pre>
              </div>
              <div className="flex gap-2.5">
                <Button className="flex-1" onClick={copyText}>
                  {copied ? <Check /> : <Copy />} {copied ? 'Copied!' : 'Copy text'}
                </Button>
                <Button variant="outline" className="flex-1" onClick={recv.reset}>
                  Receive another
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ACTIVE: connecting / receiving / done — two-column, gradient hero */}
      {!isText && (status === 'connecting' || status === 'receiving' || status === 'done') && (
        <div className="flex min-h-0 flex-1 gap-5 px-8 pb-7 pt-5">
          {/* LEFT — transparent so it blends into the layout brand wash */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-transparent">
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[22px] px-[26px] py-[30px]">
              {status === 'connecting' ? (
                <>
                  <div className="h-11 w-11 animate-[crocspin_.8s_linear_infinite] rounded-full border-[3px] border-border border-t-brand" />
                  <div className="text-sm text-muted-foreground">Connecting to sender…</div>
                  <div className="font-heading text-[22px] tracking-[.03em] text-brand-deep">{code}</div>
                </>
              ) : (
                <>
                  <div className="text-center">
                    <div className="font-heading text-[68px] font-semibold leading-none text-brand-deep">{overall}%</div>
                    <div className="mt-2 text-[13px] text-muted-foreground">
                      {status === 'done'
                        ? 'Download complete'
                        : progress?.speedHuman
                          ? `${progress.speedHuman}${overallEta ? ` · ETA ${overallEta}` : ''}`
                          : 'Downloading…'}
                    </div>
                  </div>
                  <div className="h-3 w-full max-w-[420px] overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-deep))] transition-[width] duration-200"
                      style={{ width: `${overall}%` }}
                    />
                  </div>
                  {status === 'done' ? (
                    <div className="flex w-full min-w-0 items-center justify-center gap-2 text-[13px] font-medium text-success-text">
                      <Check size={16} strokeWidth={3} className="shrink-0" />
                      {totalFiles > 1 ? (
                        <span className="shrink-0">All {totalFiles} files received</span>
                      ) : (
                        <>
                          <MiddleTruncate text={fileInfo?.name ?? 'File'} className="flex-[0_1_auto] font-medium" />
                          <span className="shrink-0">received</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex w-full min-w-0 items-center justify-center gap-2 text-[13px]">
                      <span className="relative flex h-[9px] w-[9px] shrink-0">
                        <span className="absolute h-full w-full animate-[crocping_1.4s_ease-out_infinite] rounded-full bg-brand opacity-50" />
                        <span className="relative h-[9px] w-[9px] rounded-full bg-brand" />
                      </span>
                      <span className="shrink-0">Downloading</span>
                      <MiddleTruncate text={currentFile || fileInfo?.name || ''} className="flex-[0_1_auto] font-medium" />
                      {totalFiles > 1 ? (
                        <span className="shrink-0 text-muted-foreground">· {seen} of {totalFiles} files</span>
                      ) : (
                        progress?.transferredHuman && progress?.totalHuman && (
                          <span className="shrink-0 text-muted-foreground">· {progress.transferredHuman} / {progress.totalHuman}</span>
                        )
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT: timeline + files + cancel */}
          <div className="flex min-h-0 w-[332px] shrink-0 flex-col gap-3.5">
            <div className="rounded-[14px] border border-border bg-card p-[18px]">
              <div className="mb-4 text-[13px] font-semibold">Connection</div>
              {receiveSteps(status).map((st, i) => (
                <TimelineStep key={i} step={st} />
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto rounded-[14px] border border-border bg-card px-4 py-[15px]">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">Files</span>
                {totalFiles > 1 && (
                  <span className="text-xs text-muted-foreground">
                    {seen}/{totalFiles}
                  </span>
                )}
              </div>
              {fileRows.length === 0 && (
                <div className="text-xs text-muted-foreground">Waiting for the file list…</div>
              )}
              {fileRows.map((f) => (
                <div key={f.name} className="flex flex-col gap-[7px]">
                  <div className="flex items-center gap-[9px] text-[13px]">
                    <TypeBadge type={extType(f.name)} />
                    <MiddleTruncate text={f.name} className="flex-1" />
                    <span
                      className={`ml-auto flex shrink-0 items-center gap-[5px] pl-1.5 text-xs ${
                        f.showBar ? 'text-brand-deep' : 'text-muted-foreground'
                      }`}
                    >
                      {f.showCheck && <Check size={13} className="text-success-text" />}
                      {f.showBar ? `${f.pct}%` : f.size}
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
            {status === 'done' ? (
              <div className="flex gap-2.5">
                <Button className="flex-1" onClick={() => savedDir && croc.showItem(savedDir)}>
                  <Folder /> Show in folder
                </Button>
                <Button variant="outline" className="flex-1" onClick={recv.reset}>
                  Receive another
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="w-full" onClick={recv.cancel}>
                <X /> Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ERROR */}
      {status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-8 text-center">
          <div className="max-w-[420px] rounded-[14px] border border-error-text bg-error-surface p-4 text-error-text">
            <div className="mb-1 font-semibold">Couldn't receive</div>
            {recv.error && <div className="text-[13px]">{recv.error}</div>}
          </div>
          <Button onClick={recv.reset}>Try again</Button>
        </div>
      )}
    </div>
  );
}
