import { useEffect, useRef, useState } from 'react';
import type { CrocFileInfo, CrocProgress } from '@/lib/ipc-types';
import { croc, type CrocEvent, type CrocSendResult, type StatEntry } from '@/lib/services/ipc';
import { getPrefs, relayArg } from '@/lib/prefs';
import { notify, useTransferNotification } from '@/lib/notify';

// A dropped transfer is retried automatically a few times before we surface the
// error — the sender re-offers the same code, so it re-rendezvous with a peer that
// is also retrying, without either side manually pressing "Try again".
export const MAX_AUTO_RECONNECT = 4;
const reconnectDelay = (attempt: number) => Math.min(4000, 1000 * attempt);

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
  reconnecting: boolean; // auto-retrying a dropped transfer (keeps the code alive)
  reconnectAttempt: number; // 1-based attempt number while reconnecting
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
  reconnecting: false,
  reconnectAttempt: 0,
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
  stage: (paths: string[], code?: string) => Promise<void>;
  removeEntry: (path: string) => void;
  clear: () => void;
  begin: (customCode?: string) => Promise<void>;
  sendText: (text: string, customCode?: string) => Promise<void>;
  addMore: () => Promise<void>;
  /** Put the send into a stated error state (e.g. a pick that couldn't be staged). */
  fail: (message: string) => void;
  retry: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
  // One-shot: the code to prefill the custom-code field with (e.g. a history
  // "Send again" reusing its original code, or a scanned "send to me" invite).
  // Returns it once, then clears.
  takePresetCode: () => string | undefined;
  /** Queue a code for the Send screen to prefill (reverse pairing / deep link). */
  setPresetCode: (code: string) => void;
}

