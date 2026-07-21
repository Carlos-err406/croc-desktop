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

const HEADING = 'var(--font-heading)';

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
    <span style={{ fontFamily: HEADING, fontSize: 10, fontWeight: 600, color: '#fff', borderRadius: 5, padding: '2px 6px', background: typeColor(type), flexShrink: 0 }}>
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
      ? { bg: 'var(--success-surface)', fg: 'var(--success-text)', border: 'none' }
      : step.kind === 'active'
        ? { bg: 'transparent', fg: 'var(--warning-text)', border: '2px solid var(--warning-text)' }
        : step.kind === 'brand'
          ? { bg: 'transparent', fg: 'var(--brand)', border: '2px solid var(--brand)' }
          : { bg: 'var(--secondary)', fg: 'var(--muted-foreground)', border: 'none' };
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
        <div style={{ fontSize: 13, fontWeight: 500, color: step.kind === 'pending' ? 'var(--muted-foreground)' : 'var(--foreground)' }}>{step.title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{step.sub}</div>
      </div>
    </div>
  );
}

export function ReceiveScreen({ recv }: { recv: UseReceive }) {
  const { status, code, progress, fileInfo, perFile, totalFiles, currentFile, out, isText, text } = recv;
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

  const savedDir = out || dir;

  const fileRows = perFile.map((f) => ({
    name: f.name,
    size: f.size,
    pct: f.percent,
    showBar: status === 'receiving' && f.percent < 100,
    showCheck: f.percent >= 100,
  }));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '26px 32px 0' }}>
        <div style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 600, letterSpacing: '.01em' }}>
          {isText ? (status === 'done' ? 'Received text' : 'Receiving text') : status === 'done' ? 'Received' : 'Receive files'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 3 }}>
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

      {/* IDLE: enter code */}
      {status === 'idle' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 32px 32px' }}>
          <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--brand-surface)', color: 'var(--brand-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
              <Download size={30} />
            </div>
            <div style={{ fontFamily: HEADING, fontSize: 22, fontWeight: 600 }}>Enter the transfer code</div>
            <div style={{ fontSize: 13, color: 'var(--muted-foreground)', maxWidth: 340 }}>
              Type the code the sender shared with you — or scan their QR with this device's camera.
            </div>
            <div style={{ width: '100%', marginTop: 18, textAlign: 'left' }}>
              <Input
                value={code}
                onChange={(e) => recv.setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && recv.begin()}
                placeholder="e.g. 7431-mirage-oxford"
                className="h-12 text-base"
                autoFocus
              />
            </div>
            <div style={{ width: '100%', marginTop: 12 }}>
              <Button className="h-11 w-full" disabled={!code.trim()} onClick={recv.begin}>
                Receive files
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, color: 'var(--muted-foreground)', fontSize: 12 }}>
              <span style={{ width: 44, height: 1, background: 'var(--border)' }} />
              or
              <span style={{ width: 44, height: 1, background: 'var(--border)' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted-foreground)', marginTop: 4 }}>
              <QrCode size={15} /> Scan a QR code (coming soon)
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 16, display: 'flex', alignItems: 'center', gap: 6, maxWidth: 380 }}>
              <Folder size={13} style={{ flexShrink: 0 }} /> Saving to{' '}
              <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{abbrevHome(savedDir)}</span>
            </div>
          </div>
        </div>
      )}

      {/* TEXT MESSAGE: `croc send --text` — show the body with a copy button */}
      {isText && status !== 'idle' && status !== 'error' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 32px 28px', minHeight: 0 }}>
          {text == null ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, border: '1px solid var(--border)', borderRadius: 16 }} className="croc-hero-gradient">
              <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand)', animation: 'crocspin .8s linear infinite' }} />
              <div style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>Receiving text message…</div>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 16, background: 'var(--card)', padding: '18px 20px', overflowY: 'auto', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 12 }}>
                  <MessageSquareText size={15} /> TEXT MESSAGE
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    userSelect: 'text',
                    color: 'var(--foreground)',
                  }}
                >
                  {text}
                </pre>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
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
        <div style={{ flex: 1, display: 'flex', gap: 20, padding: '20px 32px 28px', minHeight: 0 }}>
          {/* LEFT: green gradient hero */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--card)', minWidth: 0 }}>
            <div className="croc-hero-gradient" style={{ flex: 1, padding: '30px 26px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 22, minWidth: 0 }}>
              {status === 'connecting' ? (
                <>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand)', animation: 'crocspin .8s linear infinite' }} />
                  <div style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>Connecting to sender…</div>
                  <div style={{ fontFamily: HEADING, fontSize: 22, color: 'var(--brand-deep)', letterSpacing: '.03em' }}>{code}</div>
                </>
              ) : (
                <>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: HEADING, fontSize: 68, fontWeight: 600, lineHeight: 1, color: 'var(--brand-deep)' }}>{overall}%</div>
                    <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 8 }}>
                      {status === 'done'
                        ? 'Download complete'
                        : progress?.speedHuman
                          ? `${progress.speedHuman}${overallEta ? ` · ETA ${overallEta}` : ''}`
                          : 'Downloading…'}
                    </div>
                  </div>
                  <div style={{ width: '100%', maxWidth: 420, height: 12, borderRadius: 999, background: 'var(--secondary)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,var(--brand),var(--brand-deep))', width: `${overall}%`, transition: 'width .2s ease' }} />
                  </div>
                  {status === 'done' ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, width: '100%', minWidth: 0, color: 'var(--success-text)', fontWeight: 500 }}>
                      <Check size={16} strokeWidth={3} style={{ flexShrink: 0 }} />
                      <span style={{ flexShrink: 0 }}>
                        {totalFiles > 1 ? `All ${totalFiles} files received` : `${fileInfo?.name ?? 'File'} received`}
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, width: '100%', minWidth: 0 }}>
                      <span style={{ position: 'relative', display: 'flex', width: 9, height: 9, flexShrink: 0 }}>
                        <span style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', background: 'var(--brand)', opacity: 0.5, animation: 'crocping 1.4s ease-out infinite' }} />
                        <span style={{ position: 'relative', width: 9, height: 9, borderRadius: '50%', background: 'var(--brand)' }} />
                      </span>
                      <span style={{ flexShrink: 0 }}>Downloading</span>
                      <MiddleTruncate text={currentFile || fileInfo?.name || ''} style={{ flex: '0 1 auto', fontWeight: 500 }} />
                      {totalFiles > 1 ? (
                        <span style={{ flexShrink: 0, color: 'var(--muted-foreground)' }}>· {seen} of {totalFiles} files</span>
                      ) : (
                        progress?.transferredHuman && progress?.totalHuman && (
                          <span style={{ flexShrink: 0, color: 'var(--muted-foreground)' }}>· {progress.transferredHuman} / {progress.totalHuman}</span>
                        )
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT: timeline + files + cancel */}
          <div style={{ width: 332, display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 0, minHeight: 0 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 18, background: 'var(--card)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Connection</div>
              {receiveSteps(status).map((st, i) => (
                <TimelineStep key={i} step={st} />
              ))}
            </div>
            <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 14, padding: '15px 16px', background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Files</span>
                {totalFiles > 1 && (
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                    {seen}/{totalFiles}
                  </span>
                )}
              </div>
              {fileRows.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Waiting for the file list…</div>
              )}
              {fileRows.map((f) => (
                <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                    <TypeBadge type={extType(f.name)} />
                    <MiddleTruncate text={f.name} style={{ flex: 1 }} />
                    <span style={{ marginLeft: 'auto', paddingLeft: 6, fontSize: 12, color: f.showBar ? 'var(--brand-deep)' : 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      {f.showCheck && <Check size={13} style={{ color: 'var(--success-text)' }} />}
                      {f.showBar ? `${f.pct}%` : f.size}
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
            {status === 'done' ? (
              <div style={{ display: 'flex', gap: 10 }}>
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, textAlign: 'center' }}>
          <div style={{ maxWidth: 420, border: '1px solid var(--error-text)', background: 'var(--error-surface)', borderRadius: 14, padding: 16, color: 'var(--error-text)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't receive</div>
            {recv.error && <div style={{ fontSize: 13 }}>{recv.error}</div>}
          </div>
          <Button onClick={recv.reset}>Try again</Button>
        </div>
      )}
    </div>
  );
}
