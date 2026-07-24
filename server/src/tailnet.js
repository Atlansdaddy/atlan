import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const sh = promisify(exec);

// Best-effort discovery of THIS host's own Tailscale MagicDNS name
// (e.g. "john-pc.tailXXXX.ts.net"), or null if Tailscale isn't running/reachable
// here. Used to:
//   1. auto-allow the tailnet origin so reaching the cockpit from your phone over
//      the tailnet needs ZERO manual config (no ATLAN_ORIGIN gymnastics), and
//   2. surface the reach URL in Doctor.
// The name comes from `tailscale status` — it's the machine's own cryptographic
// tailnet identity, not attacker-supplied, so trusting it as an allowed origin is
// the same trust as the user setting ATLAN_ORIGIN to it by hand.
export async function tailnetHost() {
  try {
    const { stdout } = await sh('tailscale status --json', { timeout: 4000 });
    const j = JSON.parse(stdout);
    const dns = (j?.Self?.DNSName || '').replace(/\.$/, '');
    return dns || null;
  } catch {
    return null; // tailscale not installed / daemon down / not reachable from here
  }
}

// The HTTPS origin a browser sends when reaching the cockpit via `tailscale serve`.
export function tailnetOrigin(host) {
  return host ? `https://${host}` : null;
}
