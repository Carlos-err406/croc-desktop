import { useEffect, useState } from 'react';

/** A user-bookmarked transfer code, kept locally for quick reuse ("usual code"). */
export interface SavedCode {
  code: string;
  at: number; // epoch ms, newest first
}

const KEY = 'croc.codes';
const EVT = 'croc-codes-changed';
const MAX = 12;

function read(): SavedCode[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function write(list: SavedCode[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  // Keep every mounted CodePills / field in sync (same window).
  window.dispatchEvent(new Event(EVT));
}

/** Saved codes + save/remove helpers, reactive across components in this window. */
export function useSavedCodes() {
  const [codes, setCodes] = useState<SavedCode[]>(read);
  useEffect(() => {
    const on = () => setCodes(read());
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  const save = (code: string) => {
    const c = code.trim();
    if (c.length < 6) return; // croc's minimum
    const list = read().filter((x) => x.code !== c);
    list.unshift({ code: c, at: Date.now() });
    write(list.slice(0, MAX));
  };
  const remove = (code: string) => write(read().filter((x) => x.code !== code.trim()));
  const has = (code: string) => read().some((x) => x.code === code.trim());

  return { codes, save, remove, has };
}
