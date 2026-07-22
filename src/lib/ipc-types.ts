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
}

/** What the renderer records on completion; id + timestamp are added in Rust. */
export type HistoryDraft = Omit<HistoryEntry, 'id' | 'at'>;

/** Events streamed from the backend to the renderer over "croc://event". */
export type CrocEvent =
  | { transferId: string; type: 'log'; line: string }
  | { transferId: string; type: 'waiting' }
  | { transferId: string; type: 'peer' }
  | { transferId: string; type: 'file-info'; info: CrocFileInfo }
  | { transferId: string; type: 'progress'; progress: CrocProgress }
  | { transferId: string; type: 'text'; text: string }
  | { transferId: string; type: 'done' }
  | { transferId: string; type: 'error'; message: string }
  | { transferId: string; type: 'exit'; code: number };
