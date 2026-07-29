import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { croc, type CrocInfo } from '@/lib/services/ipc';

/**
 * App-wide bar shown when the resolved croc is NOT the bundled one and its version
 * differs from what we bundle — transfers with peers on the bundled version can
 * silently fail (croc is protocol-incompatible across the 10.4 → 10.5 line). This
 * is the primary diagnostic for the Linux "can't send" case: it makes a
 * system-croc fallback visible instead of failing mysteriously.
 */
export function CrocCompatBanner() {
  const [info, setInfo] = useState<CrocInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    croc.info().then(([, i]) => i && setInfo(i));
  }, []);

  if (dismissed || !info || info.compatible) return null;

  const running = info.version || 'a system croc';
  return (
    <div className="flex items-center gap-3 border-b border-warning-text/40 bg-warning-surface px-5 py-2.5 text-[13px] text-warning-text">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        Running <span className="font-medium">{running}</span>
        {info.path ? (
          <>
            {' '}
            from <span className="font-mono">{info.path}</span>
          </>
        ) : null}
        , not the bundled {info.expectedVersion}. Transfers may fail with peers on the bundled
        version — remove or match the system croc.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-warning-text/60 hover:text-warning-text"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
