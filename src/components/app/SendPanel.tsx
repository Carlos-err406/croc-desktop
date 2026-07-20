import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { basename } from '@/lib/paths';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { SendView } from './SendApp';

function filesLabel(view: SendView): string {
  if (view.fileInfo) return `${view.fileInfo.name} · ${view.fileInfo.totalHuman}`;
  if (view.files.length === 1) return basename(view.files[0]);
  return `${view.files.length} items`;
}

function useCopy(): { copied: boolean; copy: (value: string) => void } {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (value: string) => {
      if (await copyText(value)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }
    },
  };
}

function PulseDot({ className }: { className?: string }) {
  return (
    <span className="relative flex size-2.5 shrink-0">
      <span
        className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', className)}
      />
      <span className={cn('relative inline-flex size-2.5 rounded-full', className)} />
    </span>
  );
}

/** The big, click-anywhere-to-copy code. */
function CodeBlock({ code }: { code: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(code)}
      title="Click to copy"
      className="group bg-background hover:border-primary/50 relative flex w-full items-center justify-center rounded-xl border px-10 py-3.5 transition-colors"
    >
      <span className="text-primary font-mono text-xl font-semibold tracking-tight select-all">
        {code}
      </span>
      <span className="text-muted-foreground group-hover:text-foreground absolute right-3.5 transition-colors">
        {copied ? <Check className="text-primary size-4" /> : <Copy className="size-4" />}
      </span>
    </button>
  );
}

/** QR + concise receiver instructions, side by side. */
function ReceiverHelp({ qr, command }: { qr: string | null; command: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-4">
      {qr && (
        <img
          src={qr}
          alt="Transfer code QR"
          draggable={false}
          className="size-28 shrink-0 rounded-lg bg-white p-1.5"
        />
      )}
      <div className="min-w-0 space-y-2 text-left">
        <p className="text-muted-foreground text-xs leading-relaxed">
          On the other computer, run <code className="text-foreground">croc</code> and enter the
          code — or paste this one-liner:
        </p>
        <button
          type="button"
          onClick={() => copy(command)}
          title="Click to copy"
          className="bg-background hover:border-primary/40 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 transition-colors"
        >
          <code className="min-w-0 flex-1 truncate text-left font-mono text-xs">{command}</code>
          {copied ? (
            <Check className="text-primary size-3.5 shrink-0" />
          ) : (
            <Copy className="text-muted-foreground size-3.5 shrink-0" />
          )}
        </button>
      </div>
    </div>
  );
}

export function SendPanel({
  view,
  onCancel,
  onReset,
}: {
  view: SendView;
  onCancel: () => void;
  onReset: () => void;
}) {
  const { status, result, progress } = view;
  const active = status === 'starting' || status === 'waiting' || status === 'transferring';
  const percent = progress?.percent ?? 0;
  const speedEta = [progress?.speedHuman, progress?.etaHuman ? `ETA ${progress.etaHuman}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* What's being sent */}
      <div className="text-muted-foreground bg-card/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <Send className="text-primary size-4 shrink-0" />
        <span className="text-foreground truncate">{filesLabel(view)}</span>
      </div>

      {/* Starting */}
      {status === 'starting' && (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3">
          <Loader2 className="text-primary size-6 animate-spin" />
          <span className="text-sm">Starting croc…</span>
        </div>
      )}

      {/* Waiting: share the code */}
      {status === 'waiting' && result && (
        <div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
          <p className="text-muted-foreground text-center text-sm">Share this code with the receiver</p>
          <CodeBlock code={result.code} />
          <ReceiverHelp qr={result.qr} command={result.receiveCommand.posix} />
          <div className="text-muted-foreground flex items-center justify-center gap-2 border-t pt-3 text-sm">
            <PulseDot className="bg-amber-400" />
            <span>Waiting for the receiver to connect…</span>
          </div>
        </div>
      )}

      {/* Transferring: progress is the hero */}
      {status === 'transferring' && (
        <div className="bg-card flex flex-col gap-3 rounded-xl border p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-semibold tabular-nums">{percent}%</span>
            <span className="text-muted-foreground font-mono text-sm">{speedEta}</span>
          </div>
          <Progress value={percent} />
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <PulseDot className="bg-primary" />
            <span>
              Connected — sending
              {progress?.transferredHuman && progress?.totalHuman
                ? ` ${progress.transferredHuman} / ${progress.totalHuman}`
                : ''}
            </span>
          </div>
          {result && (
            <p className="text-muted-foreground/70 font-mono text-xs">code {result.code}</p>
          )}
        </div>
      )}

      {/* Done */}
      {status === 'done' && (
        <div className="bg-card flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center">
          <div className="bg-primary/15 text-primary flex size-14 items-center justify-center rounded-full">
            <CheckCircle2 className="size-7" />
          </div>
          <p className="text-lg font-semibold">Sent</p>
          <p className="text-muted-foreground text-sm">{filesLabel(view)} delivered securely</p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-xl border p-4">
          <div className="text-destructive flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" />
            Transfer failed
          </div>
          {view.error && <p className="text-destructive/90 text-sm">{view.error}</p>}
        </div>
      )}

      {/* Activity log */}
      {view.logLines.length > 0 && (
        <details className="text-sm">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
            Activity log
          </summary>
          <pre className="bg-background text-muted-foreground mt-2 max-h-28 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
            {view.logLines.join('\n')}
          </pre>
        </details>
      )}

      {/* Actions */}
      <div className="mt-auto flex justify-end gap-2 pt-1">
        {active ? (
          <Button variant="outline" onClick={onCancel}>
            <X /> Cancel
          </Button>
        ) : (
          <Button onClick={onReset}>
            {status === 'error' ? <RotateCcw /> : <Send />}
            {status === 'error' ? 'Try again' : 'Send another'}
          </Button>
        )}
      </div>
    </div>
  );
}
