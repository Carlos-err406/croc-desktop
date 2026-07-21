import { useState } from 'react';
import { useSend } from '@/lib/useSend';
import { Sidebar } from './Sidebar';
import { SendScreen } from './screens/SendScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export type Screen = 'send' | 'receive' | 'history' | 'settings';

export function AppShell() {
  const [screen, setScreen] = useState<Screen>('send');
  const send = useSend();

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
        {screen === 'receive' && <ReceiveScreen />}
        {screen === 'history' && <HistoryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </div>
    </div>
  );
}
