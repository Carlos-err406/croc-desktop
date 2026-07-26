/**
 * Parse a croc receive target — a bare code, a `croc://receive?code=…` deep link,
 * or an `https://…/croc/receive?code=…` App Link — into the transfer code plus any
 * connection settings the SENDER embedded (so the receiver auto-applies them for
 * that transfer only). Returns null if there's no usable code.
 *
 * Extensible: settings ride as `&key=value` query params. Today we read `local`;
 * `relay` / `ip` are read too so future senders that embed them just work, and
 * unknown params are ignored. This keeps the scanner invariant — accept a bare
 * code, an https link, or a croc:// link — in one place.
 */
export interface ReceiveTarget {
  code: string;
  local?: boolean;
  relay?: string;
  ip?: string;
}

export function parseReceiveTarget(raw: string): ReceiveTarget | null {
  const t = raw.trim();
  if (!t) return null;

  try {
    const u = new URL(t);
    if (u.protocol === 'croc:' || u.protocol === 'https:' || u.protocol === 'http:') {
      let code = u.searchParams.get('code')?.trim() ?? '';
      if (!code) {
        // croc://<code> or …/receive/<code> style — take the host / last segment.
        const seg = (u.hostname || u.pathname.split('/').filter(Boolean).pop() || '').trim();
        if (seg && seg !== 'receive') code = decodeURIComponent(seg);
      }
      if (!code) return null;
      const local = ['1', 'true', 'yes'].includes((u.searchParams.get('local') ?? '').toLowerCase());
      const relay = u.searchParams.get('relay')?.trim() || undefined;
      const ip = u.searchParams.get('ip')?.trim() || undefined;
      return { code, local: local || undefined, relay, ip };
    }
  } catch {
    /* not a URL — fall through to bare code */
  }
  return { code: t };
}
