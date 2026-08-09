#!/usr/bin/env bash
# Does Atlan actually survive a night on a phone?
#
# The README says you can "send agents off to work on budgets while you sleep."
# Nothing in this repo has ever measured that. bin/atlan-watchdog.sh already says
# the honest thing in a comment — "throttled under Doze. The bulletproof answer
# remains a PC/home-node server" — and that sentence never reached the README.
# This script produces the receipt either way.
#
# The signal that matters is SAMPLE GAP. This wakes on a fixed interval; if the
# OS freezes the process, the gap between two timestamps exceeds the interval by
# more than the tolerance. That is Doze, measured directly, with no root, no adb
# and no dumpsys parsing — the clock cannot be argued with.
#
# Run it the pessimistic way FIRST, the way a user who installed it would:
# unplugged, screen off, Termux NOT battery-whitelisted, no wake lock. That is
# the configuration the claim has to survive. Every knob below is recorded in the
# receipt, so a friendlier run is a different sentence, not a better one.
#
#   ./bin/atlan-endurance.sh --hours 8
#   ./bin/atlan-endurance.sh --hours 8 --load 2 --wake-lock   # sustained work
#   ./bin/atlan-endurance.sh --report .fleet/endurance/<run>.jsonl
#
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ATLAN_FLEET_DIR:-$REPO/.fleet}/endurance"
INTERVAL=60          # seconds between samples
TOL=30               # a gap beyond INTERVAL+TOL means the OS froze us
HOURS=8
LOAD=0
WAKE_LOCK=0
PORT="${ATLAN_PORT:-4589}"
NOTE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --hours)     HOURS="$2"; shift 2 ;;
    --seconds)   SECONDS_OVERRIDE="$2"; shift 2 ;;   # smoke-testing the harness itself
    --interval)  INTERVAL="$2"; shift 2 ;;
    --load)      LOAD="$2"; shift 2 ;;
    --wake-lock) WAKE_LOCK=1; shift ;;
    --note)      NOTE="$2"; shift 2 ;;
    --report)    REPORT_FILE="$2"; shift 2 ;;
    -h|--help)   sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# ── report mode ───────────────────────────────────────────────────────────────
if [ -n "${REPORT_FILE:-}" ]; then
  [ -r "$REPORT_FILE" ] || { echo "cannot read $REPORT_FILE" >&2; exit 1; }
  # The threshold comes from the LOG's own config line, never from the flags on
  # this invocation. Reporting a 30s-interval run with the 60s default would call
  # a real freeze a normal gap — the failure mode where the tool says "survived"
  # about a night it did not measure.
  CFG=$(grep -m1 '"kind":"config"' "$REPORT_FILE")
  R_INTERVAL=$(printf '%s' "$CFG" | sed -n 's/.*"interval":\([0-9]*\).*/\1/p')
  R_HOURS=$(printf '%s' "$CFG" | sed -n 's/.*"hours":\([0-9.]*\).*/\1/p')
  [ -n "$R_INTERVAL" ] || { echo "log has no config line — cannot set a freeze threshold" >&2; exit 1; }
  awk -F'"' '
    /"kind":"config"/ { cfg = $0 }
    /"kind":"sample"/ {
      n++
      for (i = 1; i <= NF; i++) {
        if ($i == "elapsed")  { split($(i+1), a, /[:,}]/); el = a[2] }
        if ($i == "gap")      { split($(i+1), a, /[:,}]/); g  = a[2] }
        if ($i == "battery")  { split($(i+1), a, /[:,}]/); b  = a[2] }
        if ($i == "temp_c")   { split($(i+1), a, /[:,}]/); t  = a[2] }
        if ($i == "cockpit")  { ck = $(i+2) }
      }
      if (n == 1) { b0 = b; t0 = t; tmin = t; tmax = t }
      if (t + 0 > tmax + 0) tmax = t
      if (t + 0 < tmin + 0) tmin = t
      bl = b; tl = t; ell = el
      if (g + 0 > maxgap + 0) maxgap = g
      if (g + 0 > FROZEN + 0) { frozen++; frozen_total += g - INTERVAL }
      if (ck == "down") down++
    }
    END {
      if (n == 0) { print "no samples in this log — the run never reached its first interval."; exit }
      printf "samples            %d\n", n
      printf "ran for            %.2f h of %.2f h planned\n", ell/3600, HOURS
      if (b0 == "null") printf "battery            unavailable (install termux-api for this)\n"
      else              printf "battery            %s%% -> %s%%  (drain %s pts)\n", b0, bl, b0 - bl
      if (t0 == "null") printf "temperature        unavailable (no readable thermal zone)\n"
      else              printf "temperature        %.1f C start, %.1f C peak, %.1f C low\n", t0, tmax, tmin
      printf "cockpit down       %d of %d samples\n", down + 0, n
      printf "frozen intervals   %d  (longest gap %ds, interval %ds)\n", frozen + 0, maxgap + 0, INTERVAL
      printf "total time frozen  %.1f min\n", frozen_total / 60
      print  ""
      if (frozen + 0 == 0 && down + 0 == 0)
        print "VERDICT: survived the window awake. The claim holds for THIS configuration."
      else if (frozen + 0 > 0)
        print "VERDICT: the OS froze the process. Unattended overnight work does NOT hold here."
      else
        print "VERDICT: stayed awake but the cockpit stopped answering. Server-side failure, not Doze."
      print "Configuration this verdict applies to:"
      print "  " cfg
    }
  ' FROZEN=$((R_INTERVAL + TOL)) INTERVAL="$R_INTERVAL" HOURS="${R_HOURS:-0}" "$REPORT_FILE"
  exit 0
