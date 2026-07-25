import { Wifi } from 'lucide-react';

// Errors that are self-explanatory and NOT network/connection problems — a
// VPN/network hint would just be noise on these.
const NON_CONNECTION = /too short|did ?n'?t match|declined|already exists|file error|no files|nothing to send/i;

// croc's local-mode discovery failure: it couldn't find the peer on the LAN.
const NO_LOCAL_PEER = /no addresses|found no|no peer|discover/i;

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
 * connection problem. Two flavors:
 *  - Local-only mode on (or a "no peer found" error): the LAN discovery came up empty
 *    — almost always because a phone hotspot blocks it; point to a Wi-Fi router.
 *  - Otherwise: a VPN is the most common cause (it breaks croc's peer handshake
 *    even when the relay is reachable), then restricted networks.
 */
export function ConnectionHint({
  error,
  local = false,
}: {
  error: string | null | undefined;
  local?: boolean;
}) {
  if (!looksLikeConnectionIssue(error)) return null;

  const localFailure = local || (!!error && NO_LOCAL_PEER.test(error));

  if (localFailure) {
    return (
      <div className="w-full max-w-[440px] rounded-[12px] border border-border bg-secondary/50 px-4 py-3 text-left text-[12px] text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Wifi size={14} className="shrink-0" /> No device found on the local network
        </div>
        <p className="mt-1 leading-relaxed">
          Local-only mode looks for the other device over the local network — but{' '}
          <span className="font-medium text-foreground">phone hotspots block this</span> (they isolate the
          devices connected to them).
        </p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          <li>
            Use a real <span className="font-medium text-foreground">Wi-Fi router</span> (a home/office
            network — it can even be one with no internet), not a phone hotspot.
          </li>
          <li>
            Make sure <span className="italic">both</span> devices have local-only mode on and are on the
            same Wi-Fi.
          </li>
          <li>Or turn local-only mode off on both to pair over the internet instead.</li>
        </ul>
      </div>
    );
  }

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
