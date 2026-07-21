import { useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';

const HEADING = 'var(--font-heading)';
type Filter = 'all' | 'sent' | 'received';

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      style={{
        fontSize: 13,
        fontWeight: 500,
        padding: '6px 14px',
        borderRadius: 7,
        cursor: 'pointer',
        background: active ? 'var(--card)' : 'transparent',
        color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
      }}
    >
      {children}
    </div>
  );
}

export function HistoryScreen() {
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '26px 32px 0' }}>
        <div style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 600, letterSpacing: '.01em' }}>History</div>
        <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 3 }}>
          Every transfer stays on this device. Nothing is stored in the cloud.
        </div>
      </div>

      <div style={{ padding: '18px 32px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', background: 'var(--secondary)', borderRadius: 9, padding: 3, gap: 3 }}>
          <Seg active={filter === 'all'} onClick={() => setFilter('all')}>All</Seg>
          <Seg active={filter === 'sent'} onClick={() => setFilter('sent')}>Sent</Seg>
          <Seg active={filter === 'received'} onClick={() => setFilter('received')}>Received</Seg>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted-foreground)' }}>0 transfers</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 32px 28px' }}>
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 14,
            padding: '56px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 12,
          }}
        >
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--secondary)', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HistoryIcon size={24} />
          </div>
          <div style={{ fontFamily: HEADING, fontSize: 18, fontWeight: 600 }}>No transfers yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', maxWidth: 320 }}>
            Sends and receives will show up here, kept locally on this device.
          </div>
        </div>
      </div>
    </div>
  );
}
