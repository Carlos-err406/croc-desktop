import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getPrefs } from './prefs';

export type UpdateStatus =
  | 'idle' // not checked / nothing to show
  | 'checking'
  | 'available' // found, awaiting user (manual mode)
  | 'downloading'
  | 'ready' // installed, needs restart
  | 'uptodate'
  | 'error';

interface UpdaterCtx {
  status: UpdateStatus;
  version: string | null; // the available / installed update version
  progress: number; // 0..1 while downloading
  error: string | null;
  check: (opts?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
}

const Ctx = createContext<UpdaterCtx | null>(null);

export function useUpdater(): UpdaterCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUpdater must be used within <UpdaterProvider>');
  return c;
}

// The updater only works inside the Tauri runtime (desktop). In a plain browser
// (e.g. `vite preview`) the plugin calls throw, so we no-op there.
const IN_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const started = useRef(false);

  const install = async () => {
    const update = updateRef.current;
    if (!update) return;
    try {
      setStatus('downloading');
      setProgress(0);
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress') {
          received += e.data.chunkLength;
          setProgress(total ? Math.min(1, received / total) : 0);
        } else if (e.event === 'Finished') setProgress(1);
      });
      setStatus('ready');
    } catch (err) {
      setError(String(err));
      setStatus('error');
    }
  };

  const runCheck = async (opts?: { manual?: boolean }) => {
    if (!IN_TAURI) {
      if (opts?.manual) setStatus('uptodate');
      return;
    }
    try {
      setError(null);
      setStatus('checking');
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        if (getPrefs().autoUpdate) await install();
        else setStatus('available');
      } else {
        setStatus('uptodate');
      }
    } catch (err) {
      setError(String(err));
      setStatus('error');
    }
  };

  const restart = async () => {
    if (IN_TAURI) await relaunch();
  };

  const dismiss = () =>
    setStatus((s) => (s === 'available' || s === 'uptodate' || s === 'error' ? 'idle' : s));

  // Silent check once on launch (auto-installs if the pref is on).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider
      value={{ status, version, progress, error, check: runCheck, install, restart, dismiss }}
    >
      {children}
    </Ctx.Provider>
  );
}
