import { Download, History, Send, Settings, Lock, Info } from 'lucide-react';
import { CrocBadge } from '@/components/CrocLogo';
import { useUpdater } from '@/lib/updater';
import type { Screen } from './AppShell';

const NAV = [
  { id: 'send' as const, label: 'Send', Icon: Send },
  { id: 'receive' as const, label: 'Receive', Icon: Download },
  { id: 'history' as const, label: 'History', Icon: History },
];

export function Sidebar({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const { status: updateStatus } = useUpdater();
  const updateReady = updateStatus === 'available' || updateStatus === 'ready';
  return (
    <nav className="flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar px-[14px] py-5">
      <div className="flex items-center gap-2.5 px-2 pb-[22px] pt-1.5">
        <CrocBadge />
        <span className="font-heading text-xl font-semibold tracking-[.02em]">Croc</span>
      </div>

      {NAV.map(({ id, label, Icon }) => (
        <button
          key={id}
          className="croc-nav mb-[3px]"
          data-active={screen === id}
          onClick={() => onNavigate(id)}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex items-center gap-[9px] rounded-[10px] bg-success-surface px-3 py-2.5">
          <Lock size={15} className="shrink-0 text-success-text" />
          <span className="text-[11px] leading-[1.35] text-success-text">
            End-to-end encrypted
            <br />
            peer-to-peer
          </span>
        </div>
        <button
          className="croc-nav"
          data-active={screen === 'settings'}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={18} />
          Settings
          {updateReady && (
            <span className="relative ml-auto flex h-2 w-2" title="Update available">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
          )}
        </button>
        <button
          className="croc-nav"
          data-active={screen === 'about'}
          onClick={() => onNavigate('about')}
        >
          <Info size={18} />
          About
          <span className="ml-auto text-[10px] font-medium text-muted-foreground">
            v{__APP_VERSION__}
          </span>
        </button>
      </div>
    </nav>
  );
}