export function useSend(): UseSend {
  const [state, setState] = useState<SendState>(INITIAL);
  const idRef = useRef<string | null>(null);
  const recordedRef = useRef<string | null>(null);
  const autoAttemptRef = useRef(0); // auto-reconnect attempts used for the current transfer
  const reconnectTimerRef = useRef<number | null>(null);
  const failedNotifiedRef = useRef<string | null>(null); // transfer id we've already notified failure for
  const presetCodeRef = useRef<string | undefined>(undefined); // code to prefill on next stage (history resend)

  function clearReconnect() {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  // Fire the completion notification from the hook (always mounted) rather than
  // the Send screen, so it shows even if the user navigated to another screen.
  // Success fires here; failure fires from the auto-reconnect give-up path below so
  // it notifies once, only after retries are exhausted (not on each transient drop).
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
      : null,
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
    // The staged copies exist only so croc had a real path to read; once the send is
    // recorded they're dead weight. Without this they accumulated one directory per
    // pick (observed: four on a real device), which for a large video is real waste.
    void croc.clearStaged();
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

  // Auto-reconnect a dropped transfer: re-offer the same code a few times with
  // backoff before surfacing the error. Only for file sends with staged entries
  // (a text send can't be reconstructed here). On the final failure, notify once.
  useEffect(() => {
    if (state.status !== 'error') return;
    const eligible = !state.isText && state.entries.length > 0;
    if (eligible && autoAttemptRef.current < MAX_AUTO_RECONNECT) {
      const attempt = autoAttemptRef.current + 1;
      autoAttemptRef.current = attempt;
      setState((v) => ({ ...v, reconnecting: true, reconnectAttempt: attempt }));
      clearReconnect();
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void respawn();
      }, reconnectDelay(attempt));
      return;
    }
    // Not eligible, or attempts exhausted → surface the failure and notify once.
    setState((v) => (v.reconnecting ? { ...v, reconnecting: false } : v));
    const id = idRef.current;
    if (id && failedNotifiedRef.current !== id) {
      failedNotifiedRef.current = id;
      void notify('Send failed', state.error ?? 'The transfer did not complete.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  async function stage(paths: string[], code?: string) {
    if (!paths.length) return;
    clearReconnect();
    autoAttemptRef.current = 0;
    // Remember a code to reuse (history "Send again"); the Send screen reads it via
    // takePresetCode() when it mounts. Set synchronously (before any await) so it's
    // ready by the time the screen re-renders.
    if (code && code.trim().length >= 6) presetCodeRef.current = code.trim();
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
      // Last entry gone means the staging area has nothing left to hold; on Android
      // those are cache copies that would otherwise linger until the next reset.
      if (!entries.length) void croc.clearStaged();
      return entries.length ? { ...v, entries } : INITIAL;
    });
  }

  function clear() {
    setState(INITIAL);
    void croc.clearStaged();
  }

  function fail(message: string) {
    setState((v) => ({ ...v, status: 'error', error: message }));
  }

  async function begin(customCode?: string) {
    const paths = state.entries.map((e) => e.path);
    if (!paths.length) return;
    // Stop any lingering transfer so it can't emit into this one.
    if (state.result) croc.cancel(state.result.transferId);

    // Claim the id BEFORE spawning so the event filter accepts only this
    // transfer's events from the very first tick (no null-id acceptance gap).
    clearReconnect();
    autoAttemptRef.current = 0;
    failedNotifiedRef.current = null;
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({
      ...v,
      status: 'starting',
      result: null,
      progress: null,
      error: null,
      reconnecting: false,
      reconnectAttempt: 0,
    }));

    const code = customCode?.trim() || undefined;
    const [err, result] = await croc.send(paths, id, relayArg(), getPrefs().zipFolders, code, getPrefs().localMode);
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
    clearReconnect();
    autoAttemptRef.current = 0;
    failedNotifiedRef.current = null;
    if (state.result) croc.cancel(state.result.transferId);
    const id = crypto.randomUUID();
    idRef.current = id;
    setState(() => ({ ...INITIAL, isText: true, status: 'starting' }));

    const code = customCode?.trim() || undefined;
    const [err, result] = await croc.sendText(msg, id, relayArg(), code, getPrefs().localMode);
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
    const [pickErr, picked] = await croc.pickPaths();
    if (pickErr) {
      fail(pickErr.message);
      return;
    }
    if (!picked || !picked.length) return;
    const [, stat] = await croc.statPaths(picked);
    const additions = (stat ?? []).filter((e) => e.exists);
    if (!additions.length) return;

    const map = new Map(state.entries.map((e) => [e.path, e]));
    for (const e of additions) map.set(e.path, e);
    const merged = [...map.values()];

    clearReconnect();
    autoAttemptRef.current = 0;
    if (state.result) croc.cancel(state.result.transferId);
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({ ...v, entries: merged, result: null, progress: null, error: null, status: 'starting' }));
    // Give the relay a moment to release the code before re-registering it.
    await new Promise((r) => setTimeout(r, 500));
    if (idRef.current !== id) return;
    const [err, result] = await croc.send(merged.map((e) => e.path), id, relayArg(), getPrefs().zipFolders, code, getPrefs().localMode);
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

  // Re-offer the staged files under the same code (so a QR/code the peer may
  // already hold stays valid) — the shared logic behind both a manual "Try again"
  // and the automatic reconnect. Keeps the entries; never re-stages or re-codes.
  async function respawn() {
    if (!state.entries.length) return;
    const prev = state.result;
    if (prev) croc.cancel(prev.transferId);
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({ ...v, status: 'starting', result: null, progress: null, error: null }));
    // Give the relay a moment to release the code before re-registering it.
    await new Promise((r) => setTimeout(r, 500));
    if (idRef.current !== id) return;
    const [err, result] = await croc.send(
      state.entries.map((e) => e.path),
      id,
      relayArg(),
      getPrefs().zipFolders,
      prev?.code,
      getPrefs().localMode,
    );
    if (idRef.current !== id) return;
    if (err || !result) {
      setState((v) => ({ ...v, status: 'error', error: err?.message ?? 'Failed to restart the transfer.' }));
      return;
    }
    setState((v) => ({
      ...v,
      result,
      reconnecting: false,
      reconnectAttempt: 0,
      status: v.status === 'transferring' || v.status === 'done' ? v.status : 'waiting',
    }));
  }

  // Manual "Try again": reset the auto-reconnect budget, then re-offer.
  async function retry() {
    clearReconnect();
    autoAttemptRef.current = 0;
    failedNotifiedRef.current = null;
    setState((v) => ({ ...v, reconnecting: false, reconnectAttempt: 0 }));
    await respawn();
  }

  function cancel() {
    clearReconnect();
    autoAttemptRef.current = 0;
    if (state.result) croc.cancel(state.result.transferId);
    idRef.current = null;
    setState(INITIAL);
    void croc.clearStaged();
  }

  function reset() {
    clearReconnect();
    autoAttemptRef.current = 0;
    if (state.result) croc.cancel(state.result.transferId);
    idRef.current = null;
    setState(INITIAL);
    // Android copies each picked file into a cache dir so croc has a real path to
    // read; clearing the staging area here stops those copies accumulating.
    void croc.clearStaged();
  }

  function setPresetCode(code: string) {
    if (code.trim().length >= 6) presetCodeRef.current = code.trim();
  }

  function takePresetCode(): string | undefined {
    const c = presetCodeRef.current;
    presetCodeRef.current = undefined;
    return c;
  }

  return {
    ...state,
    stage,
    removeEntry,
    clear,
    begin,
    sendText,
    addMore,
    fail,
    retry,
    cancel,
    reset,
    takePresetCode,
    setPresetCode,
  };
}
