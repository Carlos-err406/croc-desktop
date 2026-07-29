import { useEffect, useRef, useState } from 'react';
import { getCurrent as getCurrentDeepLink, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { primeNotifications } from '@/lib/notify';
import { croc } from '@/lib/services/ipc';
import { useSend } from '@/lib/useSend';
import { useReceive } from '@/lib/useReceive';
import { Sidebar } from './Sidebar';
import { BottomTabs } from './BottomTabs';
import { SendScreen } from './screens/SendScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AboutScreen } from './screens/AboutScreen';
import { UpdateBanner } from './UpdateBanner';
import { CrocCompatBanner } from './CrocCompatBanner';
import { parseReceiveTarget } from '@/lib/deeplink';
import { IS_ANDROID } from '@/lib/platform';

export type Screen = 'send' | 'receive' | 'history' | 'settings' | 'about';

export function AppShell() {
  const [screen, setScreen] = useState<Screen>('send');
  const send = useSend();
  const recv = useReceive();

  // Ask for notification permission at launch so it's ready before any transfer.
  useEffect(() => {
    primeNotifications();
  }, []);

  // "Open With → Croc Desktop" (or files dropped on the dock icon): stage them to
  // send. Drain on launch (cold open) and whenever the OS pings while running.
  useEffect(() => {
    const drainAndStage = async () => {
      const [, paths] = await croc.takeOpenedFiles();
      if (paths && paths.length) {
        void send.stage(paths);
        setScreen('send');
      }
    };
    void drainAndStage();
    const unsub = croc.onOpenFiles(() => void drainAndStage());
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android's share sheet — the phone's answer to "Open With". Files arrive already
  // staged to real paths; a share with no files (a link, a snippet) fills the text
  // box instead. Same two cases as above: cold launch drains the queue, a share
  // while running arrives as an event.
  useEffect(() => {
    if (!IS_ANDROID) return;
    const drainShared = async () => {
      const [err, shared] = await croc.takeShared();
      if (err) {
        // Staging a share can fail the same way a pick can (no space, an
        // unreadable provider); say so rather than appearing to ignore the share.
        send.fail(err.message);
        setScreen('send');
        return;
      }
      if (!shared) return;
      if (shared.paths.length) {
        void send.stage(shared.paths);
        setScreen('send');
      } else if (shared.text) {
        send.setPresetText(shared.text);
        setScreen('send');
      }
    };
    void drainShared();
    return croc.onShared(() => void drainShared());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links: a croc:// link (or scanned QR of one) opens the app and starts
  // receiving that code. Handles cold launch (getCurrent) and while-running.
  useEffect(() => {
    const handleUrls = async (urls: string[] | null) => {
      for (const u of urls ?? []) {
        // Only croc:// links open the app while running (the OS routes them here).
        if (!u.startsWith('croc://')) continue;
        const target = parseReceiveTarget(u);
        if (!target) continue;
        // Deep links broadcast to EVERY window; claim so exactly one acts on it
        // (two windows receiving the same code would collide — croc rooms are 1:1).
        const [, mine] = await croc.claimUrl(u);
        if (mine === false) break;
        if (target.action === 'send') {
          // Reverse pairing: they published "send to me with this code". Land on
          // Send with the code pre-filled; the user picks files and hits send.
          send.setPresetCode(target.code);
          setScreen('send');
        } else {
          recv.setCode(target.code);
          setScreen('receive');
          // Apply any connection settings the sender embedded for this receive.
          void recv.begin(target.code, { local: target.local, relay: target.relay });
        }
        break;
      }
    };
    getCurrentDeepLink()
      .then((u) => void handleUrls(u))
      .catch(() => {});
    let unsub: (() => void) | undefined;
    onOpenUrl((urls) => void handleUrls(urls))
      .then((f) => (unsub = f))
      .catch(() => {});
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the active transfer's progress onto the OS Dock/taskbar. Determinate
  // during byte transfer; cleared otherwise. Deduped so we only cross to the
  // backend when the rounded percent actually changes.
  const lastProgress = useRef<number | null>(null);
  useEffect(() => {
    let value: number | null = null;
    if (recv.status === 'receiving') {
      value = recv.perFile.length
        ? Math.min(
            100,
            Math.round(
              recv.perFile.reduce((a, f) => a + f.percent, 0) / Math.max(1, recv.totalFiles),
            ),
          )
        : (recv.progress?.percent ?? 0);
    } else if (send.status === 'transferring') {
      value = send.progress?.percent ?? 0;
    }
    if (value !== lastProgress.current) {
      lastProgress.current = value;
      void croc.setProgress(value);
    }
  }, [recv.status, recv.perFile, recv.totalFiles, recv.progress, send.status, send.progress]);

  return (
    // Column on a phone (canvas above the tab bar), row on desktop (sidebar beside
    // the canvas). One breakpoint drives both, so a narrow desktop window behaves
    // like a phone with no JS involved.
    <div className="flex h-full flex-col bg-background text-foreground md:flex-row">
      <Sidebar screen={screen} onNavigate={setScreen} />
      <div className="croc-canvas flex min-h-0 min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
        <UpdateBanner />
        <CrocCompatBanner />
        {/* Keyed so the screen re-plays its entrance on each navigation.
            min-h-0 lets inner overflow-y-auto regions (e.g. Settings) scroll. */}
        <div key={screen} className="croc-screen flex min-h-0 min-w-0 flex-1 flex-col">
          {screen === 'send' && (
            <SendScreen send={send} onViewHistory={() => setScreen('history')} />
          )}
          {screen === 'receive' && <ReceiveScreen recv={recv} />}
          {screen === 'history' && (
            <HistoryScreen
              onResend={(paths, code) => {
                void send.stage(paths, code);
                setScreen('send');
              }}
            />
          )}
          {screen === 'settings' && <SettingsScreen />}
          {screen === 'about' && <AboutScreen />}
        </div>
      </div>
      <BottomTabs screen={screen} onNavigate={setScreen} />
    </div>
  );
}
