import { Download, History, Send, Settings, Lock } from 'lucide-react';
import { CrocBadge } from '@/components/CrocLogo';
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
        </button>
        <button
          onClick={() => onNavigate('about')}
          title="About Croc Desktop"
          data-active={screen === 'about'}
          className="flex items-baseline justify-between rounded-md px-3 pt-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground data-[active=true]:text-brand-deep"
        >
          <span className="font-medium">v{__APP_VERSION__}</span>
          <span>
            build{' '}
            {new Date(__BUILD_TIME__).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </button>
      </div>
    </nav>
  );
}
