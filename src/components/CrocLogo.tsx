import { cn } from '@/lib/utils';
import crocLogo from '@/assets/croc-logo.svg';

/**
 * The croc brand mark — the same art (src/assets/croc-logo.svg) that becomes the
 * macOS/Windows/Linux app icon, so the in-app logo matches the installed icon.
 * The SVG is a white square with the green croc; rounding the <img> clips it
 * into the app-icon tile. Pass `className` to override the default shadow.
 */
export function CrocBadge({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <img
      src={crocLogo}
      alt=""
      draggable={false}
      className={cn('block shrink-0 shadow-[0_2px_8px_-3px_rgba(30,80,40,.4)]', className)}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    />
  );
}
