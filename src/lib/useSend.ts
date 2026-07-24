import { useEffect, useRef, useState } from 'react';
import type { CrocFileInfo, CrocProgress } from '@/lib/ipc-types';
import { croc, type CrocEvent, type CrocSendResult, type StatEntry } from '@/lib/services/ipc';
import { getPrefs, relayArg } from '@/lib/prefs';
import { useTransferNotification } from '@/lib/notify';

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
  isText: boolean; // sending a text message (croc send --text) rather than files
}

const INITIAL: SendState = {
  status: 'idle',
  entries: [],
  result: null,
  fileInfo: null,
  progress: null,
  error: null,
  logLines: [],
  isText: false,
};

function humanBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const u = ['kB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

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
  begin: (customCode?: string) => Promise<void>;
  sendText: (text: string, customCode?: string) => Promise<void>;
  addMore: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useSend(): UseSend {
  const [state, setState] = useState<SendState>(INITIAL);
  const idRef = useRef<string | null>(null);
  const recordedRef = useRef<string | null>(null);

  // Fire the completion notification from the hook (always mounted) rather than
  // the Send screen, so it shows even if the user navigated to another screen.
  useTransferNotification(state.status, state.error, (s) =>
    s === 'done'
      ? state.isText
        ? { title: 'Text sent', body: 'Your message was delivered to your peer.' }
        : {
            title: 'Files sent',
            body: state.entries.length
              ? `${state.entries.length} item${state.entries.length > 1 ? 's' : ''} delivered to your peer.`
              : 'Your files were delivered.',
          }
      : { title: 'Send failed', body: state.error ?? 'The transfer did not complete.' },
  );

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

  // Record a completed send in the local history, once per transfer.
  useEffect(() => {
    if (state.status !== 'done') return;
    const id = idRef.current;
    if (!id || recordedRef.current === id) return;
    recordedRef.current = id;
    const totalBytes = state.entries.reduce((a, e) => a + e.size, 0);
    croc.historyAdd({
      kind: 'send',
      names: state.isText ? ['Text message'] : state.entries.map((e) => e.name),
      count: state.isText ? 1 : state.entries.length,
      sizeHuman: state.isText || totalBytes === 0 ? undefined : humanBytes(totalBytes),
      code: state.result?.code,
      isText: state.isText || undefined,
      // Persist source paths for file sends so the entry can be re-sent.
      paths: state.isText ? undefined : state.entries.map((e) => e.path),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  async function stage(paths: string[]) {
    if (!paths.length) return;
    const [, all] = await croc.statPaths(paths);
    if (!all) return;
    // Drop paths that no longer exist (e.g. re-staging a moved/deleted history entry).
    const entries = all.filter((e) => e.exists);
    if (!entries.length) return;
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

  async function begin(customCode?: string) {
    const paths = state.entries.map((e) => e.path);
    if (!paths.length) return;
    // Stop any lingering transfer so it can't emit into this one.
    if (state.result) croc.cancel(state.result.transferId);

    // Claim the id BEFORE spawning so the event filter accepts only this
    // transfer's events from the very first tick (no null-id acceptance gap).
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({ ...v, status: 'starting', result: null, progress: null, error: null }));

    const code = customCode?.trim() || undefined;
    const [err, result] = await croc.send(paths, id, relayArg(), getPrefs().zipFolders, code);
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

  async function sendText(text: string, customCode?: string) {
    const msg = text.trim();
    if (!msg) return;
    if (state.result) croc.cancel(state.result.transferId);
    const id = crypto.randomUUID();
    idRef.current = id;
    setState(() => ({ ...INITIAL, isText: true, status: 'starting' }));

    const code = customCode?.trim() || undefined;
    const [err, result] = await croc.sendText(msg, id, relayArg(), code);
    if (idRef.current !== id) return;
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

  // Add more files while still waiting for the peer: croc can't add to a running
  // send, so cancel it, merge the new files, and re-send with the SAME code — the
  // shared code/QR stays valid. Only meaningful before the download starts.
  async function addMore() {
    if (state.status !== 'waiting') return;
    const code = state.result?.code;
    if (!code) return;
    const [, picked] = await croc.pickPaths();
    if (!picked || !picked.length) return;
    const [, stat] = await croc.statPaths(picked);
    const additions = (stat ?? []).filter((e) => e.exists);
    if (!additions.length) return;

    const map = new Map(state.entries.map((e) => [e.path, e]));
    for (const e of additions) map.set(e.path, e);
    const merged = [...map.values()];

    if (state.result) croc.cancel(state.result.transferId);
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({ ...v, entries: merged, result: null, progress: null, error: null, status: 'starting' }));
    // Give the relay a moment to release the code before re-registering it.
    await new Promise((r) => setTimeout(r, 500));
    if (idRef.current !== id) return;
    const [err, result] = await croc.send(merged.map((e) => e.path), id, relayArg(), getPrefs().zipFolders, code);
    if (idRef.current !== id) return;
    if (err || !result) {
      setState((v) => ({ ...v, status: 'error', error: err?.message ?? 'Failed to restart the transfer.' }));
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

  return { ...state, stage, removeEntry, clear, begin, sendText, addMore, cancel, reset };
}
