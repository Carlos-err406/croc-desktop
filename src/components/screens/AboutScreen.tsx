import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpCircle, Check, ExternalLink, Github, Lock, RotateCw, Smartphone } from 'lucide-react';
import { croc, type CrocInfo } from '@/lib/services/ipc';
import { useUpdater } from '@/lib/updater';
import { formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CrocBadge } from '@/components/CrocLogo';
import { APP_NAME, IS_MOBILE } from '@/lib/platform';

const REPO_URL = 'https://github.com/Carlos-err406/croc-desktop';
const CROC_URL = 'https://github.com/schollz/croc';
// The companion Android app (upstream project) — scan a QR from here to pair.
const ANDROID_URL = 'https://github.com/Dking08/croc-app';

export function AboutScreen() {
  const [info, setInfo] = useState<CrocInfo | null>(null);
  useEffect(() => {
    croc.info().then(([, i]) => i && setInfo(i));
  }, []);
  const crocVersion = info?.version?.replace(/^croc\s+version\s+/i, '').trim();
  const updater = useUpdater();

  return (
    // Whole screen scrolls (header included) so it blends into the gradient wash.
    // `min-h-full` + `my-auto` centers the content when it fits and scrolls it
    // (without clipping the top, which justify-center would) when it doesn't.
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col px-4 md:px-8 pb-10">
        <div className="pt-[26px]">
          <div className="font-heading text-[26px] font-semibold tracking-[.01em]">About</div>
          <div className="mt-[3px] text-[13px] text-muted-foreground">
            {APP_NAME} and the tools it's built on.
          </div>
        </div>

        <div className="my-auto flex flex-col items-center gap-6 pt-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <CrocBadge size={72} className="shadow-[0_12px_30px_-10px_rgba(30,80,40,.35)]" />
          <div>
            <div className="font-heading text-[22px] font-semibold">{APP_NAME}</div>
            <div className="mt-1 text-[13px] text-muted-foreground">
              Version {__APP_VERSION__}
              {crocVersion ? `  ·  croc ${crocVersion}` : ''}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Built {new Date(__BUILD_TIME__).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </div>
          </div>
          <p className="max-w-[380px] text-[13px] leading-relaxed text-muted-foreground">
            A friendly {IS_MOBILE ? 'app' : 'desktop app'} for{' '}
            <span className="font-medium text-foreground">croc</span> — send files and text to any device
            with a one-time code, encrypted end-to-end, peer-to-peer.
          </p>
        </div>

        {/* croc engine compatibility warning: the app resolved a croc that is NOT
            the bundled one and whose version differs — transfers with peers on the
            bundled version can fail. This is the key Linux "can't send" diagnostic. */}
        {info && !info.compatible && (
          <div className="flex w-full max-w-[360px] items-start gap-2.5 rounded-[12px] border border-warning-text/50 bg-warning-surface px-4 py-3 text-[12px] text-warning-text">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Using a non-bundled croc</div>
              <div className="mt-0.5 leading-relaxed">
                This app is running{' '}
                <span className="font-medium">{crocVersion || 'a system croc'}</span> from{' '}
                <span className="break-all font-mono">{info.path ?? 'PATH'}</span>, not the bundled{' '}
                {info.expectedVersion}. Transfers may fail with peers on the bundled version. Remove or
                update the system croc so versions match.
              </div>
            </div>
          </div>
        )}

        {/* Update status */}
        {updater.status === 'available' || updater.status === 'downloading' || updater.status === 'ready' ? (
          <div className="flex w-full max-w-[300px] items-center gap-2.5 rounded-[12px] border border-brand/40 bg-brand-surface px-4 py-2.5 text-[13px] text-brand-deep">
            <ArrowUpCircle size={16} className="shrink-0" />
            {updater.status === 'downloading' ? (
              <span className="flex-1">
                Downloading update… {Math.round(updater.progress * 100)}%
                {updater.totalBytes ? ` · ${formatBytes(updater.totalBytes)}` : ''}
              </span>
            ) : updater.status === 'ready' ? (
              <>
                <span className="flex-1">Update{updater.version ? ` v${updater.version}` : ''} ready</span>
                <Button size="sm" onClick={() => void updater.restart()}>
                  <RotateCw size={14} /> Restart
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1">
                  Version {updater.version} available
                  {updater.totalBytes ? ` · ${formatBytes(updater.totalBytes)}` : ''}
                </span>
                <Button size="sm" onClick={() => void updater.install()}>Update now</Button>
              </>
            )}
          </div>
        ) : updater.status === 'uptodate' ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check size={13} className="text-success-text" /> You're on the latest version
          </div>
        ) : null}

        {/* Recommended companion: the Android app, for phone ↔ desktop transfers.
            Pointless on Android — that's this app — so desktop only. Also w-[340px]
            was wider than a 360px phone once padding is counted. */}
        {!IS_MOBILE && (
        <div className="flex w-full max-w-[340px] items-center gap-3 rounded-[12px] border border-border bg-secondary/50 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-surface text-brand-deep">
            <Smartphone size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">Croc for Android</div>
            <div className="text-xs text-muted-foreground">
              Recommended companion — send & receive on your phone, scan to pair.
            </div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => croc.openUrl(ANDROID_URL)}>
            <ExternalLink size={14} /> Get
          </Button>
        </div>
        )}

        <div className="flex flex-col gap-2.5">
          <Button onClick={() => croc.openUrl(REPO_URL)}>
            <Github size={16} /> View on GitHub
          </Button>
          <Button variant="outline" onClick={() => croc.openUrl(CROC_URL)}>
            <ExternalLink size={15} /> Built on schollz/croc
          </Button>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} className="text-success-text" /> End-to-end encrypted · nothing stored in the cloud
        </div>
        </div>
      </div>
    </div>
  );
}
