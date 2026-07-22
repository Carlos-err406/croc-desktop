import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, History as HistoryIcon, Folder, Trash2 } from 'lucide-react';
import { croc, type HistoryEntry } from '@/lib/services/ipc';
import { Button } from '@/components/ui/button';
import { MiddleTruncate } from '@/components/ui/middle-truncate';

type Filter = 'all' | 'sent' | 'received';

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${
        active ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,.1)]' : 'text-muted-foreground'
      }`}
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
    <div className="flex min-w-0 items-center gap-3.5 rounded-[14px] border border-border bg-card px-4 py-3">
      <span
        className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] ${
          isSend ? 'bg-brand-surface text-brand-deep' : 'bg-info-surface text-info-text'
        }`}
      >
        {isSend ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <MiddleTruncate text={title} className="text-sm font-medium" />
        <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div>
      </div>
      {e.kind === 'receive' && e.out && (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => croc.showItem(e.out!)}>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-8 pt-[26px]">
        <div className="font-heading text-[26px] font-semibold tracking-[.01em]">History</div>
        <div className="mt-[3px] text-[13px] text-muted-foreground">
          Every transfer stays on this device. Nothing is stored in the cloud.
        </div>
      </div>

      <div className="flex items-center gap-3 px-8 pt-[18px]">
        <div className="flex gap-[3px] rounded-[9px] bg-secondary p-[3px]">
          <Seg active={filter === 'all'} onClick={() => setFilter('all')}>All</Seg>
          <Seg active={filter === 'sent'} onClick={() => setFilter('sent')}>Sent</Seg>
          <Seg active={filter === 'received'} onClick={() => setFilter('received')}>Received</Seg>
        </div>
        <span className="ml-auto text-[13px] text-muted-foreground">
          {entries.length} transfer{entries.length === 1 ? '' : 's'}
        </span>
        {entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <Trash2 /> Clear
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-7 pt-4">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-border px-6 py-14 text-center">
            <div className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <HistoryIcon size={24} />
            </div>
            <div className="font-heading text-lg font-semibold">
              {entries.length === 0 ? 'No transfers yet' : `No ${filter} transfers`}
            </div>
            <div className="max-w-[320px] text-[13px] text-muted-foreground">
              Sends and receives will show up here, kept locally on this device.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {shown.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
