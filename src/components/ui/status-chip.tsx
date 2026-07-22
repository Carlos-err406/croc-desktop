import * as React from 'react';

export type ChipStatus = 'success' | 'warning' | 'info' | 'error' | 'neutral';

const CHIP: Record<ChipStatus, string> = {
  success: 'bg-success-surface text-success-text',
  warning: 'bg-warning-surface text-warning-text',
  info: 'bg-info-surface text-info-text',
  error: 'bg-error-surface text-error-text',
  neutral: 'bg-secondary text-muted-foreground',
};

export function StatusChip({
  status = 'neutral',
  children,
}: {
  status?: ChipStatus;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] py-[5px] text-xs font-semibold leading-none ${CHIP[status]}`}
    >
      {children}
    </span>
  );
}
