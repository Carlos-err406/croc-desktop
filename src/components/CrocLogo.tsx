interface CrocMarkProps {
  width?: number;
  height?: number;
  fill?: string;
  dot?: string;
}

/** The croc mascot mark from the design (viewBox 40×26). */
export function CrocMark({ width = 40, height = 26, fill = '#fff', dot = 'var(--brand-deep)' }: CrocMarkProps) {
  return (
    <svg width={width} height={height} viewBox="0 0 40 26" fill="none" className="block">
      <g stroke={fill} strokeWidth="2.6" strokeLinecap="round">
        <path d="M12 10.5 10 7" />
        <path d="M22 10.5 24 7" />
        <path d="M12 15.5 10 19" />
        <path d="M22 15.5 24 19" />
      </g>
      <path
        d="M2 13 Q5 10.5 9 11 Q13 9.8 18 10 Q24 10.2 28 10.6 Q32 11 34.5 11.8 Q36 12.4 36 13 Q36 13.6 34.5 14.2 Q32 15 28 15.4 Q24 15.8 18 16 Q13 16.2 9 15 Q5 15.5 2 13 Z"
        fill={fill}
      />
      <circle cx="26" cy="11.5" r="1.5" fill={dot} />
      <circle cx="26" cy="14.5" r="1.5" fill={dot} />
      <circle cx="33.5" cy="12.6" r="0.7" fill={dot} />
      <circle cx="33.5" cy="13.8" r="0.7" fill={dot} />
    </svg>
  );
}

/** Rounded gradient tile containing the croc mark (sidebar / settings). */
export function CrocBadge({ size = 34, mark = 26 }: { size?: number; mark?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-[linear-gradient(140deg,var(--brand),var(--brand-deep))]"
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    >
      <CrocMark width={mark} height={mark * 0.65} fill="#fff" dot="var(--brand-deep)" />
    </span>
  );
}
