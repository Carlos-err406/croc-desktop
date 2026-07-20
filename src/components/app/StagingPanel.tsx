import { useRef, useState } from 'react';
import { File as FileIcon, Plus, Send, X } from 'lucide-react';
import { croc } from '@/lib/services/ipc';
import { basename, pathsFromFileList } from '@/lib/paths';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface StagingPanelProps {
  files: string[];
  onAdd: (paths: string[]) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
  onSend: () => void;
}

export function StagingPanel({ files, onAdd, onRemove, onClear, onSend }: StagingPanelProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  async function browse() {
    const [, paths] = await croc.pickPaths();
    if (paths && paths.length) onAdd(paths);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const paths = pathsFromFileList(e.dataTransfer.files);
    if (paths.length) onAdd(paths);
  }

  return (
    <div
      className="flex flex-1 flex-col gap-4"
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
    >
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden rounded-xl border transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border'
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-medium">
            {files.length} item{files.length === 1 ? '' : 's'} ready to send
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="app-no-drag text-muted-foreground -mr-2 h-7"
            onClick={onClear}
          >
            Clear
          </Button>
        </div>

        <ul className="flex-1 overflow-y-auto p-2">
          {files.map((p) => (
            <li
              key={p}
              className="group hover:bg-secondary/60 flex items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <FileIcon className="text-primary size-4 shrink-0" />
              <span className="truncate text-sm" title={p}>
                {basename(p)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="app-no-drag text-muted-foreground hover:text-destructive ml-auto size-6 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={() => onRemove(p)}
                title="Remove"
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>

        <div className="text-muted-foreground border-t px-4 py-2 text-center text-xs">
          {dragging ? 'Drop to add' : 'Drop more files here, or use Add'}
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="app-no-drag flex-1" onClick={browse}>
          <Plus /> Add files
        </Button>
        <Button className="app-no-drag flex-1" onClick={onSend} disabled={!files.length}>
          <Send /> Send
        </Button>
      </div>
    </div>
  );
}
