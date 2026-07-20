import { croc } from '@/lib/services/ipc';

/** Resolve a dropped FileList to absolute paths (webUtils, with a legacy fallback). */
export function pathsFromFileList(list: FileList): string[] {
  return Array.from(list)
    .map((f) => croc.pathForFile(f) || (f as File & { path?: string }).path || '')
    .filter(Boolean);
}

export const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
