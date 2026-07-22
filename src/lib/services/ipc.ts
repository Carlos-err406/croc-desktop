import {
  CROC_CANCEL,
  CROC_DEFAULT_DIR,
  CROC_PICK_FOLDER,
  CROC_PICK_PATHS,
  CROC_RECEIVE,
  CROC_SEND,
  CROC_SHARE,
  CROC_SHOW_ITEM,
  CROC_STAT_PATHS,
  CROC_HISTORY_LIST,
  CROC_HISTORY_ADD,
  CROC_HISTORY_CLEAR,
} from '@electron/ipc/croc/channels';

const ipc = window.ipc;

export const croc = {
  pickPaths: ipc[CROC_PICK_PATHS],
  pickFolder: ipc[CROC_PICK_FOLDER],
  defaultDir: ipc[CROC_DEFAULT_DIR],
  statPaths: ipc[CROC_STAT_PATHS],
  send: ipc[CROC_SEND],
  receive: ipc[CROC_RECEIVE],
  cancel: ipc[CROC_CANCEL],
  showItem: ipc[CROC_SHOW_ITEM],
  share: ipc[CROC_SHARE],
  historyList: ipc[CROC_HISTORY_LIST],
  historyAdd: ipc[CROC_HISTORY_ADD],
  historyClear: ipc[CROC_HISTORY_CLEAR],
  onEvent: ipc.onCrocEvent,
  pathForFile: ipc.pathForFile,
};

export type {
  CrocEvent,
  CrocSendResult,
  CrocReceiveResult,
  StatEntry,
  HistoryEntry,
  HistoryDraft,
} from '@electron/ipc/croc/channels';
