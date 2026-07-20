import { useEffect, useRef, useState } from 'react';
import type { CrocFileInfo, CrocProgress } from '@electron/lib/croc';
import { croc, type CrocEvent, type CrocSendResult } from '@/lib/services/ipc';
import { Dropzone } from './Dropzone';
import { StagingPanel } from './StagingPanel';
import { SendPanel } from './SendPanel';

export type SendStatus =
  | 'idle'
  | 'selected'
  | 'starting'
  | 'waiting'
  | 'transferring'
  | 'done'
  | 'error';

export interface SendView {
  status: SendStatus;
  files: string[];
  result: CrocSendResult | null;
  fileInfo: CrocFileInfo | null;
  progress: CrocProgress | null;
  error: string | null;
  logLines: string[];
}

const INITIAL: SendView = {
  status: 'idle',
  files: [],
  result: null,
  fileInfo: null,
  progress: null,
  error: null,
  logLines: [],
};

function reduce(v: SendView, e: CrocEvent): SendView {
  switch (e.type) {
    case 'log':
      return { ...v, logLines: [...v.logLines, e.line].slice(-200) };
    case 'waiting':
      return v.status === 'starting' || v.status === 'waiting' ? { ...v, status: 'waiting' } : v;
    case 'peer':
      return v.status === 'done' ? v : { ...v, status: 'transferring' };
    case 'file-info':
      return { ...v, fileInfo: e.info };
    case 'progress':
      return {
        ...v,
        status: v.status === 'done' ? v.status : 'transferring',
        progress: e.progress,
      };
    case 'done':
      return {
        ...v,
        status: 'done',
        progress: { ...(v.progress ?? {}), percent: 100 },
      };
    case 'error':
      return { ...v, status: 'error', error: e.message };
    case 'exit':
      if (v.status === 'done' || v.status === 'error') return v;
      return e.code === 0
        ? { ...v, status: 'done' }
        : { ...v, status: 'error', error: `croc exited (code ${e.code}).` };
    default:
      return v;
  }
}

function Header() {
  return (
    <header className="flex select-none items-center gap-2 border-b px-4 py-3">
      <span className="text-lg leading-none">🐊</span>
      <span className="text-sm font-semibold tracking-tight">Croc Desktop</span>
      <span className="text-muted-foreground ml-auto text-xs">secure file transfer</span>
    </header>
  );
}

export function SendApp() {
  const [view, setView] = useState<SendView>(INITIAL);
  const transferIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = croc.onEvent((e: CrocEvent) => {
      if (transferIdRef.current && e.transferId !== transferIdRef.current) return;
      setView((v) => reduce(v, e));
    });
    return unsub;
  }, []);

  // Stage files (from a drop or the picker) without starting the transfer yet.
  function stage(paths: string[]) {
    setView((v) => {
      const existing = v.status === 'selected' ? v.files : [];
      const files = Array.from(new Set([...existing, ...paths]));
      return { ...INITIAL, status: 'selected', files };
    });
  }

  function removeFile(path: string) {
    setView((v) => {
      const files = v.files.filter((f) => f !== path);
      return files.length ? { ...v, files } : INITIAL;
    });
  }

  // Kick off the actual croc send for the staged files.
  async function begin() {
    const paths = view.files;
    if (!paths.length) return;
    transferIdRef.current = null;
    setView((v) => ({ ...v, status: 'starting' }));

    const [err, result] = await croc.send(paths);
    if (err || !result) {
      setView((v) => ({ ...v, status: 'error', error: err?.message ?? 'Failed to start croc.' }));
      return;
    }
    transferIdRef.current = result.transferId;
    setView((v) => ({
      ...v,
      result,
      status: v.status === 'transferring' || v.status === 'done' ? v.status : 'waiting',
    }));
  }

  function cancel() {
    if (view.result) croc.cancel(view.result.transferId);
    transferIdRef.current = null;
    setView(INITIAL);
  }

  function reset() {
    transferIdRef.current = null;
    setView(INITIAL);
  }

  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {view.status === 'idle' && <Dropzone onFiles={stage} />}
        {view.status === 'selected' && (
          <StagingPanel
            files={view.files}
            onAdd={stage}
            onRemove={removeFile}
            onClear={reset}
            onSend={begin}
          />
        )}
        {view.status !== 'idle' && view.status !== 'selected' && (
          <SendPanel view={view} onCancel={cancel} onReset={reset} />
        )}
      </main>
    </div>
  );
}
