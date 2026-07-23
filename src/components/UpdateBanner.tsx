import { ArrowUpCircle, Download, RotateCw, X } from 'lucide-react';
import { useUpdater } from '@/lib/updater';
import { Button } from '@/components/ui/button';

/** Slim app-wide bar shown when an update is pending, downloading, or ready to apply. */
export function UpdateBanner() {
  const { status, version, progress, install, restart, dismiss } = useUpdater();

  if (status !== 'available' && status !== 'downloading' && status !== 'ready') return null;

  const pct = Math.round(progress * 100);

  return (
    <div className="flex items-center gap-3 border-b border-border bg-brand-surface px-5 py-2.5 text-[13px] text-brand-deep">
      {status === 'downloading' ? (
        <Download size={16} className="shrink-0 animate-pulse" />
      ) : (
        <ArrowUpCircle size={16} className="shrink-0" />
      )}

      {status === 'available' && (
        <>
          <span className="min-w-0 flex-1">
            A new version{version ? ` (v${version})` : ''} of Croc Desktop is available.
          </span>
          <Button size="sm" onClick={() => void install()}>Update now</Button>
          <button onClick={dismiss} className="shrink-0 text-brand-deep/60 hover:text-brand-deep" aria-label="Dismiss">
            <X size={16} />
          </button>
        </>
      )}

      {status === 'downloading' && (
        <>
          <span className="min-w-0 flex-1">Downloading update… {pct}%</span>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-brand/20">
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}

      {status === 'ready' && (
        <>
          <span className="min-w-0 flex-1">
            Update{version ? ` v${version}` : ''} installed. Restart to apply.
          </span>
          <Button size="sm" onClick={() => void restart()}>
            <RotateCw size={14} /> Restart
          </Button>
          <button onClick={dismiss} className="shrink-0 text-brand-deep/60 hover:text-brand-deep" aria-label="Later">
            <X size={16} />
          </button>
        </>
      )}
    </div>
  );
}
