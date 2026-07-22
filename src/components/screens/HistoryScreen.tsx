import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, History as HistoryIcon, Folder, Trash2 } from 'lucide-react';
import { croc, type HistoryEntry } from '@/lib/services/ipc';
import { Button } from '@/components/ui/button';
import { MiddleTruncate } from '@/components/ui/middle-truncate';

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

/** "Today 2:25 PM" / "Yesterday 9:10 AM" / "Jul 18 4:03 PM" */
function formatWhen(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => x.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(d) === day(now)) return `Today ${time}`;
  if (day(d) === day(yesterday)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function Row({ e }: { e: HistoryEntry }) {
  const isSend = e.kind === 'send';
  const title = e.isText ? 'Text message' : e.names[0] || 'Transfer';
  const meta = [
    isSend ? 'Sent' : 'Received',
    formatWhen(e.at),
    e.count > 1 ? `${e.count} files` : null,
    e.sizeHuman || null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        border: '1px solid var(--border)',
        borderRadius: 14,
        background: 'var(--card)',
        padding: '12px 16px',
        minWidth: 0,
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isSend ? 'var(--brand-surface)' : 'var(--info-surface)',
          color: isSend ? 'var(--brand-deep)' : 'var(--info-text)',
        }}
      >
        {isSend ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <MiddleTruncate text={title} style={{ fontSize: 14, fontWeight: 500 }} />
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>{meta}</div>
      </div>
      {e.kind === 'receive' && e.out && (
        <Button variant="ghost" size="sm" onClick={() => croc.showItem(e.out!)} style={{ flexShrink: 0 }}>
          <Folder /> Reveal
        </Button>
      )}
    </div>
  );
}

export function HistoryScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    croc.historyList().then(([, list]) => setEntries(list ?? []));
  }, []);

  const clearAll = async () => {
    const [, list] = await croc.historyClear();
    setEntries(list ?? []);
  };

  const shown = entries.filter((e) =>
    filter === 'all' ? true : filter === 'sent' ? e.kind === 'send' : e.kind === 'receive'
  );

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
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted-foreground)' }}>
          {entries.length} transfer{entries.length === 1 ? '' : 's'}
        </span>
        {entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <Trash2 /> Clear
          </Button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 32px 28px' }}>
        {shown.length === 0 ? (
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
            <div style={{ fontFamily: HEADING, fontSize: 18, fontWeight: 600 }}>
              {entries.length === 0 ? 'No transfers yet' : `No ${filter} transfers`}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted-foreground)', maxWidth: 320 }}>
              Sends and receives will show up here, kept locally on this device.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
