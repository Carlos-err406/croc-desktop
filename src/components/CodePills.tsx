import { X } from 'lucide-react';
import type { SavedCode } from '@/lib/codes';

/** Bookmarked codes as clickable pills; click to fill, × to remove. */
export function CodePills({
  codes,
  onPick,
  onRemove,
}: {
  codes: SavedCode[];
  onPick: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  if (!codes.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((c) => (
        <span
          key={c.code}
          className="croc-code-pill group inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 py-1 pl-2.5 pr-1.5 text-xs"
        >
          <button
            className="max-w-[170px] truncate font-medium text-foreground transition-colors hover:text-brand-deep"
            onClick={() => onPick(c.code)}
            title={`Use ${c.code}`}
          >
            {c.code}
          </button>
          <button
            className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={() => onRemove(c.code)}
            title="Remove bookmark"
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
