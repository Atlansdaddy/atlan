/**
 * Kill a spawned CLI and everything it started.
 *
 * `child.kill()` signals ONE pid. These CLIs run shells and tool children, so
 * a plain SIGTERM left descendants alive while the fleet reported the run
 * killed — a kill guarantee that was not one. Signalling the negative pid hits
 * the whole process group (the child must be spawned `detached`, so it leads
 * one), and SIGKILL follows if SIGTERM is ignored.
 *
 * Lives in its own module because BOTH paths that start an agent CLI need it:
 * the fleet's batch path (agentExec) and the interactive chat path (agents).
 * agentExec already imports agents.js for the binary lookups, so putting the
 * killer in either one would make the two files import each other — and a
 * cycle is exactly how one of them ends up with a stale or missing copy of the
 * kill guarantee.
 *
 * Exported for testing: the escalation is the part most likely to rot.
 */
export function killTree(child, { graceMs = 3000 } = {}) {
  if (!child?.pid) return false;
  const signal = (sig) => {
    // Whole group first (negative pid). If the group is already gone, fall back
    // to the pid alone — flattened from a nested try/catch, same two attempts.
    try { process.kill(-child.pid, sig); return true; } catch { /* group gone — try the pid */ }
    try { child.kill(sig); return true; } catch { return false; }
  };
  const sent = signal('SIGTERM');
  const t = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) signal('SIGKILL'); }, graceMs);
  t.unref?.();  // never hold the event loop open on a process that already left
  return sent;
}
