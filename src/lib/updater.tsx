import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { croc } from './services/ipc';
import { getPrefs } from './prefs';
import { IS_MOBILE } from './platform';
import { checkAndroidUpdate, type AndroidUpdate } from './androidUpdate';

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
  totalBytes: number | null; // download size, if known (prefetched, or from the download)
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
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const androidRef = useRef<AndroidUpdate | null>(null);
  const started = useRef(false);

  const install = async () => {
    // Android has no in-app install: hand the APK to the browser, which downloads
    // it and lets Android's package installer do the rest. Status stays 'available'
    // — nothing has been installed yet, and claiming otherwise would be a lie.
    if (IS_MOBILE) {
      const target = androidRef.current;
      if (target) await croc.openUrl(target.apkUrl);
      return;
    }
    const update = updateRef.current;
    if (!update) return;
    try {
      setStatus('downloading');
      setProgress(0);
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') {
          total = e.data.contentLength ?? 0;
          if (total) setTotalBytes(total); // authoritative once the download starts
        } else if (e.event === 'Progress') {
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
    // tauri_plugin_updater is registered under #[cfg(desktop)], so calling check()
    // here would throw "plugin not found" on Android. Read the GitHub release
    // instead — same information, no plugin. See androidUpdate.ts.
    if (IS_MOBILE) {
      try {
        setError(null);
        setStatus('checking');
        const found = await checkAndroidUpdate(__APP_VERSION__);
        androidRef.current = found;
        if (found) {
          setVersion(found.version);
          setStatus('available'); // never auto-installs: Android always confirms
        } else {
          setStatus('uptodate');
        }
      } catch (err) {
        // "Couldn't check" — NOT 'uptodate', which would be the same screen as a
        // successful check and would quietly hide every future release.
        setError(String(err));
        setStatus('error');
      }
      return;
    }
    try {
      setError(null);
      setStatus('checking');
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        // Best-effort: learn the download size so the "available" prompt can show it
        // (the actual download later confirms it via contentLength).
        void croc.updateSize().then(([, size]) => size && setTotalBytes(size));
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
      value={{ status, version, progress, totalBytes, error, check: runCheck, install, restart, dismiss }}
    >
      {children}
    </Ctx.Provider>
  );
}
