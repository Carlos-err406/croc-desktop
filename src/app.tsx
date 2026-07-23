import { AppShell } from '@/components/AppShell';
import { UpdaterProvider } from '@/lib/updater';

export default function App() {
  return (
    <UpdaterProvider>
      <AppShell />
    </UpdaterProvider>
  );
}
