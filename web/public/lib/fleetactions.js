// The fleet buttons that spend money or stop work, and the two ways they used
// to lie about it.
//
// Both were bare `fetch(...)` calls in app.js with no .then and no .catch:
//
//  · TOP-UP stayed armed between the tap and the reply. A second tap resumed
//    the SAME session again on a second budget. The server now refuses the
//    second one (fleet.js consumeHalt), but a button that offers an action
//    guaranteed to fail is still a lie — so it disarms while in flight, and
//    comes back only if the top-up did not happen.
//
//  · KILL, both the per-run one and the big red KILL ALL, threw the response
//    away. On a 500, an expired session or a dead server the fleet kept running
//    and the cockpit looked exactly as if it had stopped. For the control whose
//    entire job is "stop it now", silence is the worst possible answer.
//
// `io.onError` is how anything here reaches the user. There is no path in this
// module that fails without calling it.

export const TOPUP_LABEL = '▲ top up +100k tok & resume';
export const TOPUP_BUSY = '▲ topping up…';
const UNREACHABLE = 'cockpit server unreachable';

const post = (fetchFn, url, body) =>
  fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * Ask for a fresh budget on a halted run.
 *
 * Disarms `btn` BEFORE the request, not after the reply — the window between
 * tap and reply is the whole bug. Returns the new run, or null if nothing was
 * spent (in which case the button is armed again so the user can retry).
 */
export async function topUp(id, btn, io = {}) {
  const { fetchFn = fetch, onError = () => {}, extra = 100000 } = io;
  const arm = (on) => {
    if (!btn) return;
    btn.disabled = !on;
    btn.textContent = on ? TOPUP_LABEL : TOPUP_BUSY;
  };
  arm(false);
  const refuse = (msg) => { onError(msg); arm(true); return null; };
  let j;
  try {
    j = await (await post(fetchFn, '/api/fleet/topup', { id, extra })).json();
  } catch {
    return refuse(UNREACHABLE);
  }
  if (j?.error) return refuse(j.error);
  // Left disarmed on purpose: the run is now 'resumed', so the next poll drops
  // `resumable` and paintRun hides the button outright.
  return j;
}

/**
 * Stop a run, or the whole fleet with id 'all'.
 *
 * Returns the server's answer, or null after reporting why the kill did not
 * land. A kill that failed must never look like a kill that worked.
 */
export async function sendKill(id, io = {}) {
  const { fetchFn = fetch, onError = () => {} } = io;
  const what = id === 'all' ? 'KILL ALL' : `kill of ${id}`;
  let res, j;
  try {
    res = await post(fetchFn, '/api/fleet/kill', { id });
    j = await res.json().catch(() => ({}));
  } catch {
    onError(`${UNREACHABLE} — ${what} did NOT land, the fleet may still be running`);
    return null;
  }
  if (!res.ok || j?.error) {
    onError(`${what} failed: ${j?.error ?? `server returned ${res.status}`} — the fleet may still be running`);
    return null;
  }
  return j;
}
