import * as React from 'react';

/**
 * macOS-style middle truncation: the head ellipsizes to fit the available
 * width while the tail (extension + a few chars) always stays visible.
 * Requires a width-constrained flex context (it sets min-width: 0 itself).
 */
export function MiddleTruncate({
  text,
  tail = 12,
  className,
  style,
}: {
  text: string;
  tail?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const keep = Math.max(0, Math.min(tail, Math.max(0, text.length - 1)));
  const head = text.slice(0, text.length - keep);
  const end = text.slice(text.length - keep);
  return (
    <span
      title={text}
      className={className}
      style={{ display: 'flex', minWidth: 0, overflow: 'hidden', ...style }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {head}
      </span>
      <span style={{ whiteSpace: 'nowrap' }}>{end}</span>
    </span>
  );
}
