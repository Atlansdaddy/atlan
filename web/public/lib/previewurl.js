// Where the preview iframe points.
//
// Three facts collide here, and getting any one wrong makes the preview pane
// silently blank rather than error:
//
//  1. An http iframe inside an https page is blocked as mixed content, with no
//     console error in some browsers. So the frame's scheme must match the page.
//  2. The preview proxy itself only speaks http on a loopback port. Reaching it
//     over https means something else terminates TLS in front of it —
//     `tailscale serve`, a reverse proxy — on a port this code cannot discover.
//  3. postMessage is origin-pinned both ways, so the listener's expected origin
//     has to be derived from the same URL, not written out a second time.
//
// The port comes from the server (ATLAN_PREVIEW_TLS_PORT). When it isn't
// configured there is no honest https answer, and saying so beats guessing:
// a hardcoded 4591 is how one operator's `tailscale serve` setup ended up baked
// into shared code.

/**
 * @returns {{url: string|null, origin: string|null, why: string|null}}
 *   `url` null means the preview cannot be shown here, and `why` says what to do.
 */
export function previewUrl({ protocol, hostname, port, tlsPort }) {
  if (protocol === 'https:') {
    if (!tlsPort) {
      return {
        url: null,
        origin: null,
        why: 'Preview needs a TLS front door when the cockpit is served over https, '
          + 'or the browser blocks the frame as mixed content. Run '
          + '`tailscale serve --bg --https=4591 ' + (port || 4590) + '` and set '
          + 'ATLAN_PREVIEW_TLS_PORT=4591 (or previewTlsPort in atlan.config.json).',
      };
    }
    const url = `https://${hostname}:${tlsPort}/`;
    return { url, origin: new URL(url).origin, why: null };
  }
  const url = `http://${hostname}:${port || 4590}/`;
  return { url, origin: new URL(url).origin, why: null };
}
