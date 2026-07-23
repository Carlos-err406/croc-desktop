import { useEffect, useRef } from 'react';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { getPrefs } from './prefs';

const IN_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Resolve the OS notification permission once (prompts on first use).
let permission: Promise<boolean> | null = null;
function ensurePermission(): Promise<boolean> {
  if (!permission) {
    permission = (async () => {
      try {
        if (await isPermissionGranted()) return true;
        return (await requestPermission()) === 'granted';
      } catch {
        return false;
      }
    })();
  }
  return permission;
}

/** Fire an OS notification, gated by the "notify" pref. */
export async function notify(title: string, body: string): Promise<void> {
  if (!IN_TAURI || !getPrefs().notify) return;
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* ignore */
  }
}

/**
 * Request notification permission up front (at app launch) so the macOS prompt
 * appears once and permission is already granted by the time a transfer finishes.
 * Without this, permission was only ever requested lazily — and never at all when
 * a notification was skipped, so notifications silently never showed.
 */
export function primeNotifications(): void {
  if (IN_TAURI) void ensurePermission();
}

/**
 * Fire a notification once when `status` transitions into 'done' or 'error'.
 * `build` returns the message for a terminal status (or null to skip).
 */
export function useTransferNotification(
  status: string,
  error: string | null,
  build: (status: 'done' | 'error', error: string | null) => { title: string; body: string } | null,
): void {
  const last = useRef<string>('');
  useEffect(() => {
    const prev = last.current;
    last.current = status;
    if (status === prev) return;
    if (status === 'done' || status === 'error') {
      const msg = build(status, error);
      if (msg) void notify(msg.title, msg.body);
    }
    // `build` is intentionally excluded — it's recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, error]);
}
