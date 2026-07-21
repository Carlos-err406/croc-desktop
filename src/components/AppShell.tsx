import { useState } from 'react';
import { useSend } from '@/lib/useSend';
import { useReceive } from '@/lib/useReceive';
import { Sidebar } from './Sidebar';
import { SendScreen } from './screens/SendScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export type Screen = 'send' | 'receive' | 'history' | 'settings';

export function AppShell() {
  const [screen, setScreen] = useState<Screen>('send');
  const send = useSend();
  const recv = useReceive();

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        background: 'var(--background)',
        color: 'var(--foreground)',
      }}
    >
      <Sidebar screen={screen} onNavigate={setScreen} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {screen === 'send' && <SendScreen send={send} onViewHistory={() => setScreen('history')} />}
        {screen === 'receive' && <ReceiveScreen recv={recv} />}
        {screen === 'history' && <HistoryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </div>
    </div>
  );
}
