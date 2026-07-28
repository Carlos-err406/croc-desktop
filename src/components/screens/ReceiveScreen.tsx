import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bookmark, Check, Copy, Download, Folder, Link2, Loader2, MessageSquareText, QrCode, Radio, Send, WifiOff, X } from 'lucide-react';
import { useSavedCodes } from '@/lib/codes';
import { CodePills } from '@/components/CodePills';
import { MAX_AUTO_RECONNECT, type ReceiveOverrides, type UseReceive } from '@/lib/useReceive';
import { ConnectionHint } from '@/components/ConnectionHint';
import { LocalToggle } from '@/components/LocalToggle';
import { parseReceiveTarget, versionMismatch } from '@/lib/deeplink';
import { croc, type CrocInvite } from '@/lib/services/ipc';
import { getPrefs } from '@/lib/prefs';
import { abbrevHome } from '@/lib/paths';
import { typeColor } from '@/lib/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MiddleTruncate } from '@/components/ui/middle-truncate';
import { QrScanner } from '@/components/QrScanner';
import { APP_NAME, CAN_USE_FILE_PATHS, CAN_USE_NEARBY } from '@/lib/platform';

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
  const { status, code, progress, fileInfo, perFile, totalFiles, currentFile, out, savedTo, saveError, isText, text, prompt, reconnecting, reconnectAttempt } = recv;

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
  const [scanning, setScanning] = useState(false);
  // Connection settings carried by a scanned QR / link, applied to this receive
  // only. Cleared when the user edits the code by hand (a plain code has none).
  const [linkOverrides, setLinkOverrides] = useState<ReceiveOverrides | null>(null);
  // The croc version the sender embedded in the link (`&v=`), plus our own bundled
  // version — compared to warn about a protocol mismatch before we even try.
  const [senderCroc, setSenderCroc] = useState<string | null>(null);
  // Reverse pairing: an invite the OTHER side scans to send files TO us. Built from
  // the code currently in the box (or a fresh one), so hitting "Receive files"
  // afterwards waits on exactly the code we published.
  const [invite, setInvite] = useState<CrocInvite | null>(null);
  // Discoverable: advertise this device + a one-time code over mDNS so a nearby
  // sender can pick us with no code exchange. Being discoverable IS the consent
  // step — while it's on, anyone on this network can see the code and send to it.
  const [discoverable, setDiscoverable] = useState(false);
  const toggleDiscoverable = async () => {
    if (discoverable) {
      await croc.nearbyDiscoverable(null);
      setDiscoverable(false);
      return;
    }
    // Reuse the invite machinery to mint (or keep) the code we'll wait on.
    const [, inv] = await croc.invite(code.trim() || undefined);
    if (!inv) return;
    const [, on] = await croc.nearbyDiscoverable(inv.code);
    if (on) {
      recv.setCode(inv.code); // "Receive files" then waits on the advertised code
      setSenderCroc(null);
      setDiscoverable(true);
    }
  };
  // Stop advertising when we leave the idle screen or unmount — the code is spent
  // once a transfer starts, and a stale advert would invite a doomed second sender.
  useEffect(() => {
    if (status !== 'idle' && discoverable) {
      void croc.nearbyDiscoverable(null);
      setDiscoverable(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => () => void croc.nearbyDiscoverable(null), []);

  const showInvite = async () => {
    const [, inv] = await croc.invite(code.trim() || undefined);
    if (inv) {
      setInvite(inv);
      recv.setCode(inv.code); // so "Receive files" waits on the published code
      setSenderCroc(null);
    }
  };
  const [ourCroc, setOurCroc] = useState<string | null>(null);
  useEffect(() => {
    croc.info().then(([, i]) => i && setOurCroc(i.expectedVersion));
  }, []);
  const mismatch = versionMismatch(senderCroc, ourCroc);
  const { codes: savedCodes, save: saveCode, remove: removeCode, has: hasCode } = useSavedCodes();

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

  // On Android the files are published to Downloads once the transfer finishes;
  // until then the private receive path is where they really are.
  const savedDir = savedTo || out || dir;

  const fileRows = perFile.map((f) => ({
    name: f.name,
    size: f.size,
    pct: f.percent,
    showBar: status === 'receiving' && f.percent < 100,
    showCheck: f.percent >= 100,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 px-4 md:px-8 pt-[26px]">
        <div>
          <div className="font-heading text-[26px] font-semibold tracking-[.01em]">
            {reconnecting
              ? 'Reconnecting…'
              : isText ? (status === 'done' ? 'Received text' : 'Receiving text') : status === 'done' ? 'Received' : 'Receive files'}
          </div>
          <div className="mt-[3px] text-[13px] text-muted-foreground">
            {reconnecting
              ? 'The transfer dropped — retrying automatically.'
              : isText
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
        {/* Local-only shortcut — actionable before a receive starts. */}
        {status === 'idle' && <LocalToggle />}
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
        // Scrolls when it has to (e.g. the "send to me" invite panel open), and
        // stays vertically centered when it fits — my-auto, not justify-center,
        // so an overflowing panel isn't clipped at the top.
        <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-8 pb-8 pt-6">
          <div className="my-auto flex w-full max-w-[440px] flex-col items-center gap-2 text-center mx-auto">
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-[18px] bg-brand-surface text-brand-deep">
              <Download size={30} />
            </div>
            <div className="font-heading text-[22px] font-semibold">Enter the transfer code</div>
            <div className="max-w-[340px] text-[13px] text-muted-foreground">
              Type the code the sender shared with you — or scan their QR with this device's camera.
            </div>
            {savedCodes.length > 0 && (
              <div className="mt-[18px] w-full text-left">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[.05em] text-muted-foreground">
                  Saved codes
                </div>
                <CodePills
                  codes={savedCodes}
                  onPick={(c) => {
                    recv.setCode(c);
                    setLinkOverrides(null);
                    setSenderCroc(null);
                  }}
                  onRemove={removeCode}
                />
              </div>
            )}
            <div className="mt-3 flex w-full items-center gap-2 text-left">
              <Input
                value={code}
                onChange={(e) => {
                  recv.setCode(e.target.value);
                  setLinkOverrides(null); // manual edit → a plain code, drop any link settings
                  setSenderCroc(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && recv.begin(undefined, linkOverrides ?? undefined)}
                placeholder="e.g. 7431-mirage-oxford"
                /* autoFocus is desktop-only: on a phone it throws the keyboard up the
                   moment the tab opens, before the user has chosen to type. */
                className="h-12 flex-1 text-base"
                autoFocus={CAN_USE_FILE_PATHS}
              />
              <button
                disabled={code.trim().length < 6}
                onClick={() => (hasCode(code) ? removeCode(code) : saveCode(code))}
                title={hasCode(code) ? 'Remove bookmark' : 'Bookmark this code'}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border border-border text-muted-foreground transition-colors hover:text-brand-deep disabled:opacity-30"
              >
                <Bookmark size={17} className={hasCode(code) ? 'fill-brand text-brand' : ''} />
              </button>
            </div>
            {linkOverrides?.local && (
              <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-brand-deep">
                <WifiOff size={13} /> This link uses local-only mode
              </div>
            )}
            {/* croc version mismatch: croc doesn't interoperate across minor lines,
                so warn before attempting rather than failing on the handshake. */}
            {mismatch && (
              <div className="mt-2.5 w-full max-w-[420px] rounded-[12px] border border-warning-text/40 bg-warning-surface px-4 py-3 text-left text-[12px] text-warning-text">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle size={14} className="shrink-0" />
                  {mismatch.senderIsNewer ? 'Sender is on a newer croc' : 'Sender is on an older croc'}
                </div>
                <p className="mt-1 leading-relaxed">
                  They're sending with croc <b>{mismatch.sender}</b>, you have <b>{mismatch.ours}</b>. The
                  transfer might fail if both ends don't have the same bundled croc version —{' '}
                  {mismatch.senderIsNewer
                    ? CAN_USE_FILE_PATHS
                      ? 'update Croc Desktop (Settings → Updates), then try again.'
                      : `update ${APP_NAME} to the latest release, then try again.`
                    : 'ask them to update their Croc app, then try again.'}
                </p>
              </div>
            )}
            <div className="mt-3 w-full">
              <Button
                className="h-11 w-full"
                disabled={!code.trim()}
                onClick={() => recv.begin(undefined, linkOverrides ?? undefined)}
              >
                Receive files
              </Button>
            </div>
            <div className="mt-3.5 flex items-center gap-2.5 text-xs text-muted-foreground">
              <span className="h-px w-11 bg-border" />
              or
              <span className="h-px w-11 bg-border" />
            </div>
            <button
              onClick={() => setScanning(true)}
              className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-brand-deep transition-colors hover:bg-brand-surface"
            >
              <QrCode size={15} /> Scan a QR code
            </button>

            {/* Reverse pairing — publish a code for THEM to send to. Needs mDNS, so
                it's desktop-only until Android holds a multicast lock. */}
            {CAN_USE_NEARBY && (
            <button
              onClick={() => void toggleDiscoverable()}
              className={`mt-2.5 flex cursor-pointer items-center gap-1.5 text-[13px] font-medium ${
                discoverable ? 'text-brand-deep' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Let nearby devices on this network send to you without sharing a code"
            >
              <Radio size={14} className={discoverable ? 'text-brand' : ''} />
              {discoverable ? 'Discoverable to nearby devices — tap to stop' : 'Or let a nearby device find you'}
            </button>
            )}
            {discoverable && (
              <p className="mt-1.5 max-w-[400px] text-xs leading-relaxed text-muted-foreground">
                Visible on this network as a device ready to receive. Hit{' '}
                <span className="font-medium text-foreground">Receive files</span> to start waiting.
                Anyone here can see the code while this is on.
              </p>
            )}

            {!invite ? (
              <button
                onClick={showInvite}
                className="mt-2.5 flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Send size={14} /> Or have them send to you
              </button>
            ) : (
              <div className="mt-3.5 w-full max-w-[400px] rounded-[14px] border border-border bg-card px-4 py-4 text-center">
                <div className="text-[13px] font-medium">Have them scan this to send you files</div>
                {invite.qr && (
                  <div className="mx-auto mt-3 w-fit rounded-[10px] bg-white p-2">
                    <img src={invite.qr} alt="Send-to-me QR" width={132} height={132} className="block" draggable={false} />
                  </div>
                )}
                <div className="mt-3 font-heading text-[19px] font-semibold tracking-[.02em]">{invite.code}</div>
                <div className="mt-2.5 flex justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(invite.code)}>
                    <Copy size={13} /> Code
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(invite.link)}>
                    <Link2 size={13} /> Link
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setInvite(null)}>
                    Hide
                  </Button>
                </div>
                <p className="mt-2.5 text-xs text-muted-foreground">
                  Then hit <span className="font-medium text-foreground">Receive files</span> to start waiting.
                </p>
              </div>
            )}

            {/* An Android receive path is long enough to push the row off-screen and
                break "Saving to" across two lines, so the label is kept whole and the
                path is the part allowed to shrink. */}
            <div className="mt-4 flex w-full max-w-[380px] items-center gap-1.5 text-xs text-muted-foreground">
              <Folder size={13} className="shrink-0" />
              <span className="shrink-0">Saving to</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={savedDir}>
                {abbrevHome(savedDir)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TEXT MESSAGE: `croc send --text` — show the body with a copy button */}
      {isText && !reconnecting && status !== 'idle' && status !== 'error' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 md:px-8 pb-7 pt-5">
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

      {/* reconnecting — auto-retry after a dropped transfer (same code) */}
      {reconnecting && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 md:px-8 pb-8 pt-[22px] text-center">
          <Loader2 className="size-9 animate-spin text-brand" />
          <div>
            <div className="font-heading text-xl font-semibold">Reconnecting…</div>
            <div className="mt-1.5 max-w-[360px] text-sm text-muted-foreground">
              The transfer dropped. Retrying the same code (attempt {reconnectAttempt} of{' '}
              {MAX_AUTO_RECONNECT}) — keep the sender open and it'll resume on its own.
            </div>
          </div>
          <Button variant="outline" onClick={recv.reset}>
            Cancel
          </Button>
        </div>
      )}

      {/* ACTIVE: connecting / receiving / done — two-column, gradient hero */}
      {!isText && !reconnecting && (status === 'connecting' || status === 'receiving' || status === 'done') && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-4 md:flex-row md:gap-5 md:overflow-hidden md:px-8 md:pb-7 md:pt-5">
          {/* LEFT — transparent so it blends into the layout brand wash */}
          <div className="flex min-w-0 flex-none flex-col overflow-hidden rounded-2xl border border-border bg-transparent md:flex-1">
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
          <div className="flex min-h-0 w-full shrink-0 flex-col gap-3.5 md:w-[332px]">
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
            {/* The transfer succeeded but publishing to Downloads didn't, so the
                files are still in app-private storage — say so rather than showing
                a path the user can't reach and calling it done. */}
            {status === 'done' && saveError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Received, but couldn't save to Downloads: {saveError}
              </div>
            )}
            {status === 'done' ? (
              <div className="flex gap-2.5">
                {/* No file manager to reveal into on Android, and croc_show_item is a
                    stub there — so don't offer a button that does nothing. */}
                {CAN_USE_FILE_PATHS && (
                  <Button className="flex-1" onClick={() => savedDir && croc.showItem(savedDir)}>
                    <Folder /> Show in folder
                  </Button>
                )}
                <Button
                  variant={CAN_USE_FILE_PATHS ? 'outline' : 'default'}
                  className="flex-1"
                  onClick={recv.reset}
                >
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
      {status === 'error' && !reconnecting && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-8 text-center">
          <div className="max-w-[420px] rounded-[14px] border border-error-text bg-error-surface p-4 text-error-text">
            <div className="mb-1 font-semibold">Couldn't receive</div>
            {recv.error && <div className="text-[13px]">{recv.error}</div>}
          </div>
          <ConnectionHint error={recv.error} local={getPrefs().localMode} />
          <div className="flex gap-2.5">
            {recv.code.trim() ? (
              <>
                <Button onClick={recv.retry}>Try again</Button>
                <Button variant="outline" onClick={recv.reset}>
                  Change code
                </Button>
              </>
            ) : (
              <Button onClick={recv.reset}>Try again</Button>
            )}
          </div>
        </div>
      )}

      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onCode={(text) => {
            setScanning(false);
            const target = parseReceiveTarget(text);
            if (!target) return;
            recv.setCode(target.code);
            // Carry the link's connection settings into the pending receive.
            setLinkOverrides(
              target.local || target.relay ? { local: target.local, relay: target.relay } : null
            );
            setSenderCroc(target.crocVersion ?? null);
          }}
        />
      )}
    </div>
  );
}
