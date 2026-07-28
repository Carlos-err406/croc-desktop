import { useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { getPrefs, setPrefs } from '@/lib/prefs';

/**
 * A compact chip in the Send/Receive headers that surfaces whether "Local-only"
 * mode (LAN-only, croc --local) is on, and toggles it in place — a shortcut so
 * users don't have to dig into Settings. "Local" matches croc's --local flag and
 * the companion app's "local only" toggle. Self-contained: reads/writes the pref
 * and holds its own reflect state. Screens remount on navigation and each transfer
 * re-reads the pref, so this stays in sync with the Settings toggle.
 */
export function LocalToggle() {
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
          ? 'Local-only mode is on — transfers use the local network only (no internet or relay). Click to turn off.'
          : 'Turn on local-only mode — transfer over the local network only, no internet (both devices need it on).'
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        on
          ? 'border-brand/40 bg-brand-surface text-brand-deep'
          : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {on ? <WifiOff size={13} /> : <Wifi size={13} />}
      {/* Spell out the state: "Local off" read as a verb ("turn local off") rather
          than as the current setting. */}
      <span className="whitespace-nowrap">Local Only: {on ? 'ON' : 'OFF'}</span>
    </button>
  );
}
