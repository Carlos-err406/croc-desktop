import * as React from 'react';

export type ChipStatus = 'success' | 'warning' | 'info' | 'error' | 'neutral';

const CHIP: Record<ChipStatus, [string, string]> = {
  success: ['var(--success-surface)', 'var(--success-text)'],
  warning: ['var(--warning-surface)', 'var(--warning-text)'],
  info: ['var(--info-surface)', 'var(--info-text)'],
  error: ['var(--error-surface)', 'var(--error-text)'],
  neutral: ['var(--secondary)', 'var(--muted-foreground)'],
};

export function StatusChip({
  status = 'neutral',
  children,
}: {
  status?: ChipStatus;
  children: React.ReactNode;
}) {
  const [background, color] = CHIP[status];
  return (
    <span
      style={{
        background,
        color,
        fontSize: 12,
        fontWeight: 600,
        padding: '5px 11px',
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}
