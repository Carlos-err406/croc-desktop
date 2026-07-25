import { useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { getPrefs, setPrefs } from '@/lib/prefs';

/**
 * A compact chip in the Send/Receive headers that surfaces whether "Offline mode"
 * (LAN-only, croc --local) is on, and toggles it in place — a shortcut so users
 * don't have to dig into Settings. Self-contained: reads/writes the pref and holds
 * its own reflect state. Screens remount on navigation and each transfer re-reads
 * the pref, so this stays in sync with the Settings toggle without shared state.
 */
export function OfflineToggle() {
  const [on, setOn] = useState(() => getPrefs().localMode);
  const toggle = () => {
    const next = !on;
    setPrefs({ localMode: next });
    setOn(next);
  };
  return (
    <button
      onClick={toggle}
      title={
        on
          ? 'Offline mode is on — transfers use the local network only (no internet). Click to turn off.'
          : 'Turn on offline mode — transfer over local Wi-Fi only, no internet (both devices need it on).'
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        on
          ? 'border-brand/40 bg-brand-surface text-brand-deep'
          : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {on ? <WifiOff size={13} /> : <Wifi size={13} />}
      {on ? 'Offline' : 'Offline off'}
    </button>
  );
}
