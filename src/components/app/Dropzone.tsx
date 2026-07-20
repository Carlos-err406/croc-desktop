import { useRef, useState } from 'react';
import { FolderUp, Upload } from 'lucide-react';
import { croc } from '@/lib/services/ipc';
import { pathsFromFileList } from '@/lib/paths';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface DropzoneProps {
  onFiles: (paths: string[]) => void;
}

export function Dropzone({ onFiles }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0); // track nested dragenter/leave

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const paths = pathsFromFileList(e.dataTransfer.files);
    if (paths.length) onFiles(paths);
  }

  async function browse() {
    const [, paths] = await croc.pickPaths();
    if (paths && paths.length) onFiles(paths);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={browse}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && browse()}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) setDragging(false);
      }}
      onDrop={handleDrop}
      className={cn(
        'group flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all outline-none',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        dragging
          ? 'border-primary bg-primary/10 scale-[1.01]'
          : 'border-border bg-card/40 hover:border-primary/60 hover:bg-card'
      )}
    >
      <div
        className={cn(
          'flex size-16 items-center justify-center rounded-full transition-colors',
          dragging ? 'bg-primary/20 text-primary' : 'bg-secondary text-primary'
        )}
      >
        {dragging ? <FolderUp className="size-7" /> : <Upload className="size-7" />}
      </div>
      <p className="mt-4 text-base font-semibold">Drop files or a folder to send</p>
      <p className="text-muted-foreground mt-1 text-sm">Encrypted, peer-to-peer, no account</p>
      <Button
        variant="secondary"
        size="sm"
        className="app-no-drag mt-5"
        onClick={(e) => {
          e.stopPropagation();
          browse();
        }}
      >
        Browse…
      </Button>
    </div>
  );
}
