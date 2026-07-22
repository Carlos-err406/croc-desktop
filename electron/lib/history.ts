import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HistoryDraft, HistoryEntry } from '../ipc/croc/channels';

// Transfer history is kept in a single JSON file under the app's userData dir,
// newest-first, capped so it can't grow without bound. It never leaves the
// device.
const MAX_ENTRIES = 200;

function historyFile(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

export function listHistory(): HistoryEntry[] {
  try {
    const arr = JSON.parse(fs.readFileSync(historyFile(), 'utf-8'));
    return Array.isArray(arr) ? (arr as HistoryEntry[]) : [];
  } catch {
    return []; // missing/corrupt → empty history
  }
}

export function addHistory(draft: HistoryDraft): HistoryEntry[] {
  const entry: HistoryEntry = { ...draft, id: randomUUID(), at: Date.now() };
  const next = [entry, ...listHistory()].slice(0, MAX_ENTRIES);
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(next));
  } catch {
    /* best-effort; history is non-critical */
  }
  return next;
}

export function clearHistory(): HistoryEntry[] {
  try {
    fs.writeFileSync(historyFile(), '[]');
  } catch {
    /* ignore */
  }
  return [];
}
