import { useEffect, useRef, useState } from 'react';
import { primeNotifications } from '@/lib/notify';
import { croc } from '@/lib/services/ipc';
import { useSend } from '@/lib/useSend';
import { useReceive } from '@/lib/useReceive';
import { Sidebar } from './Sidebar';
import { SendScreen } from './screens/SendScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AboutScreen } from './screens/AboutScreen';
import { UpdateBanner } from './UpdateBanner';

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

  // Mirror the active transfer's progress onto the OS Dock/taskbar. Determinate
  // during byte transfer; cleared otherwise. Deduped so we only cross to the
  // backend when the rounded percent actually changes.
  const lastProgress = useRef<number | null>(null);
  useEffect(() => {
    let value: number | null = null;
    if (recv.status === 'receiving') {
      value = recv.perFile.length
        ? Math.min(100, Math.round(recv.perFile.reduce((a, f) => a + f.percent, 0) / Math.max(1, recv.totalFiles)))
        : (recv.progress?.percent ?? 0);
    } else if (send.status === 'transferring') {
      value = send.progress?.percent ?? 0;
    }
    if (value !== lastProgress.current) {
      lastProgress.current = value;
      void croc.setProgress(value);
    }
  }, [
    recv.status,
    recv.perFile,
    recv.totalFiles,
    recv.progress,
    send.status,
    send.progress,
  ]);

  return (
    <div className="flex h-full bg-background text-foreground">
      <Sidebar screen={screen} onNavigate={setScreen} />
      <div className="croc-canvas flex min-h-0 min-w-0 flex-1 flex-col">
        <UpdateBanner />
        {/* Keyed so the screen re-plays its entrance on each navigation.
            min-h-0 lets inner overflow-y-auto regions (e.g. Settings) scroll. */}
        <div key={screen} className="croc-screen flex min-h-0 min-w-0 flex-1 flex-col">
          {screen === 'send' && <SendScreen send={send} onViewHistory={() => setScreen('history')} />}
          {screen === 'receive' && <ReceiveScreen recv={recv} />}
          {screen === 'history' && (
            <HistoryScreen
              onResend={(paths) => {
                void send.stage(paths);
                setScreen('send');
              }}
            />
          )}
          {screen === 'settings' && <SettingsScreen />}
          {screen === 'about' && <AboutScreen />}
        </div>
      </div>
    </div>
  );
}