fi

# ── sampling helpers (no root, no adb, degrade honestly when absent) ──────────
battery_pct() {
  if command -v termux-battery-status >/dev/null 2>&1; then
    termux-battery-status 2>/dev/null | sed -n 's/.*"percentage": *\([0-9]*\).*/\1/p' | head -1
  elif [ -r /sys/class/power_supply/battery/capacity ]; then
    cat /sys/class/power_supply/battery/capacity 2>/dev/null
  else echo null; fi
}
charging() {
  if command -v termux-battery-status >/dev/null 2>&1; then
    termux-battery-status 2>/dev/null | sed -n 's/.*"status": *"\([A-Z]*\)".*/\1/p' | head -1
  else echo UNKNOWN; fi
}
# Hottest zone, not zone0 — zone0 is often the battery and throttling shows up in the SoC.
temp_c() {
  local hi=0 v
  for z in /sys/class/thermal/thermal_zone*/temp; do
    [ -r "$z" ] || continue
    v=$(cat "$z" 2>/dev/null) || continue
    case "$v" in ''|*[!0-9-]*) continue ;; esac
    [ "$v" -gt 1000 ] && v=$((v / 1000))
    [ "$v" -gt "$hi" ] && hi=$v
  done
  [ "$hi" -eq 0 ] && echo null || echo "$hi"
}
cockpit_up() {
  # A HEAD to the cockpit. 401 counts as UP: auth answering means the server lives.
  local code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null) || code=000
  case "$code" in 000) echo down ;; *) echo up ;; esac
}

mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%dT%H%M%S)
LOG="$OUT_DIR/endurance-$STAMP.jsonl"

# Synthetic sustained work. Agent turns are bursty CPU with network waits; this is
# a deliberately CRUDE stand-in whose only job is to keep the SoC busy enough to
# provoke thermal behaviour. It is labelled synthetic in the receipt so nobody
# reads it as a measurement of real agent work.
LOAD_PIDS=""
if [ "$LOAD" -gt 0 ]; then
  for _ in $(seq 1 "$LOAD"); do
    ( while :; do : $((RANDOM * RANDOM)); done ) & LOAD_PIDS="$LOAD_PIDS $!"
  done
fi

if [ "$WAKE_LOCK" -eq 1 ] && command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null || true
fi

cleanup() {
  [ -n "$LOAD_PIDS" ] && kill $LOAD_PIDS 2>/dev/null
  [ "$WAKE_LOCK" -eq 1 ] && command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null
  echo "{\"kind\":\"end\",\"at\":$(date +%s)}" >> "$LOG"
  echo
  echo "log: $LOG"
  echo "report: $0 --report $LOG"
  exit 0
}
trap cleanup TERM INT

printf '{"kind":"config","at":%s,"hours":%s,"interval":%s,"load":%s,"synthetic_load":%s,"wake_lock":%s,"charging":"%s","device":"%s","kernel":"%s","note":"%s"}\n' \
  "$(date +%s)" "$HOURS" "$INTERVAL" "$LOAD" "$([ "$LOAD" -gt 0 ] && echo true || echo false)" \
  "$([ "$WAKE_LOCK" -eq 1 ] && echo true || echo false)" "$(charging)" \
  "$(getprop ro.product.model 2>/dev/null || uname -m)" "$(uname -r)" "$NOTE" >> "$LOG"

echo "endurance run started · ${HOURS}h · sample every ${INTERVAL}s · load=${LOAD} · wake_lock=${WAKE_LOCK}"
echo "log: $LOG"
echo "leave it. screen off is fine and is the point."

START=$(date +%s)
LAST=$START
END=$((START + ${SECONDS_OVERRIDE:-$((HOURS * 3600))}))

while [ "$(date +%s)" -lt "$END" ]; do
  sleep "$INTERVAL"
  NOW=$(date +%s)
  GAP=$((NOW - LAST))
  LAST=$NOW
  printf '{"kind":"sample","at":%s,"elapsed":%s,"gap":%s,"battery":%s,"charging":"%s","temp_c":%s,"cockpit":"%s","load1":%s}\n' \
    "$NOW" "$((NOW - START))" "$GAP" "$(battery_pct)" "$(charging)" "$(temp_c)" "$(cockpit_up)" \
    "$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo null)" >> "$LOG"
done

cleanup
