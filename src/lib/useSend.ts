import { useEffect, useRef, useState } from 'react';
import type { CrocFileInfo, CrocProgress } from '@electron/lib/croc';
import { croc, type CrocEvent, type CrocSendResult, type StatEntry } from '@/lib/services/ipc';
import { getPrefs, relayArg } from '@/lib/prefs';

export type SendStatus =
  | 'idle'
  | 'staging'
  | 'starting'
  | 'waiting'
  | 'transferring'
  | 'done'
  | 'error';

export interface SendState {
  status: SendStatus;
  entries: StatEntry[];
  result: CrocSendResult | null;
  fileInfo: CrocFileInfo | null;
  progress: CrocProgress | null;
  error: string | null;
  logLines: string[];
}

const INITIAL: SendState = {
  status: 'idle',
  entries: [],
  result: null,
  fileInfo: null,
  progress: null,
  error: null,
  logLines: [],
};

function reduce(v: SendState, e: CrocEvent): SendState {
  switch (e.type) {
    case 'log':
      return { ...v, logLines: [...v.logLines, e.line].slice(-200) };
    case 'waiting':
      return v.status === 'starting' || v.status === 'waiting' ? { ...v, status: 'waiting' } : v;
    case 'peer':
      // Informational only. "Transferring" is driven by real byte progress so
      // a local-network announce line can't prematurely flip the screen.
      return v;
    case 'file-info':
      return { ...v, fileInfo: e.info };
    case 'progress':
      return { ...v, status: v.status === 'done' ? v.status : 'transferring', progress: e.progress };
    case 'done':
      return { ...v, status: 'done', progress: { ...(v.progress ?? {}), percent: 100 } };
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

export interface UseSend extends SendState {
  stage: (paths: string[]) => Promise<void>;
  removeEntry: (path: string) => void;
  clear: () => void;
  begin: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useSend(): UseSend {
  const [state, setState] = useState<SendState>(INITIAL);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = croc.onEvent((e: CrocEvent) => {
      // Only accept events for the transfer we're currently tracking. This
      // rejects stray events from a previous/abandoned send that would
      // otherwise flip a fresh transfer straight to "transferring".
      if (e.transferId !== idRef.current) return;
      setState((v) => reduce(v, e));
    });
    return unsub;
  }, []);

  async function stage(paths: string[]) {
    if (!paths.length) return;
    const [, entries] = await croc.statPaths(paths);
    if (!entries) return;
    setState((v) => {
      const existing = v.status === 'staging' ? v.entries : [];
      const map = new Map(existing.map((e) => [e.path, e]));
      for (const e of entries) map.set(e.path, e);
      return { ...INITIAL, status: 'staging', entries: [...map.values()] };
    });
  }

  function removeEntry(path: string) {
    setState((v) => {
      const entries = v.entries.filter((e) => e.path !== path);
      return entries.length ? { ...v, entries } : INITIAL;
    });
  }

  function clear() {
    setState(INITIAL);
  }

  async function begin() {
    const paths = state.entries.map((e) => e.path);
    if (!paths.length) return;
    // Stop any lingering transfer so it can't emit into this one.
    if (state.result) croc.cancel(state.result.transferId);

    // Claim the id BEFORE spawning so the event filter accepts only this
    // transfer's events from the very first tick (no null-id acceptance gap).
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({ ...v, status: 'starting', result: null, progress: null, error: null }));

    const [err, result] = await croc.send(paths, id, relayArg(), getPrefs().zipFolders);
    if (idRef.current !== id) return; // superseded or reset while starting
    if (err || !result) {
      setState((v) => ({ ...v, status: 'error', error: err?.message ?? 'Failed to start croc.' }));
      return;
    }
    setState((v) => ({
      ...v,
      result,
      status: v.status === 'transferring' || v.status === 'done' ? v.status : 'waiting',
    }));
  }

  function cancel() {
    if (state.result) croc.cancel(state.result.transferId);
    idRef.current = null;
    setState(INITIAL);
  }

  function reset() {
    if (state.result) croc.cancel(state.result.transferId);
    idRef.current = null;
    setState(INITIAL);
  }

  return { ...state, stage, removeEntry, clear, begin, cancel, reset };
}
