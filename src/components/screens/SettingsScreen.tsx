import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getPrefs, setPrefs, setTheme, type Prefs, type RelayMode, type Theme } from '@/lib/prefs';
import { abbrevHome } from '@/lib/paths';
import { croc } from '@/lib/services/ipc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusChip } from '@/components/ui/status-chip';
import { CrocBadge } from '@/components/CrocLogo';

const HEADING = 'var(--font-heading)';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--card)' }}>
      <div style={{ padding: '16px 20px 12px', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        padding: 3,
        cursor: 'pointer',
        flexShrink: 0,
        display: 'flex',
        background: on ? 'var(--brand)' : 'var(--secondary)',
        justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'all .15s',
      }}
    >
      <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 500,
        padding: '7px 13px',
        borderRadius: 7,
        cursor: 'pointer',
        background: active ? 'var(--card)' : 'transparent',
        color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
      }}
    >
      {children}
    </div>
  );
}

function RelayChoice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      style={{
        fontSize: 13,
        fontWeight: 500,
        padding: '8px 14px',
        borderRadius: 9,
        cursor: 'pointer',
        border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
        background: active ? 'var(--brand-surface)' : 'transparent',
        color: active ? 'var(--brand-deep)' : 'var(--foreground)',
      }}
    >
      {children}
    </div>
  );
}

export function SettingsScreen() {
  const [prefs, setLocal] = useState<Prefs>(() => getPrefs());
  const [defaultDir, setDefaultDir] = useState('');
  const update = (patch: Partial<Prefs>) => setLocal(setPrefs(patch));

  useEffect(() => {
    if (!prefs.downloadDir) croc.defaultDir().then(([, d]) => d && setDefaultDir(d));
  }, [prefs.downloadDir]);

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '26px 32px 0' }}>
        <div style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 600, letterSpacing: '.01em' }}>Settings</div>
        <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 3 }}>
          Preferences are stored locally on this device.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="General">
          <Row title="Download folder" sub="Where received files are saved">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span
                title={prefs.downloadDir || defaultDir}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--secondary)', borderRadius: 8, padding: '7px 11px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {downloadLabel}
              </span>
              <Button variant="outline" size="sm" onClick={chooseFolder}>Choose…</Button>
            </div>
          </Row>
          <Row title="Reveal in folder when done" sub="Open the file location after a transfer completes">
            <Toggle on={prefs.revealOnDone} onClick={() => update({ revealOnDone: !prefs.revealOnDone })} />
          </Row>
        </Card>

        <Card title="Network">
          <Row title="Relay" sub="Rendezvous server used to pair devices">
            <div style={{ display: 'flex', gap: 8 }}>
              <RelayChoice active={prefs.relay === 'default'} onClick={() => chooseRelay('default')}>
                Default (croc.schollz.com)
              </RelayChoice>
              <RelayChoice active={prefs.relay === 'custom'} onClick={() => chooseRelay('custom')}>
                Custom…
              </RelayChoice>
            </div>
          </Row>
          {prefs.relay === 'custom' && (
            <div style={{ padding: '0 20px 16px' }}>
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
            <div style={{ display: 'flex', background: 'var(--secondary)', borderRadius: 9, padding: 3, gap: 3 }}>
              <Seg active={prefs.theme === 'light'} onClick={() => chooseTheme('light')}>
                <Sun size={14} /> Light
              </Seg>
              <Seg active={prefs.theme === 'dark'} onClick={() => chooseTheme('dark')}>
                <Moon size={14} /> Dark
              </Seg>
            </div>
          </Row>
        </Card>

        <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--card)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <CrocBadge size={40} mark={30} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Croc Desktop <span style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>v0.1</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 1 }}>
              Using the croc binary from your PATH
            </div>
          </div>
          <span style={{ marginLeft: 'auto' }}>
            <StatusChip status="success">Ready</StatusChip>
          </span>
        </div>
      </div>
    </div>
  );
}
