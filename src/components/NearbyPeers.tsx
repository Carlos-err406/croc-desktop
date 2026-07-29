import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Radio, Wifi } from 'lucide-react';
import { croc, type NearbyPeer } from '@/lib/services/ipc';
import { versionMismatch } from '@/lib/deeplink';

/**
 * Nearby devices that are currently accepting files. A peer advertises its own
 * one-time code over mDNS while it's "discoverable", so picking one needs no code
 * exchange at all — we just adopt the code it published.
 *
 * Needs multicast, same as local-only mode: works on a normal Wi-Fi/LAN, not over
 * most phone hotspots.
 */
export function NearbyPeers({
  ourCroc,
  selectedCode,
  onPick,
}: {
  ourCroc: string | null;
  /** The code currently staged to send with. A peer whose advertised code matches is
   *  shown as selected — derived rather than tracked, so editing the code by hand
   *  clears the selection on its own. */
  selectedCode?: string | null;
  onPick: (peer: NearbyPeer) => void;
}) {
  const [peers, setPeers] = useState<NearbyPeer[]>([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let alive = true;
    void croc.nearbyStart().then(() => alive && setStarted(true));
    // mDNS resolves progressively (and peers come and go), so poll while visible.
    const poll = async () => {
      const [, list] = await croc.nearbyPeers();
      if (alive && list) setPeers(list.filter((p) => !p.isSelf && p.code));
    };
    void poll();
    const t = window.setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="w-full rounded-[14px] border border-border bg-card px-3.5 py-3.5 text-left">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <Radio size={14} className={started ? 'text-brand' : 'text-muted-foreground'} />
        Nearby devices
        {peers.length > 0 && (
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {peers.length} accepting
          </span>
        )}
      </div>

      {peers.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Looking for devices on this network that are ready to receive. On the other device, open{' '}
          <span className="font-medium text-foreground">Receive</span> and turn on{' '}
          <span className="font-medium text-foreground">Discoverable</span>.
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {peers.map((p) => {
            const mm = versionMismatch(p.crocVersion, ourCroc);
            const selected = !!p.code && !!selectedCode && p.code === selectedCode.trim();
            return (
              <li key={p.id}>
                <button
                  onClick={() => onPick(p)}
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-brand bg-brand-surface'
                      : 'border-border hover:border-brand/50 hover:bg-brand-surface/40'
                  }`}
                >
                  {selected ? (
                    <Check size={14} className="shrink-0 text-brand-deep" strokeWidth={3} />
                  ) : (
                    <Wifi size={14} className="shrink-0 text-brand" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] font-medium ${selected ? 'text-brand-deep' : ''}`}
                    >
                      {p.name}
                    </span>
                    <span
                      className={`block truncate text-[11px] ${selected ? 'text-brand-deep/75' : 'text-muted-foreground'}`}
                    >
                      {p.address}
                      {p.crocVersion ? ` · croc ${p.crocVersion}` : ''}
                    </span>
                  </span>
                  {mm && (
                    <span
                      className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-warning-text"
                      title={`They're on croc ${mm.sender}, you have ${mm.ours} — the transfer might fail if both ends don't have the same bundled croc version.`}
                    >
                      <AlertTriangle size={12} /> {mm.sender}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
