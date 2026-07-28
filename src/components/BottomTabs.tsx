import { Download, History, Info, Send, Settings } from 'lucide-react';
import { useUpdater } from '@/lib/updater';
import type { Screen } from './AppShell';

const TABS = [
  { id: 'send' as const, label: 'Send', Icon: Send },
  { id: 'receive' as const, label: 'Receive', Icon: Download },
  { id: 'history' as const, label: 'History', Icon: History },
  { id: 'settings' as const, label: 'Settings', Icon: Settings },
  { id: 'about' as const, label: 'About', Icon: Info },
];

/**
 * Phone navigation: the sidebar's job, moved to the thumb. Shown below `md` and
 * hidden above it, so a narrow desktop window gets it too.
 *
 * `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the gesture bar — that
 * bar overlays app content on modern Android, so without it the bottom of every tab
 * would be unreachable.
 */
export function BottomTabs({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const { status: updateStatus } = useUpdater();
  const updateReady = updateStatus === 'available' || updateStatus === 'ready';

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Main"
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = screen === id;
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            aria-current={active ? 'page' : undefined}
            data-active={active}
            // min-h keeps every tab a comfortable touch target.
            className="relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-[3px] px-1 py-2 text-[10px] font-medium transition-colors"
          >
            <Icon size={20} className={active ? 'text-brand-deep' : 'text-muted-foreground'} />
            <span className={active ? 'text-brand-deep' : 'text-muted-foreground'}>{label}</span>
            {id === 'settings' && updateReady && (
              <span
                className="absolute right-[calc(50%-18px)] top-2 h-2 w-2 rounded-full bg-brand"
                title="Update available"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
