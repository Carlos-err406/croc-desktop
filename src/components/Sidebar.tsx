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
    <nav
      style={{
        width: 220,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 14px',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 22px' }}>
        <CrocBadge />
        <span
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 20,
            letterSpacing: '.02em',
          }}
        >
          Croc
        </span>
      </div>

      {NAV.map(({ id, label, Icon }) => (
        <button
          key={id}
          className="croc-nav"
          data-active={screen === id}
          onClick={() => onNavigate(id)}
          style={{ marginBottom: 3 }}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--success-surface)',
          }}
        >
          <Lock size={15} style={{ color: 'var(--success-text)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, lineHeight: 1.35, color: 'var(--success-text)' }}>
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
        <div
          title={`Built ${new Date(__BUILD_TIME__).toLocaleString()}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: '2px 12px 0',
            fontSize: 10,
            color: 'var(--muted-foreground)',
          }}
        >
          <span style={{ fontWeight: 500 }}>v{__APP_VERSION__}</span>
          <span>
            build{' '}
            {new Date(__BUILD_TIME__).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </nav>
  );
}
