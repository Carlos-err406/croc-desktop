import { useEffect, useRef, useState } from 'react';
import type { CrocFileInfo, CrocProgress, CrocPrompt } from '@/lib/ipc-types';
import { CAN_USE_FILE_PATHS, IS_ANDROID } from '@/lib/platform';
import { croc, type CrocEvent } from '@/lib/services/ipc';
import { getPrefs, relayArg } from '@/lib/prefs';
import { notify, useTransferNotification } from '@/lib/notify';

// Auto-retry a dropped receive a few times before surfacing the error, so it
// re-rendezvous with a sender that is also retrying — no manual coordination.
export const MAX_AUTO_RECONNECT = 4;
const reconnectDelay = (attempt: number) => Math.min(4000, 1000 * attempt);

export type ReceiveStatus = 'idle' | 'connecting' | 'receiving' | 'done' | 'error';

export interface ReceiveFile {
  name: string;
  percent: number;
  size: string;
}

export interface ReceiveState {
  status: ReceiveStatus;
  code: string;
  fileInfo: CrocFileInfo | null;
  perFile: ReceiveFile[]; // built from per-file progress lines as they arrive
  totalFiles: number; // total count croc reported ("N files"), or 1
  currentFile: string;
  progress: CrocProgress | null;
  isText: boolean; // sender used `croc send --text` — receiving a message, not files
  text: string | null; // the received text body
  error: string | null;
  out: string;
  // Android publishes finished receives to Downloads, since the app's own data dir
  // is invisible to every other app. Where they ended up, once that's done.
  savedTo: string | null;
  saveError: string | null;
  logLines: string[];
  prompt: CrocPrompt | null; // pending accept/overwrite prompt awaiting the user
  reconnecting: boolean; // auto-retrying a dropped receive with the same code
  reconnectAttempt: number; // 1-based attempt number while reconnecting
}

const INITIAL: ReceiveState = {
  status: 'idle',
  code: '',
  fileInfo: null,
  perFile: [],
  totalFiles: 1,
  currentFile: '',
  progress: null,
  isText: false,
  text: null,
  error: null,
  out: '',
  savedTo: null,
  saveError: null,
  logLines: [],
  prompt: null,
  reconnecting: false,
  reconnectAttempt: 0,
};

function reduce(v: ReceiveState, e: CrocEvent): ReceiveState {
  switch (e.type) {
    case 'log':
      return { ...v, logLines: [...v.logLines, e.line].slice(-200) };
    case 'waiting':
      return v.status === 'connecting' ? v : { ...v, status: 'connecting' };
    case 'peer':
      return v; // informational; "receiving" is driven by real byte progress
    case 'file-info': {
      // A text message (`croc send --text`) — not files. Switch to text mode.
      if (e.info.isText) {
        return { ...v, isText: true, fileInfo: e.info };
      }
      // A batch ("N files") only tells us the count — not per-file names.
      if (e.info.count && e.info.count > 1) {
        return { ...v, fileInfo: e.info, totalFiles: e.info.count };
      }
      // A single named file: seed the per-file list.
      const perFile = v.perFile.some((f) => f.name === e.info.name)
        ? v.perFile
        : [...v.perFile, { name: e.info.name, percent: 0, size: e.info.totalHuman }];
      return { ...v, fileInfo: e.info, perFile, totalFiles: Math.max(v.totalFiles, 1), currentFile: e.info.name };
    }
    case 'progress': {
      const p = e.progress;
      let perFile = v.perFile;
      let currentFile = v.currentFile;
      const totalFiles = p.count && p.count > 1 ? p.count : v.totalFiles;
      if (p.file) {
        // croc transfers files one at a time: when a new file's progress
        // starts, the previous one is fully received — but croc doesn't always
        // emit a final "100%" line, so backfill it here instead of leaving it
        // stuck at e.g. 98%.
        if (v.currentFile && v.currentFile !== p.file) {
          perFile = perFile.map((f) => (f.name === v.currentFile ? { ...f, percent: 100 } : f));
        }
        currentFile = p.file;
        const i = perFile.findIndex((f) => f.name === p.file);
        const size = p.totalHuman || (i >= 0 ? perFile[i].size : '');
        const row = { name: p.file, percent: p.percent, size };
        perFile = i >= 0 ? perFile.map((f, j) => (j === i ? row : f)) : [...perFile, row];
      }
      return {
        ...v,
        status: v.status === 'done' ? v.status : 'receiving',
        progress: p,
        perFile,
        currentFile,
        totalFiles,
        prompt: null,
        reconnecting: false, // bytes are flowing — the (re)connection took
        reconnectAttempt: 0,
      };
    }
    case 'text':
      return { ...v, isText: true, text: e.text, reconnecting: false, reconnectAttempt: 0 };
    case 'prompt':
      return {
        ...v,
        prompt: {
          kind: e.kind,
          fname: e.fname,
          size: e.size,
          file: e.file,
          percent: e.percent,
          message: e.message,
          defaultYes: e.defaultYes,
        },
      };
    case 'done':
      return {
        ...v,
        status: 'done',
        prompt: null,
        reconnecting: false,
        reconnectAttempt: 0,
        progress: { ...(v.progress ?? {}), percent: 100 },
        perFile: v.perFile.map((f) => ({ ...f, percent: 100 })),
      };
    case 'error':
      return { ...v, status: 'error', error: e.message, prompt: null };
    case 'exit':
      if (v.status === 'done' || v.status === 'error') return v;
      return e.code === 0
        ? { ...v, status: 'done', prompt: null }
        : { ...v, status: 'error', error: `croc exited (code ${e.code}).`, prompt: null };
    default:
      return v;
  }
}

