import type { CrocProgress, CrocFileInfo } from '@electron/lib/croc';

export const CROC_PICK_PATHS = 'croc:pick-paths';
export const CROC_PICK_FOLDER = 'croc:pick-folder';
export const CROC_DEFAULT_DIR = 'croc:default-dir';
export const CROC_STAT_PATHS = 'croc:stat-paths';
export const CROC_SEND = 'croc:send';
export const CROC_RECEIVE = 'croc:receive';
export const CROC_CANCEL = 'croc:cancel';
export const CROC_SHOW_ITEM = 'croc:show-item';
export const CROC_SHARE = 'croc:share';
export const CROC_HISTORY_LIST = 'croc:history-list';
export const CROC_HISTORY_ADD = 'croc:history-add';
export const CROC_HISTORY_CLEAR = 'croc:history-clear';
export const CROC_EVENT = 'croc:event'; // main -> renderer progress stream

export interface ShareResult {
  shown: boolean; // true if the OS share UI opened (macOS); false where unsupported
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

/** What the renderer records on completion; id + timestamp are added in main. */
export type HistoryDraft = Omit<HistoryEntry, 'id' | 'at'>;

export interface CrocReceiveResult {
  transferId: string;
  out: string;
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

/** Events streamed from main to the renderer over CROC_EVENT. */
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
