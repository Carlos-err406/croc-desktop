import { cn } from '@/lib/utils';
import crocIcon from '@/assets/croc-icon.png';

/**
 * The croc brand mark — the green-gradient app-icon art (src/assets/croc-icon.png,
 * a full-bleed green square with the white-rimmed croc), so the in-app logo matches
 * the installed app icon. Rounding the <img> gives it the app-icon tile shape.
 * Pass `className` to override the default shadow.
 */
export function CrocBadge({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <img
      src={crocIcon}
      alt=""
      draggable={false}
      className={cn('block shrink-0 shadow-[0_2px_8px_-3px_rgba(30,80,40,.4)]', className)}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    />
  );
}
