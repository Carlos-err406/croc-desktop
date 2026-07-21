import {
  CROC_CANCEL,
  CROC_PICK_PATHS,
  CROC_SEND,
  CROC_SHOW_ITEM,
  CROC_STAT_PATHS,
} from '@electron/ipc/croc/channels';

const ipc = window.ipc;

export const croc = {
  pickPaths: ipc[CROC_PICK_PATHS],
  statPaths: ipc[CROC_STAT_PATHS],
  send: ipc[CROC_SEND],
  cancel: ipc[CROC_CANCEL],
  showItem: ipc[CROC_SHOW_ITEM],
  onEvent: ipc.onCrocEvent,
  pathForFile: ipc.pathForFile,
};

export type { CrocEvent, CrocSendResult, StatEntry } from '@electron/ipc/croc/channels';
