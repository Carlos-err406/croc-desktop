import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  CrocEvent,
  CrocReceiveResult,
  CrocSendResult,
  HistoryDraft,
  HistoryEntry,
  StatEntry,
} from '@/lib/ipc-types';

// Preserve the Go-style [err, result] tuple the renderer already destructures
// (previously produced by the Electron `$try` wrapper), so useSend/useReceive
// and the screens are unchanged — only the transport swaps to Tauri invoke().
type TryOk<T> = [null, T];
type TryErr = [{ message: string; stack?: string }, null];
type Tuple<T> = Promise<TryOk<T> | TryErr>;

export interface NearbyPeer {
  id: string;
  name: string;
  address: string;
  port: number;
  crocVersion: string | null;
  /** The one-time code this peer is waiting on; null = visible but not accepting. */
  code: string | null;
  isSelf: boolean;
}

export interface CrocInvite {
  code: string;
  qr: string | null;
  deeplink: string;
  link: string;
}

export interface CrocInfo {
  path: string | null;
  version: string | null;
  bundled: boolean;
  expectedVersion: string;
  /** False → a system croc that may be protocol-incompatible with peers on the bundled version. */
  compatible: boolean;
}

/** Outcome of publishing a receive to Downloads. See croc.exportReceived(). */
export interface ExportResult {
  saved: number;
  /** Where the files went ("Download/CrocMobile"), or null if none moved. */
  location: string | null;
}

/** A delivery from Android's share sheet. See croc.takeShared(). */
export interface SharedPayload {
  paths: string[];
  text: string | null;
}

