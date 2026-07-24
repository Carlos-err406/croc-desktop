// DTOs shared between the Rust backend (serde, camelCase) and the React UI.
// These mirror the structs in src-tauri/src/croc.rs / history.rs and the events
// emitted over the "croc://event" Tauri event.

export interface CrocProgress {
  percent: number; // per-file percent (croc reports one bar per file)
  transferredHuman?: string | null;
  totalHuman?: string | null;
  speedHuman?: string | null;
  etaHuman?: string | null;
  file?: string | null; // filename this progress line is for
  index?: number | null; // N in the trailing "N/M" (files completed so far)
  count?: number | null; // M in the trailing "N/M" (total files)
}

export interface CrocFileInfo {
  name: string;
  totalHuman: string;
  count?: number; // set when croc reports "N files" (a batch), else a single file
  isText?: boolean; // true when croc is transferring a `--text` message, not files
}

export interface StatEntry {
  path: string;
  name: string;
  size: number; // bytes (0 for folders)
  sizeHuman: string;
  type: string; // short extension badge, e.g. PDF / ZIP / DIR
  isDir: boolean;
  exists: boolean; // false if the path no longer exists (e.g. a re-staged history path)
}

export interface ReceiveCommand {
  code: string;
  posix: string;
  interactive: string;
}

export interface CrocSendResult {
  transferId: string;
  code: string;
  qr: string | null;
  receiveCommand: ReceiveCommand;
}

export interface CrocReceiveResult {
  transferId: string;
  out: string;
}

/** One completed transfer, persisted locally (newest first). */
export interface HistoryEntry {
  id: string;
  kind: 'send' | 'receive';
  at: number; // epoch ms
  names: string[]; // file names (["Text message"] for a text transfer)
  count: number; // number of files
  sizeHuman?: string; // total size, when known
  code?: string; // transfer code (sends)
  out?: string; // destination folder (receives)
  isText?: boolean; // a `croc send --text` message
  paths?: string[]; // source paths for a file send, so it can be re-sent
}

/** What the renderer records on completion; id + timestamp are added in Rust. */
export type HistoryDraft = Omit<HistoryEntry, 'id' | 'at'>;

/** An interactive croc prompt awaiting a yes/no answer (via croc_respond). */
export interface CrocPrompt {
  kind: 'accept' | 'overwrite' | 'resume' | 'confirm';
  fname?: string; // accept: what's incoming ("3 files" or a single name)
  size?: string; // accept: total size, human
  file?: string; // overwrite/resume: the conflicting file
  percent?: number; // resume: how far the partial file got
  message?: string; // confirm: raw prompt text for anything unmodeled
  defaultYes: boolean; // true = (Y/n), false = (y/N)
}

/** Events streamed from the backend to the renderer over "croc://event". */
export type CrocEvent =
  | { transferId: string; type: 'log'; line: string }
  | { transferId: string; type: 'waiting' }
  | { transferId: string; type: 'peer' }
  | { transferId: string; type: 'file-info'; info: CrocFileInfo }
  | { transferId: string; type: 'progress'; progress: CrocProgress }
  | { transferId: string; type: 'text'; text: string }
  | ({ transferId: string; type: 'prompt' } & CrocPrompt)
  | { transferId: string; type: 'done' }
  | { transferId: string; type: 'error'; message: string }
  | { transferId: string; type: 'exit'; code: number };
