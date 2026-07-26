#!/data/data/com.termux/files/usr/bin/bash
# ── Atlan watchdog — the outer safety net ─────────────────────────────────
# Runs in NATIVE TERMUX (not proot), on Android's OS-level JobScheduler, so it
# survives the one thing the in-proot supervisor can't: the whole Termux/proot
# tree being force-killed at once (thermal shed, phantom-process killer, OOM).
# The in-proot supervisor (atlan-serve.sh) respawns node when NODE dies; this
# resurrects the whole stack when PROOT dies. Two nets, two failure modes.
#
# Each run: probe the cockpit port; if it's down, wake-lock + relaunch the proot
# supervisor via the same proven `boot` path Termux:Boot uses. Always touches a
# heartbeat stamp so the Doctor tab can confirm the watchdog itself is alive.
#
# ── ONE-TIME REGISTRATION (phone-side, native Termux — Claude can't do this) ──
# Install it with Android's JobScheduler so it fires even after the app is killed
# and across reboots (--persisted). 15 min is JobScheduler's minimum interval:
#
#   termux-job-scheduler \
#     --script $HOME/.atlan/watchdog.sh \
#     --job-id 4589 \
#     --period-ms 900000 \
#     --persisted true
#
# Verify it registered:   termux-job-scheduler --pending
# Cancel it later:        termux-job-scheduler --cancel --job-id 4589
# (termux-job-scheduler comes from the `termux-api` package + the Termux:API app.)
#
# Honest ceiling: 15-min worst-case recovery, and JobScheduler can itself be
# throttled under Doze. The bulletproof answer remains a PC/home-node server.
set -u

PORT="${ATLAN_PORT:-4589}"
DISTRO="${ATLAN_DISTRO:-ubuntu}"
SERVE="${ATLAN_SERVE:-/root/atlan/bin/atlan-serve.sh}"   # path INSIDE the proot distro
LOG="$HOME/.atlan/watchdog.log"
STAMP="$HOME/.atlan/watchdog.stamp"

mkdir -p "$HOME/.atlan" 2>/dev/null || true
# Heartbeat: proof-of-life for the Doctor check, every run, up or down.
: > "$STAMP" 2>/dev/null || true

log() { echo "▸ $(date '+%F %T') $*" >> "$LOG" 2>/dev/null || true; }

server_up() {
  if command -v curl >/dev/null 2>&1; then
    curl -s -m3 -o /dev/null "http://127.0.0.1:${PORT}/" && return 0 || return 1
  fi
  # Dependency-free fallback: a bash TCP connect. Port open = server up.
  (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

# Healthy path: cheapest possible — heartbeat already stamped, just leave.
if server_up; then
  exit 0
fi

log "cockpit DOWN on :$PORT — relaunching proot supervisor ($DISTRO)"
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null || true

# Detach into its own session so the relaunched proot outlives this short job.
# `boot` mode holds proot open in the foreground and no-ops if a supervisor is
# somehow already up, so a fire during a slow boot can't double-launch the port.
setsid nohup proot-distro login "$DISTRO" -- "$SERVE" boot >> "$LOG" 2>&1 &
disown 2>/dev/null || true

# Give proot a moment to come up, then record the outcome for the log trail.
sleep 12
if server_up; then
  log "recovered — :$PORT answering"
else
  log "relaunch issued; not answering yet (proot may still be booting — next run rechecks)"
fi
exit 0
