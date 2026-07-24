#!/bin/bash
# ── Atlan durable launcher ────────────────────────────────────────────────
# The cockpit server used to die whenever the launching shell/Claude session
# went down (it was a child of that process tree). This runs the server under a
# DETACHED supervisor that:
#   • is reparented off the launching shell (setsid+nohup) → survives a dropped
#     session / closed terminal,
#   • RESPAWNS the server if it ever exits (crash, OOM, restart),
#   • holds a Termux wake-lock (best-effort) to fend off Android's process killer,
#   • wires the local Piper voice onto PATH if the prebuilt binary is present.
#
# Honest ceiling: this defeats "the server died with my session." It does NOT
# make you immune to Android's phantom-process killer force-killing the whole
# Termux/proot tree — that still needs the wake-lock (below) + Termux battery
# allowlist. See the [[termux-phantom-killer-fix]] notes.
#
# Usage: bin/atlan-serve.sh {start|stop|restart|status|log}
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
LOG="${ATLAN_LOG:-$ROOT/.atlan-server.log}"
SUP_PID="$ROOT/.atlan-supervisor.pid"

# Local Piper voice: put the prebuilt binary on PATH + point PIPER_MODEL at a
# voice, but only if they exist (forkers without Piper are unaffected — the app
# falls back to the free browser voice).
PIPER_BIN_DIR="${PIPER_BIN_DIR:-/root/piper/piper}"
PIPER_VOICE="${PIPER_MODEL:-/root/piper/voices/en_US-lessac-medium.onnx}"
if [ -x "$PIPER_BIN_DIR/piper" ]; then export PATH="$PIPER_BIN_DIR:$PATH"; fi
if [ -f "$PIPER_VOICE" ]; then export PIPER_MODEL="$PIPER_VOICE"; fi

status() {
  local p; p="$(cat "$SUP_PID" 2>/dev/null || true)"
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo "up — supervisor pid $p"; return 0; fi
  echo "down"; return 1
}

start() {
  if status >/dev/null 2>&1; then echo "already $(status)"; return 0; fi
  # Detach the supervisor so it outlives this shell and a dropped session.
  setsid nohup "$0" __supervise >/dev/null 2>&1 &
  disown 2>/dev/null || true
  for i in $(seq 1 20); do
    curl -s -m1 -o /dev/null "http://127.0.0.1:${ATLAN_PORT:-4589}/" 2>/dev/null && break
    sleep 0.5
  done
  echo "started — $(status); http://127.0.0.1:${ATLAN_PORT:-4589}/"
}

# The detached loop. Named entrypoint so `start` can re-exec this same script.
supervise() {
  echo $$ > "$SUP_PID"
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null || true
  trap 'rm -f "$SUP_PID"; command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null; exit 0' TERM INT
  while true; do
    echo "▸ $(date '+%F %T') starting server (port ${ATLAN_PORT:-4589})" >> "$LOG"
    node server/src/index.js >> "$LOG" 2>&1
    echo "▸ $(date '+%F %T') server exited ($?) — respawning in 2s" >> "$LOG"
    sleep 2
  done
}

stop() {
  if [ -f "$SUP_PID" ]; then kill "$(cat "$SUP_PID")" 2>/dev/null || true; rm -f "$SUP_PID"; fi
  # bracket trick so this pkill never self-matches; the script's own cmdline is
  # bin/atlan-serve.sh, which does not contain the server path.
  pkill -f "[s]erver/src/index.js" 2>/dev/null || true
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null || true
  echo "stopped"
}

case "${1:-start}" in
  start)      start ;;
  stop)       stop ;;
  restart)    stop; sleep 1; start ;;
  status)     status ;;
  log)        tail -n "${2:-40}" "$LOG" 2>/dev/null || echo "(no log yet)" ;;
  # Boot entrypoint (called from the Termux:Boot script after a reboot). Unlike
  # `start`, this stays in the FOREGROUND so the proot session it runs in stays
  # alive — inside proot, every process dies when the proot process exits, so the
  # keeper must not detach. If a supervisor is somehow already up, just idle to
  # hold proot open instead of fighting over the port.
  boot)       if status >/dev/null 2>&1; then exec tail -f /dev/null; else supervise; fi ;;
  __supervise) supervise ;;
  *) echo "usage: $0 {start|stop|restart|status|log}"; exit 1 ;;
esac
