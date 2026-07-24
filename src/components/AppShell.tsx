import { useEffect, useState } from 'react';
import { primeNotifications } from '@/lib/notify';
import { useSend } from '@/lib/useSend';
import { useReceive } from '@/lib/useReceive';
import { Sidebar } from './Sidebar';
import { SendScreen } from './screens/SendScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { UpdateBanner } from './UpdateBanner';

export type Screen = 'send' | 'receive' | 'history' | 'settings';

export function AppShell() {
  const [screen, setScreen] = useState<Screen>('send');
  const send = useSend();
  const recv = useReceive();

  // Ask for notification permission at launch so it's ready before any transfer.
  useEffect(() => {
    primeNotifications();
  }, []);

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
        </div>
      </div>
    </div>
  );
}