/** Per-transfer connection overrides embedded in a scanned/clicked link — applied
 *  to that receive only, without changing the user's saved prefs. */
export interface ReceiveOverrides {
  local?: boolean;
  relay?: string;
}

export interface UseReceive extends ReceiveState {
  setCode: (code: string) => void;
  begin: (codeArg?: string, overrides?: ReceiveOverrides) => Promise<void>;
  respond: (yes: boolean) => void;
  retry: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useReceive(): UseReceive {
  const [state, setState] = useState<ReceiveState>(INITIAL);
  const idRef = useRef<string | null>(null);
  const outRef = useRef('');
  const recordedRef = useRef<string | null>(null);
  const autoAttemptRef = useRef(0); // auto-reconnect attempts used for the current receive
  const reconnectTimerRef = useRef<number | null>(null);
  const failedNotifiedRef = useRef<string | null>(null); // transfer id we've already notified failure for
  const overridesRef = useRef<ReceiveOverrides | undefined>(undefined); // per-transfer settings from a link

  function clearReconnect() {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  // Fire the completion notification from the hook (always mounted) rather than
  // the Receive screen, so it shows even if the user navigated away.
  // Success fires here; failure fires from the auto-reconnect give-up path below so
  // it notifies once, only after retries are exhausted (not on each transient drop).
  useTransferNotification(state.status, state.error, (s) =>
    s === 'done'
      ? state.isText
        ? { title: 'Text received', body: 'A text message arrived from your peer.' }
        : {
            title: 'Download complete',
            body: state.totalFiles
              ? `Received ${state.totalFiles} file${state.totalFiles === 1 ? '' : 's'}.`
              : 'Your files were received.',
          }
      : null,
  );

  useEffect(() => {
    const unsub = croc.onEvent((e: CrocEvent) => {
      if (e.transferId !== idRef.current) return;
      // Reveal the download folder on completion, if enabled.
      if (
        CAN_USE_FILE_PATHS &&
        (e.type === 'done' || (e.type === 'exit' && e.code === 0)) &&
        getPrefs().revealOnDone &&
        outRef.current
      ) {
        croc.showItem(outRef.current);
      }
      // A prompt means croc is blocked waiting for the user — nudge them.
      if (e.type === 'prompt') {
        const body =
          e.kind === 'accept'
            ? `A peer wants to send you ${e.fname ?? 'files'}${e.size ? ` (${e.size})` : ''}.`
            : e.kind === 'overwrite'
              ? `'${e.file}' already exists — replace it?`
              : e.kind === 'resume'
                ? `Resume the partial download of '${e.file}'?`
                : 'Croc needs your confirmation to continue.';
        void notify('Croc is waiting for you', body);
      }
      setState((v) => reduce(v, e));
    });
    return unsub;
  }, []);

  // Publish to Downloads (Android), then record the receive in the local history —
  // once per transfer, and in that order so history points at where the files
  // actually ended up rather than the private dir they passed through.
  useEffect(() => {
    if (state.status !== 'done') return;
    const id = idRef.current;
    if (!id || recordedRef.current === id) return;
    recordedRef.current = id;

    const record = (out?: string) =>
      croc.historyAdd({
        kind: 'receive',
        names: state.isText ? ['Text message'] : state.perFile.map((f) => f.name),
        count: state.isText ? 1 : Math.max(state.perFile.length, state.totalFiles > 1 ? state.totalFiles : 1),
        sizeHuman: state.progress?.totalHuman ?? undefined,
        out,
        isText: state.isText || undefined,
      });

    // A text message has no files to publish.
    if (!IS_ANDROID || state.isText) {
      record(state.out || undefined);
      return;
    }
    void (async () => {
      const [err, result] = await croc.exportReceived(state.out);
      // A failed export leaves the files where croc put them, so the receive still
      // succeeded — say what went wrong and keep showing the private path.
      if (err) setState((v) => ({ ...v, saveError: err.message }));
      const where = result?.location ?? null;
      if (where) setState((v) => ({ ...v, savedTo: where }));
      record(where ?? state.out ?? undefined);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // Auto-reconnect a dropped receive: re-attempt the same code a few times with
  // backoff before surfacing the error (the sender re-offers in parallel, so they
  // re-rendezvous on the relay). On the final failure, notify once.
  useEffect(() => {
    if (state.status !== 'error') return;
    const eligible = state.code.trim().length > 0;
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
    setState((v) => (v.reconnecting ? { ...v, reconnecting: false } : v));
    const id = idRef.current;
    if (id && failedNotifiedRef.current !== id) {
      failedNotifiedRef.current = id;
      void notify('Download failed', state.error ?? 'The transfer did not complete.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  function setCode(code: string) {
    setState((v) => ({ ...v, code }));
  }

  // Core connect — spawn `croc receive` for a code. Shared by the initial begin(),
  // the manual retry(), and the automatic respawn(); it never touches the retry
  // budget so those callers stay in control of it.
  async function connect(code: string) {
    const c = code.trim();
    if (!c) return;
    if (idRef.current) croc.cancel(idRef.current);
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({ ...v, code: c, status: 'connecting', progress: null, error: null, fileInfo: null }));

    const prefs = getPrefs();
    // A link can embed connection settings for this transfer only; fall back to prefs.
    const ov = overridesRef.current;
    const [err, result] = await croc.receive(
      c,
      {
        out: prefs.downloadDir || undefined,
        relay: ov?.relay ?? relayArg(prefs),
        autoAccept: prefs.autoAccept,
        local: ov?.local ?? prefs.localMode,
      },
      id
    );
    if (idRef.current !== id) return;
    if (err || !result) {
      setState((v) => ({ ...v, status: 'error', error: err?.message ?? 'Failed to start croc.' }));
      return;
    }
    outRef.current = result.out;
    setState((v) => ({ ...v, out: result.out }));
  }

  async function begin(codeArg?: string, overrides?: ReceiveOverrides) {
    const code = (codeArg ?? state.code).trim();
    if (!code) return;
    clearReconnect();
    autoAttemptRef.current = 0;
    failedNotifiedRef.current = null;
    // Remember the link's settings so retry/auto-reconnect reuse them too.
    overridesRef.current = overrides;
    setState((v) => ({ ...v, reconnecting: false, reconnectAttempt: 0 }));
    await connect(code);
  }

  // The reconnect body (no budget reset) — reuse the code already in state.
  async function respawn() {
    await connect(state.code);
  }

  function respond(yes: boolean) {
    if (idRef.current) croc.respond(idRef.current, yes);
    setState((v) => ({ ...v, prompt: null }));
  }

  // Manual "Try again": reset the auto-reconnect budget, then re-attempt the code
  // the user already typed/scanned. reset() clears it and sends them back to start.
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
    if (idRef.current) croc.cancel(idRef.current);
    idRef.current = null;
    setState((v) => ({ ...INITIAL, code: v.code }));
  }

  function reset() {
    clearReconnect();
    autoAttemptRef.current = 0;
    overridesRef.current = undefined;
    if (idRef.current) croc.cancel(idRef.current);
    idRef.current = null;
    setState(INITIAL);
  }

  return { ...state, setCode, begin, respond, retry, cancel, reset };
}
