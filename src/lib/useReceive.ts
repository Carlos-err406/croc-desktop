import { useEffect, useRef, useState } from 'react';
import type { CrocFileInfo, CrocProgress, CrocPrompt } from '@/lib/ipc-types';
import { croc, type CrocEvent } from '@/lib/services/ipc';
import { getPrefs, relayArg } from '@/lib/prefs';
import { notify, useTransferNotification } from '@/lib/notify';

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
  logLines: string[];
  prompt: CrocPrompt | null; // pending accept/overwrite prompt awaiting the user
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
  logLines: [],
  prompt: null,
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
      };
    }
    case 'text':
      return { ...v, isText: true, text: e.text };
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

export interface UseReceive extends ReceiveState {
  setCode: (code: string) => void;
  begin: (codeArg?: string) => Promise<void>;
  respond: (yes: boolean) => void;
  cancel: () => void;
  reset: () => void;
}

export function useReceive(): UseReceive {
  const [state, setState] = useState<ReceiveState>(INITIAL);
  const idRef = useRef<string | null>(null);
  const outRef = useRef('');
  const recordedRef = useRef<string | null>(null);

  // Fire the completion notification from the hook (always mounted) rather than
  // the Receive screen, so it shows even if the user navigated away.
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
      : { title: 'Download failed', body: state.error ?? 'The transfer did not complete.' },
  );

  useEffect(() => {
    const unsub = croc.onEvent((e: CrocEvent) => {
      if (e.transferId !== idRef.current) return;
      // Reveal the download folder on completion, if enabled.
      if ((e.type === 'done' || (e.type === 'exit' && e.code === 0)) && getPrefs().revealOnDone && outRef.current) {
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

  // Record a completed receive in the local history, once per transfer.
  useEffect(() => {
    if (state.status !== 'done') return;
    const id = idRef.current;
    if (!id || recordedRef.current === id) return;
    recordedRef.current = id;
    croc.historyAdd({
      kind: 'receive',
      names: state.isText ? ['Text message'] : state.perFile.map((f) => f.name),
      count: state.isText ? 1 : Math.max(state.perFile.length, state.totalFiles > 1 ? state.totalFiles : 1),
      sizeHuman: state.progress?.totalHuman ?? undefined,
      out: state.out || undefined,
      isText: state.isText || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  function setCode(code: string) {
    setState((v) => ({ ...v, code }));
  }

  async function begin(codeArg?: string) {
    const code = (codeArg ?? state.code).trim();
    if (!code) return;
    const id = crypto.randomUUID();
    idRef.current = id;
    setState((v) => ({ ...v, code, status: 'connecting', progress: null, error: null, fileInfo: null }));

    const prefs = getPrefs();
    const [err, result] = await croc.receive(
      code,
      { out: prefs.downloadDir || undefined, relay: relayArg(prefs), autoAccept: prefs.autoAccept },
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

  function respond(yes: boolean) {
    if (idRef.current) croc.respond(idRef.current, yes);
    setState((v) => ({ ...v, prompt: null }));
  }

  function cancel() {
    if (idRef.current) croc.cancel(idRef.current);
    idRef.current = null;
    setState((v) => ({ ...INITIAL, code: v.code }));
  }

  function reset() {
    if (idRef.current) croc.cancel(idRef.current);
    idRef.current = null;
    setState(INITIAL);
  }

  return { ...state, setCode, begin, respond, cancel, reset };
}
