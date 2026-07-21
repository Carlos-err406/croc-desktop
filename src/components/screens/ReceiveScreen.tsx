import { useState } from 'react';
import { Download, Folder, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const HEADING = 'var(--font-heading)';

export function ReceiveScreen() {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState(false);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '26px 32px 0' }}>
        <div style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 600, letterSpacing: '.01em' }}>
          Receive files
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 3 }}>
          Get files someone is sending you.
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 32px 32px' }}>
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--brand-surface)', color: 'var(--brand-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <Download size={30} />
          </div>
          <div style={{ fontFamily: HEADING, fontSize: 22, fontWeight: 600 }}>Enter the transfer code</div>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', maxWidth: 340 }}>
            Type the code the sender shared with you — or scan their QR with this device's camera.
          </div>

          <div style={{ width: '100%', marginTop: 18, textAlign: 'left' }}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 7431-mirage-oxford"
              className="h-12 text-base"
              autoFocus
            />
          </div>
          <div style={{ width: '100%', marginTop: 12 }}>
            <Button className="h-11 w-full" onClick={() => setNotice(true)}>
              Receive files
            </Button>
          </div>

          {notice && (
            <div style={{ fontSize: 12, color: 'var(--warning-text)', background: 'var(--warning-surface)', borderRadius: 10, padding: '8px 12px', marginTop: 4 }}>
              Receiving is wired up in the next update — sending works today.
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, color: 'var(--muted-foreground)', fontSize: 12 }}>
            <span style={{ width: 44, height: 1, background: 'var(--border)' }} />
            or
            <span style={{ width: 44, height: 1, background: 'var(--border)' }} />
          </div>
          <button
            onClick={() => setNotice(true)}
            style={{ font: 'inherit', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: 'var(--brand-deep)', background: 'var(--brand-surface)', border: 'none', borderRadius: 999, padding: '9px 16px', cursor: 'pointer', marginTop: 4 }}
          >
            <QrCode size={15} /> Scan a QR code
          </button>

          <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Folder size={13} /> Saving to{' '}
            <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>~/Downloads/Croc</span>
          </div>
        </div>
      </div>
    </div>
  );
}
