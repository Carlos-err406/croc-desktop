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
  /** What the link asks us to do. `receive` = "here's my code, come get the files"
   *  (the default, and what a bare code means). `send` = reverse pairing: "send TO
   *  me using this code" — the opener should go to its Send screen, not receive. */
  action: 'receive' | 'send';
  code: string;
  local?: boolean;
  relay?: string;
  ip?: string;
  /** The croc version the SENDER transfers with (`&v=`), e.g. "10.6.0". */
  crocVersion?: string;
}

/** major.minor of a croc version string ("10.6.0" / "v10.6.0" → "10.6"), or null. */
export function crocMinor(v: string | null | undefined): string | null {
  const m = (v ?? '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * Compare a sender's croc version against ours. croc doesn't interoperate across
 * minor lines, so a differing major.minor means the transfer will very likely fail
 * — worth warning about BEFORE trying. Returns null when either side is unknown
 * (never cry wolf on a hand-typed code or a link with no `v`).
 */
export function versionMismatch(
  senderVersion: string | null | undefined,
  ourVersion: string | null | undefined
): { sender: string; ours: string; senderIsNewer: boolean } | null {
  const s = crocMinor(senderVersion);
  const o = crocMinor(ourVersion);
  if (!s || !o || s === o) return null;
  const [sMaj, sMin] = s.split('.').map(Number);
  const [oMaj, oMin] = o.split('.').map(Number);
  return { sender: s, ours: o, senderIsNewer: sMaj > oMaj || (sMaj === oMaj && sMin > oMin) };
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
        // Skip the action words — they're the route, not a code.
        if (seg && seg !== 'receive' && seg !== 'send') code = decodeURIComponent(seg);
      }
      if (!code) return null;
      const local = ['1', 'true', 'yes'].includes((u.searchParams.get('local') ?? '').toLowerCase());
      const relay = u.searchParams.get('relay')?.trim() || undefined;
      const ip = u.searchParams.get('ip')?.trim() || undefined;
      const crocVersion = u.searchParams.get('v')?.trim() || undefined;
      // croc://send?… or https://…/croc/send?… asks us to send; everything else
      // (croc://receive, croc://<code>, /croc/receive) means receive.
      const host = (u.protocol === 'croc:' ? u.hostname : u.pathname).toLowerCase();
      const action = host.includes('send') ? 'send' : 'receive';
      return { action, code, local: local || undefined, relay, ip, crocVersion };
    }
  } catch {
    /* not a URL — fall through to bare code */
  }
  return { action: 'receive', code: t }; // a bare code = a code to receive with
}
