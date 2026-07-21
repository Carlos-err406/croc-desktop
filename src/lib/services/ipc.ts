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
  onEvent: ipc.onCrocEvent,
  pathForFile: ipc.pathForFile,
};

export type {
  CrocEvent,
  CrocSendResult,
  CrocReceiveResult,
  StatEntry,
} from '@electron/ipc/croc/channels';
