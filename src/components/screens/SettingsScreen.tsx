import { useEffect, useState } from 'react';
import { Moon, RefreshCw, RotateCw, Sun } from 'lucide-react';
import { getPrefs, setPrefs, setTheme, type Prefs, type RelayMode, type Theme } from '@/lib/prefs';
import { useUpdater } from '@/lib/updater';
import { abbrevHome } from '@/lib/paths';
import { croc, type CrocInfo } from '@/lib/services/ipc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusChip } from '@/components/ui/status-chip';
import { CrocBadge } from '@/components/CrocLogo';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-border bg-card">
      <div className="px-5 pb-3 pt-4 text-xs font-semibold uppercase tracking-[.06em] text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3.5">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`flex h-[26px] w-[44px] shrink-0 cursor-pointer rounded-full p-[3px] transition-all ${
        on ? 'justify-end bg-brand' : 'justify-start bg-secondary'
      }`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.3)]" />
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded-[7px] px-[13px] py-[7px] text-[13px] font-medium ${
        active ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,.1)]' : 'text-muted-foreground'
      }`}
    >
      {children}
    </div>
  );
}

function RelayChoice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-[9px] border px-3.5 py-2 text-[13px] font-medium ${
        active ? 'border-brand bg-brand-surface text-brand-deep' : 'border-border text-foreground'
      }`}
    >
      {children}
    </div>
  );
}

export function SettingsScreen() {
  const [prefs, setLocal] = useState<Prefs>(() => getPrefs());
  const [defaultDir, setDefaultDir] = useState('');
  const update = (patch: Partial<Prefs>) => setLocal(setPrefs(patch));
  const updater = useUpdater();

  const updateStatus: string = {
    idle: `You're on v${__APP_VERSION__}`,
    checking: 'Checking for updates…',
    uptodate: `You're on the latest version (v${__APP_VERSION__})`,
    available: `Version ${updater.version} is available`,
    downloading: `Downloading update… ${Math.round(updater.progress * 100)}%`,
    ready: `Version ${updater.version} downloaded — restart to apply`,
    error: 'Could not check for updates',
  }[updater.status];

  useEffect(() => {
    if (!prefs.downloadDir) croc.defaultDir().then(([, d]) => d && setDefaultDir(d));
  }, [prefs.downloadDir]);

  const [crocInfo, setCrocInfo] = useState<CrocInfo | null>(null);
  useEffect(() => {
    croc.info().then(([, info]) => info && setCrocInfo(info));
  }, []);
  const crocVersion = crocInfo?.version?.replace(/^croc\s+version\s+/i, '').trim();
  const crocSub = !crocInfo
    ? 'Locating croc…'
    : crocInfo.path
      ? `${crocInfo.bundled ? 'Bundled' : 'System'} croc${crocVersion ? ` · ${crocVersion}` : ''}`
      : 'croc binary not found';

  const chooseFolder = async () => {
    const [, dir] = await croc.pickFolder();
    if (dir) update({ downloadDir: dir });
  };
  const downloadLabel = abbrevHome(prefs.downloadDir || defaultDir || '~/Downloads/Croc');
  const chooseTheme = (t: Theme) => {
    setTheme(t);
    setLocal((p) => ({ ...p, theme: t }));
  };
  const chooseRelay = (r: RelayMode) => update({ relay: r });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-8 pt-[26px]">
        <div className="font-heading text-[26px] font-semibold tracking-[.01em]">Settings</div>
        <div className="mt-[3px] text-[13px] text-muted-foreground">
          Preferences are stored locally on this device.
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-8 pb-8 pt-5">
        <Card title="General">
          <Row title="Download folder" sub="Where received files are saved">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                title={prefs.downloadDir || defaultDir}
                className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-secondary px-[11px] py-[7px] font-mono text-xs"
              >
                {downloadLabel}
              </span>
              <Button variant="outline" size="sm" onClick={chooseFolder}>Choose…</Button>
            </div>
          </Row>
          <Row title="Reveal in folder when done" sub="Open the file location after a transfer completes">
            <Toggle on={prefs.revealOnDone} onClick={() => update({ revealOnDone: !prefs.revealOnDone })} />
          </Row>
          <Row title="Notify when transfers finish" sub="Show a system notification when a send or receive completes and the app is in the background">
            <Toggle on={prefs.notify} onClick={() => update({ notify: !prefs.notify })} />
          </Row>
          <Row title="Auto-accept incoming files" sub="When off, review and approve incoming files (and confirm overwrites) before they download">
            <Toggle on={prefs.autoAccept} onClick={() => update({ autoAccept: !prefs.autoAccept })} />
          </Row>
          <Row title="Bundle folders into one transfer" sub="Much faster for folders with many files — the other side still receives the extracted folder">
            <Toggle on={prefs.zipFolders} onClick={() => update({ zipFolders: !prefs.zipFolders })} />
          </Row>
        </Card>

        <Card title="Network">
          <Row title="Relay" sub="Rendezvous server used to pair devices">
            <div className="flex gap-2">
              <RelayChoice active={prefs.relay === 'default'} onClick={() => chooseRelay('default')}>
                Default (croc.schollz.com)
              </RelayChoice>
              <RelayChoice active={prefs.relay === 'custom'} onClick={() => chooseRelay('custom')}>
                Custom…
              </RelayChoice>
            </div>
          </Row>
          {prefs.relay === 'custom' && (
            <div className="px-5 pb-4">
              <Input
                placeholder="relay.example.com:9009"
                value={prefs.relayCustom}
                onChange={(e) => update({ relayCustom: e.target.value })}
              />
            </div>
          )}
        </Card>

        <Card title="Appearance">
          <Row title="Theme" sub="Match the mood of your desktop">
            <div className="flex gap-[3px] rounded-[9px] bg-secondary p-[3px]">
              <Seg active={prefs.theme === 'light'} onClick={() => chooseTheme('light')}>
                <Sun size={14} /> Light
              </Seg>
              <Seg active={prefs.theme === 'dark'} onClick={() => chooseTheme('dark')}>
                <Moon size={14} /> Dark
              </Seg>
            </div>
          </Row>
        </Card>

        <Card title="Updates">
          <Row title="Automatic updates" sub="Download and install new versions automatically on launch">
            <Toggle on={prefs.autoUpdate} onClick={() => update({ autoUpdate: !prefs.autoUpdate })} />
          </Row>
          <Row title="Software update" sub={updateStatus}>
            {updater.status === 'ready' ? (
              <Button size="sm" onClick={() => void updater.restart()}>
                <RotateCw size={14} /> Restart
              </Button>
            ) : updater.status === 'available' ? (
              <Button size="sm" onClick={() => void updater.install()}>
                Install now
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={updater.status === 'checking' || updater.status === 'downloading'}
                onClick={() => void updater.check({ manual: true })}
              >
                <RefreshCw size={14} className={updater.status === 'checking' ? 'animate-spin' : ''} />
                Check for Updates
              </Button>
            )}
          </Row>
        </Card>

        <div className="flex items-center gap-3.5 rounded-[14px] border border-border bg-card px-5 py-4">
          <CrocBadge size={40} />
          <div>
            <div className="text-sm font-semibold">
              Croc Desktop <span className="font-normal text-muted-foreground">v{__APP_VERSION__}</span>
            </div>
            <div className="mt-px text-xs text-muted-foreground">{crocSub}</div>
          </div>
          <span className="ml-auto">
            {crocInfo && !crocInfo.path ? (
              <StatusChip status="error">croc missing</StatusChip>
            ) : (
              <StatusChip status="success">Ready</StatusChip>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
