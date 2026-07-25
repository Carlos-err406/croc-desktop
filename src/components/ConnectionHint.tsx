import { Wifi } from 'lucide-react';

// Errors that are self-explanatory and NOT network/connection problems — a
// VPN/network hint would just be noise on these.
const NON_CONNECTION = /too short|did ?n'?t match|declined|already exists|file error|no files|nothing to send/i;

/**
 * True when a failed transfer looks like a connect/relay problem (so the hint is
 * worth showing) rather than a specific, self-explanatory error like a bad code
 * or a declined transfer. Deliberately broad: "could not secure connection" (the
 * classic VPN symptom) and generic croc exits should all get the hint.
 */
export function looksLikeConnectionIssue(error: string | null | undefined): boolean {
  return !!error && !NON_CONNECTION.test(error);
}

/**
 * Actionable guidance shown under a failed transfer when it looks like a
 * connection problem. A VPN is by far the most common cause — it breaks croc's
 * peer handshake even when the relay itself is reachable — followed by
 * restricted networks (some phone hotspots and mobile carriers).
 */
export function ConnectionHint({ error }: { error: string | null | undefined }) {
  if (!looksLikeConnectionIssue(error)) return null;
  return (
    <div className="w-full max-w-[440px] rounded-[12px] border border-border bg-secondary/50 px-4 py-3 text-left text-[12px] text-muted-foreground">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Wifi size={14} className="shrink-0" /> Trouble connecting?
      </div>
      <p className="mt-1 leading-relaxed">
        A <span className="font-medium text-foreground">VPN</span> is the most common cause — it breaks croc's
        peer handshake even when the relay looks reachable. Restricted networks (some phone hotspots &amp;
        mobile carriers) can block it too.
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
        <li>
          Turn off any VPN on <span className="italic">both</span> devices, then retry.
        </li>
        <li>Both devices need internet to pair — croc uses a relay to introduce them.</li>
        <li>Still stuck? Try another network, or test the relay in Settings.</li>
      </ul>
    </div>
  );
}
