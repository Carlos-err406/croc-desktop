import { useLayoutEffect, useRef, useState } from 'react';
import * as React from 'react';

// Shared offscreen canvas for text measurement.
let sharedCanvas: HTMLCanvasElement | null = null;
function makeMeasurer(font: string): (s: string) => number {
  if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
  const ctx = sharedCanvas.getContext('2d')!;
  ctx.font = font;
  return (s) => ctx.measureText(s).width;
}

/**
 * Middle-truncate `text` to fit `avail` px, keeping a front and a back slice
 * around a single ellipsis (e.g. "Reincarna…-400].pdf"). Trims the front and
 * back alternately until the candidate measures within the width.
 */
function fitMiddle(text: string, avail: number, measure: (s: string) => number): string {
  if (avail <= 0 || measure(text) <= avail) return text;
  const ell = '…';
  let front = Math.ceil(text.length / 2);
  let back = text.length - front;
  let best = ell;
  while (front > 0 || back > 0) {
    if (front > back) front -= 1;
    else back -= 1;
    const candidate = text.slice(0, front) + ell + (back ? text.slice(text.length - back) : '');
    if (measure(candidate) <= avail) return candidate;
    best = candidate;
  }
  return best;
}

/**
 * Width this element may occupy = its parent's content width minus the parent's
 * padding, the flex gaps, and every *sibling's* outer width. This is deliberately
 * independent of OUR span's own text — so re-fitting (which changes our content,
 * hence our own box width) can never feed back into the measured width and cause
 * a shrink-to-nothing loop. Works whether we're `flex: 1` or `flex: 0 1 auto`.
 */
function availWidth(el: HTMLElement): number {
  const parent = el.parentElement;
  if (!parent) return el.clientWidth;
  const pcs = getComputedStyle(parent);
  let avail = parent.clientWidth - parseFloat(pcs.paddingLeft || '0') - parseFloat(pcs.paddingRight || '0');
  const kids = Array.from(parent.children) as HTMLElement[];
  const gapRaw = pcs.columnGap === 'normal' ? '0' : pcs.columnGap || '0';
  const gap = parseFloat(gapRaw) || 0;
  avail -= gap * Math.max(0, kids.length - 1);
  for (const k of kids) {
    if (k === el) continue;
    const kcs = getComputedStyle(k);
    avail -= k.getBoundingClientRect().width + parseFloat(kcs.marginLeft || '0') + parseFloat(kcs.marginRight || '0');
  }
  return Math.max(0, Math.floor(avail));
}

export function MiddleTruncate({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);
  const last = useRef<{ w: number; t: string }>({ w: -1, t: '\0' });

  // Single source of truth. Cheap to call redundantly: it early-returns unless
  // the available width or the text actually changed since the last fit.
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    const w = availWidth(el);
    if (last.current.w === w && last.current.t === text) return;
    last.current = { w, t: text };
    const cs = getComputedStyle(el);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    setDisplay(fitMiddle(text, w, makeMeasurer(font)));
  };

  // Runs after EVERY render. A progress tick that flips a row's status
  // ("45%" → "✓ 3.7 MB") widens that sibling and shrinks our column without
  // changing our filename — this re-fits synchronously, before paint.
  useLayoutEffect(fit);

  // Width changes that don't come from a React render (window/panel resize,
  // scrollbar appearing) + web-font load, which shifts glyph metrics.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onResize = () => {
      last.current = { w: -1, t: '\0' }; // force the next fit() to recompute
      fit();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    if (document.fonts?.ready) document.fonts.ready.then(onResize).catch(() => {});
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <span
      ref={ref}
      title={text}
      className={className}
      style={{
        display: 'block',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'clip', // never let native ellipsis add a second "…"
        ...style,
      }}
    >
      {display}
    </span>
  );
}
