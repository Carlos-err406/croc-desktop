import { useEffect, useState } from 'react';
import { ExternalLink, Github, Lock } from 'lucide-react';
import { croc, type CrocInfo } from '@/lib/services/ipc';
import { Button } from '@/components/ui/button';
import { CrocBadge } from '@/components/CrocLogo';

const REPO_URL = 'https://github.com/Carlos-err406/croc-desktop';
const CROC_URL = 'https://github.com/schollz/croc';

export function AboutScreen() {
  const [info, setInfo] = useState<CrocInfo | null>(null);
  useEffect(() => {
    croc.info().then(([, i]) => i && setInfo(i));
  }, []);
  const crocVersion = info?.version?.replace(/^croc\s+version\s+/i, '').trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-8 pt-[26px]">
        <div className="font-heading text-[26px] font-semibold tracking-[.01em]">About</div>
        <div className="mt-[3px] text-[13px] text-muted-foreground">
          Croc Desktop and the tools it's built on.
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <CrocBadge size={72} className="shadow-[0_12px_30px_-10px_rgba(30,80,40,.35)]" />
          <div>
            <div className="font-heading text-[22px] font-semibold">Croc Desktop</div>
            <div className="mt-1 text-[13px] text-muted-foreground">
              Version {__APP_VERSION__}
              {crocVersion ? `  ·  croc ${crocVersion}` : ''}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Built {new Date(__BUILD_TIME__).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </div>
          </div>
          <p className="max-w-[380px] text-[13px] leading-relaxed text-muted-foreground">
            A friendly desktop app for <span className="font-medium text-foreground">croc</span> — send files
            and text to any device with a one-time code, encrypted end-to-end, peer-to-peer.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <Button onClick={() => croc.openUrl(REPO_URL)}>
            <Github size={16} /> View on GitHub
          </Button>
          <Button variant="outline" onClick={() => croc.openUrl(CROC_URL)}>
            <ExternalLink size={15} /> Built on schollz/croc
          </Button>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} className="text-success-text" /> End-to-end encrypted · nothing stored in the cloud
        </div>
      </div>
    </div>
  );
}