export interface RelayTest {
  address: string;
  reachable: boolean;
  ms: number;
  detail: string;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Tuple<T> {
  try {
    return [null, await invoke<T>(cmd, args)];
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    return [{ message: e.message, stack: e.stack }, null];
  }
}

export const croc = {
  pickPaths: () => call<string[]>('croc_pick_paths'),
  /**
   * Drop the files Android staged in the cache for a send. On Android a picked
   * `content://` URI is copied to a real path croc can open, so the copies must be
   * swept once the transfer is over. No-op on desktop, which sends in place.
   */
  clearStaged: () => call<null>('croc_clear_staged'),
  pickFolders: () => call<string[]>('croc_pick_folders'),
  pickFolder: () => call<string>('croc_pick_folder'),
  defaultDir: () => call<string>('croc_default_dir'),
  /**
   * Where to TELL the user their files go. On Android that's Download/CrocMobile
   * (croc writes to private storage and the files are republished afterwards), so
   * it differs from defaultDir(); everywhere else the two match.
   */
  saveLocation: () => call<string>('croc_save_location'),
  info: () => call<CrocInfo>('croc_info'),
  /** Mint (or reuse) a code + build the "send to me" QR/links (reverse pairing). */
  invite: (code?: string) => call<CrocInvite>('croc_invite', { code }),
  /** Open another window in this instance (parallel transfers). */
  newWindow: () => call<string>('croc_new_window'),
  /** Claim a deep-link URL so only one window acts on it (events broadcast). */
  claimUrl: (url: string) => call<boolean>('croc_claim_url', { url }),
  /** Start browsing for nearby croc devices (browse-only; does not advertise us). */
  nearbyStart: () => call<null>('croc_nearby_start'),
  /** Nearby devices seen so far (self excluded). */
  nearbyPeers: () => call<NearbyPeer[]>('croc_nearby_peers'),
  /** Advertise this device with a one-time code, or pass null to stop. */
  nearbyDiscoverable: (code: string | null) => call<boolean>('croc_nearby_discoverable', { code }),
  updateSize: () => call<number | null>('croc_update_size'),
  statPaths: (paths: string[]) => call<StatEntry[]>('croc_stat_paths', { paths }),
  send: (
    paths: string[],
    transferId?: string,
    relay?: string,
    zip?: boolean,
    code?: string,
    local?: boolean,
  ) => call<CrocSendResult>('croc_send', { paths, transferId, relay, zip, code, local }),
  sendText: (text: string, transferId?: string, relay?: string, code?: string, local?: boolean) =>
    call<CrocSendResult>('croc_send_text', { text, transferId, relay, code, local }),
  receive: (
    code: string,
    opts?: { out?: string; relay?: string; autoAccept?: boolean; local?: boolean },
    transferId?: string,
  ) =>
    call<CrocReceiveResult>('croc_receive', {
      code,
      out: opts?.out,
      relay: opts?.relay,
      transferId,
      autoAccept: opts?.autoAccept,
      local: opts?.local,
    }),
  respond: (transferId: string, yes: boolean) => call<null>('croc_respond', { transferId, yes }),
  relayTest: (relay?: string) => call<RelayTest>('croc_relay_test', { relay }),
  cancel: (transferId: string) => call<null>('croc_cancel', { transferId }),
  showItem: (path: string) => call<null>('croc_show_item', { path }),
  openUrl: (url: string) => call<null>('croc_open_url', { url }),
  /**
   * In-app APK update (Android). The bytes come from the webview because reqwest —
   * and so tauri-plugin-updater — is desktop-only here; see android_install.rs.
   */
  updateDownload: (url: string) => call<null>('croc_update_download', { url }),
  updateProgress: () => call<string>('croc_update_progress'),
  installApk: () => call<null>('croc_install_apk'),
  takeOpenedFiles: () => call<string[]>('croc_take_opened_files'),
  /**
   * Drain Android's share sheet ("Share → Croc Mobile"). Files come back already
   * staged to real paths; `text` is set only when the share carried no files.
   * Always empty on desktop, which has "Open With" instead.
   */
  takeShared: () => call<SharedPayload>('croc_take_shared'),
  /**
   * Publish a finished receive's files to the phone's Downloads folder and drop the
   * private copies. Android only: everything else receives straight into a real
   * folder, so this reports nothing saved and changes nothing.
   */
  exportReceived: (out: string) => call<ExportResult>('croc_export_received', { out }),
  clipboardFiles: () => call<string[]>('croc_clipboard_files'),
  clipboardText: () => call<string | null>('croc_clipboard_text'),
  setProgress: (progress: number | null) =>
    call<null>('croc_set_progress', { progress: progress == null ? null : Math.round(progress) }),
  saveTempFile: (name: string, base64Data: string) =>
    call<string>('croc_save_temp_file', { name, base64Data }),
  historyList: () => call<HistoryEntry[]>('croc_history_list'),
  historyAdd: (draft: HistoryDraft) => call<HistoryEntry[]>('croc_history_add', { draft }),
  historyRemove: (id: string) => call<HistoryEntry[]>('croc_history_remove', { id }),
  historyClear: () => call<HistoryEntry[]>('croc_history_clear'),

  // Backend streams events over the "croc://event" Tauri event; return a sync
  // unsubscribe for the React effect cleanup.
  onEvent: (cb: (e: CrocEvent) => void): (() => void) => {
    const unlisten = listen<CrocEvent>('croc://event', (event) => cb(event.payload));
    return () => {
      void unlisten.then((f) => f());
    };
  },

  // Fired when the OS hands us files to open ("Open With → Croc Desktop") while
  // the app is already running; drain them with takeOpenedFiles().
  onOpenFiles: (cb: () => void): (() => void) => {
    const unlisten = listen('croc://open-files', () => cb());
    return () => {
      void unlisten.then((f) => f());
    };
  },

  // Android's share sheet, while the app is already running. A share that launches
  // the app cold is queued instead, and drained by the same takeShared() on mount.
  onShared: (cb: () => void): (() => void) => {
    const unlisten = listen('croc://shared', () => cb());
    return () => {
      void unlisten.then((f) => f());
    };
  },

  // Drag-drop file paths need Tauri's native onDragDropEvent (Phase 4) — a
  // webview's HTML5 drop yields no filesystem path. The Browse button works.
  pathForFile: (_file: File): string => '',
};

export type {
  CrocEvent,
  CrocSendResult,
  CrocReceiveResult,
  StatEntry,
  HistoryEntry,
  HistoryDraft,
} from '@/lib/ipc-types';
