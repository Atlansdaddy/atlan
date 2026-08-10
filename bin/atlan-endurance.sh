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

# ── agent-work mode ──────────────────────────────────────────────────────────
# Survival is the precondition, not the claim. The README says "send agents off
# to work on budgets while you sleep", so the honest test has an agent working.
#
# THE COST FLOOR IS NOT NEGOTIABLE and it drives every default here. From
# fleet.js: "Budget counts FRESH tokens ... Turn 1 alone costs ~35k (system-prompt
# cache write), so ~50k is the practical floor for a run that does anything."
# A run cannot be made cheap by asking it for less — the floor is the system
# prompt. So the lever is HOW MANY runs, not how small each one is: one per hour
# is enough to catch "runs stopped firing after hour 2", which is the failure
# being looked for. Sampling every 15 minutes would cost four times as much and
# reveal nothing extra.
# ── local-model mode ─────────────────────────────────────────────────────────
# The fleet cannot run the on-device model: FLEET_ENGINES is ['claude', ...CLIs]
# and the local engine is chat-only, which the picker says out loud. So on a phone
# whose only ready engine is llama-server, --fleet would need an installed and
# authed CLI and real money.
#
# --local asks the model itself, on the same schedule, for nothing. It measures a
# DIFFERENT claim and the report says so: that the phone, the cockpit and the
# model all survive a night and keep producing work. It does not measure Atlan's
# agent orchestration, and a --local night must never be quoted as a --fleet one.
LOCALM=0
LLAMA_BASE="${ATLAN_LOCAL_LLM_BASE:-http://127.0.0.1:8080}"
FLEET=0
EVERY_MIN=60
RUN_BUDGET=60000     # per run; enforced mid-run on the SDK engine, so it halts
TOKEN_CAP=500000     # the night's ceiling. The script stops issuing runs at it.
ENGINE=claude        # the only engine with MID-RUN budget enforcement (the rest
                     # are pre-flight, so a budget cannot stop them in flight)
MODEL=""             # empty = the engine's own fleet tier (the cheap one)

while [ $# -gt 0 ]; do
  case "$1" in
    --hours)     HOURS="$2"; shift 2 ;;
    --seconds)   SECONDS_OVERRIDE="$2"; shift 2 ;;   # smoke-testing the harness itself
    --fleet)     FLEET=1; shift ;;                   # measure AGENT WORK, not just survival
    --local)     LOCALM=1; shift ;;                  # measure LOCAL MODEL work — free
    --llama)     LLAMA_BASE="$2"; shift 2 ;;
    --every)     EVERY_MIN="$2"; shift 2 ;;          # minutes between agent runs
    --budget)    RUN_BUDGET="$2"; shift 2 ;;         # per-run token budget (HALTS at it)
    --cap)       TOKEN_CAP="$2"; shift 2 ;;          # total token ceiling for the whole night
    --engine)    ENGINE="$2"; shift 2 ;;
    --model)     MODEL="$2"; shift 2 ;;
    --dry-run)   DRY=1; shift ;;                     # show the plan and the exact
                                                     # request body, spend nothing
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
    /"kind":"local"/ {
      local_seen = 1; l_n++
      if (/"ok":true/) l_ok++
      for (i = 1; i <= NF; i++) {
        if ($i == "secs")   { split($(i+1), a, /[:,}]/); l_secs += a[2] }
        if ($i == "tokens") { split($(i+1), a, /[:,}]/); l_tok  += a[2] }
      }
    }
    /"kind":"run"/ {
      fleet_seen = 1
      if (/"started":true/)    started++
      if (/"finished":true/)   finished++
      if (/"correct":true/)    correct++
      if (/"finished":false/)  stuck++
      if (/"skipped"/)         skipped++
      for (i = 1; i <= NF; i++) {
        if ($i == "spent_total") { split($(i+1), a, /[:,}]/); spent = a[2] }
        if ($i == "cost")        { split($(i+1), a, /[:,}]/); cost += a[2] }
      }
    }
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
      if (local_seen) {
        print ""
        printf "LOCAL MODEL WORK  (on-device inference — NOT the agent fleet)\n"
        printf "  turns attempted  %d\n", l_n + 0
        printf "  answered right   %d\n", l_ok + 0
        printf "  silent/failed    %d  <- model server down or frozen\n", (l_n - l_ok) + 0
        printf "  tokens produced  %d\n", l_tok + 0
        if (l_secs > 0) printf "  avg turn         %.1fs\n", l_secs / (l_n ? l_n : 1)
      }
      if (fleet_seen) {
        print ""
        printf "AGENT WORK\n"
        printf "  runs started     %d\n", started + 0
        printf "  runs finished    %d\n", finished + 0
        printf "  answers correct  %d\n", correct + 0
        printf "  never finished   %d  <- frozen or stuck mid-run\n", stuck + 0
        printf "  skipped (cap)    %d\n", skipped + 0
        printf "  tokens spent     %d\n", spent + 0
        printf "  cost reported    $%.4f\n", cost + 0
      }
      print  ""
      # DID IT ACTUALLY FINISH? Checked FIRST, because everything below assumes a
      # completed window. A run stopped at 4.55h of 8 reported "survived the
      # window awake" — true of the hours it saw, and worthless as an answer to
      # "does this survive a night". The hours it never reached are the ones the
      # question was about.
      short = (HOURS > 0 && ell < HOURS * 3600 * 0.95)
      if (short)
        printf "VERDICT: STOPPED EARLY at %.2f h of %.2f h — this measured %.0f%% of the window and answers nothing about the rest.\n", ell/3600, HOURS, 100*ell/(HOURS*3600)
      else if (frozen + 0 == 0 && down + 0 == 0)
        print "VERDICT: survived the window awake. The claim holds for THIS configuration."
      else if (short) { }
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
# ── agent work ────────────────────────────────────────────────────────────────
TOK=""
auth_token() {
  [ -n "$TOK" ] && { echo "$TOK"; return; }
  TOK="${ATLAN_TOKEN:-$(tr -d '\r\n' < "$REPO/.auth-token" 2>/dev/null)}"
  echo "$TOK"
}

# A real scout run: read-only profile (no Bash, no Edit, no Write), one small
# factual question with a VERIFIABLE answer. Verifiable matters — a run that
# comes back wrong is a different failure from one that never came back, and
# without a checkable answer both look like "completed".
FLEET_PROMPT='Read server/src/procTree.js and reply with ONLY the number of functions it exports. No words, no punctuation, just the digit.'
FLEET_EXPECT=1

spent_tokens=0
runs_started=0

start_run() {
  local tok body id
  tok=$(auth_token)
  # The ceiling is enforced HERE, before the request, not by trusting the server
  # to refuse. ATLAN_DAILY_TOKEN_CAP is the server-side wall and is a good one,
  # but a harness that spends money should own its own brake.
  if [ "$((spent_tokens + RUN_BUDGET))" -gt "$TOKEN_CAP" ]; then
    printf '{"kind":"run","at":%s,"skipped":"token ceiling reached","spent":%s,"cap":%s}\n' \
      "$(date +%s)" "$spent_tokens" "$TOKEN_CAP" >> "$LOG"
    return 0
  fi
  body=$(printf '{"prompt":%s,"profile":"scout","budget":%s,"engine":"%s"%s}' \
    "$(printf '%s' "$FLEET_PROMPT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')" \
    "$RUN_BUDGET" "$ENGINE" \
    "$([ -n "$MODEL" ] && printf ',"model":"%s"' "$MODEL")")
  id=$(curl -s -m 30 -X POST -H "x-atlan-token: $tok" -H 'content-type: application/json' \
       -d "$body" "http://127.0.0.1:$PORT/api/fleet/run" 2>/dev/null \
       | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -1)
  if [ -z "$id" ]; then
    printf '{"kind":"run","at":%s,"started":false,"why":"admission refused or cockpit down"}\n' "$(date +%s)" >> "$LOG"
    return 0
  fi
  runs_started=$((runs_started + 1))
  printf '{"kind":"run","at":%s,"started":true,"id":"%s","n":%s}\n' "$(date +%s)" "$id" "$runs_started" >> "$LOG"
  echo "$id"
}

# Poll a run to completion. The interesting outcome is NOT "did it succeed" — it
# is whether a run that started ever finished, because a run frozen mid-flight by
# Doze is exactly the failure the README's claim would hide.
finish_run() {
  local id="$1" tok j status tokens cost text ok deadline
  [ -z "$id" ] && return 0
  tok=$(auth_token)
  deadline=$(( $(date +%s) + 600 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 15
    j=$(curl -s -m 20 -H "x-atlan-token: $tok" "http://127.0.0.1:$PORT/api/fleet" 2>/dev/null \
        | tr '{' '\n' | grep -F "\"$id\"" | head -1)
    [ -z "$j" ] && continue
    status=$(printf '%s' "$j" | sed -n 's/.*"status" *: *"\([^"]*\)".*/\1/p')
    case "$status" in running|'') continue ;; esac
    tokens=$(printf '%s' "$j" | sed -n 's/.*"tokens" *: *\([0-9]*\).*/\1/p'); tokens=${tokens:-0}
    cost=$(printf '%s' "$j" | sed -n 's/.*"cost" *: *\([0-9.]*\).*/\1/p'); cost=${cost:-0}
    text=$(printf '%s' "$j" | sed -n 's/.*"resultText" *: *"\([^"]*\)".*/\1/p' | tr -cd '0-9' | head -c 4)
    ok=false; [ "$text" = "$FLEET_EXPECT" ] && ok=true
    spent_tokens=$((spent_tokens + tokens))
    printf '{"kind":"run","at":%s,"id":"%s","finished":true,"status":"%s","tokens":%s,"cost":%s,"answer":"%s","correct":%s,"spent_total":%s}\n' \
      "$(date +%s)" "$id" "$status" "$tokens" "$cost" "$text" "$ok" "$spent_tokens" >> "$LOG"
    return 0
  done
  printf '{"kind":"run","at":%s,"id":"%s","finished":false,"why":"still running after 10min — frozen or stuck"}\n' \
    "$(date +%s)" "$id" >> "$LOG"
}

# One real inference against the on-device model. Free, so it can run all night.
# A verifiable-ish answer matters for the same reason it does in fleet mode: a
# turn that returns garbage is a different failure from one that never returns,
# and without something to check both look like "completed".
local_turn() {
  local t0 t1 body out toks
  t0=$(date +%s)
  body=$(curl -s -m 180 "$LLAMA_BASE/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"Reply with ONLY the word ATLAN followed by the number 7. Nothing else."}],"max_tokens":24}' 2>/dev/null)
  t1=$(date +%s)
  if [ -z "$body" ]; then
    printf '{"kind":"local","at":%s,"ok":false,"why":"no response — model server down or frozen"}\n' "$t1" >> "$LOG"
    return 0
  fi
  out=$(printf '%s' "$body" | sed -n 's/.*"content":"\([^"]*\)".*/\1/p' | head -c 60)
  toks=$(printf '%s' "$body" | sed -n 's/.*"completion_tokens":\([0-9]*\).*/\1/p')
  local ok=false
  case "$out" in *ATLAN*7*) ok=true ;; esac
  printf '{"kind":"local","at":%s,"ok":%s,"secs":%s,"tokens":%s,"answer":"%s"}\n' \
    "$t1" "$ok" "$((t1 - t0))" "${toks:-0}" "$(printf '%s' "$out" | tr -d '\\"')" >> "$LOG"
}

cockpit_up() {
  # A HEAD to the cockpit. 401 counts as UP: auth answering means the server lives.
  local code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null) || code=000
  case "$code" in 000) echo down ;; *) echo up ;; esac
}

# ── dry run: the whole plan, priced, with nothing sent ───────────────────────
# Because "trust me, it's cheap" is not a number. Everything below is derived
# from the same variables the real run uses, so this cannot drift from it.
if [ "${DRY:-0}" -eq 1 ]; then
  RUNS=$(( HOURS * 60 / EVERY_MIN ))
  WORST=$(( RUNS * RUN_BUDGET ))
  [ "$WORST" -gt "$TOKEN_CAP" ] && EFF=$TOKEN_CAP || EFF=$WORST
  echo "PLAN — nothing has been sent."
  echo
  # The local plan is a DIFFERENT plan and must not be described with the fleet's
  # numbers. Printing "480,000 tokens" for a run that spends nothing is the exact
  # confidently-wrong output this harness exists to prevent.
  if [ "$LOCALM" -eq 1 ]; then
    echo "  LOCAL MODEL MODE — no API, no tokens, no rate limit, no money."
    echo
    echo "  duration          ${HOURS}h, sampling every ${INTERVAL}s"
    echo "  model turns       $RUNS  (one every ${EVERY_MIN} min)"
    echo "  endpoint          $LLAMA_BASE/v1/chat/completions  (on-device llama-server)"
    echo "  cost              0 — this is the phone's own model"
    echo
    echo "  each turn sends:"
    echo '    {"messages":[{"role":"user","content":"Reply with ONLY the word ATLAN followed by the number 7. Nothing else."}],"max_tokens":24}'
    echo
    echo "  MEASURES: whether the phone, the cockpit and the model survive a night"
    echo "  and keep producing work. It does NOT measure the agent fleet — the local"
    echo "  engine is chat-only and FLEET_ENGINES does not include it. A --local"
    echo "  night is not a --fleet night and the report says so."
    [ "$FLEET" -eq 1 ] || exit 0
    echo
    echo "  --fleet ALSO given, so the paid plan below runs too:"
    echo
  fi
  echo "  duration          ${HOURS}h, sampling every ${INTERVAL}s"
  echo "  agent runs        $RUNS  (one every ${EVERY_MIN} min)"
  echo "  profile           scout — read-only: no Bash, no Edit, no Write"
  echo "  engine            $ENGINE${MODEL:+ / $MODEL}"
  echo "  budget per run    $RUN_BUDGET tok  (halts mid-run at it)"
  echo "  night ceiling     $TOKEN_CAP tok  (the script stops issuing runs)"
  echo
  echo "  worst case        $WORST tok -> capped at $EFF tok"
  echo "  request rate      $(awk -v r="$RUNS" -v h="$HOURS" 'BEGIN{printf "%.1f", r/h}') runs/hour — no provider rate-limits this"
  echo
  echo "  each run sends exactly this body to POST /api/fleet/run:"
  printf '    {"prompt":%s,"profile":"scout","budget":%s,"engine":"%s"%s}\n' \
    "$(printf '%s' "$FLEET_PROMPT" | sed 's/"/\\"/g; s/^/"/; s/$/"/')" \
    "$RUN_BUDGET" "$ENGINE" "$([ -n "$MODEL" ] && printf ',"model":"%s"' "$MODEL")"
  echo
  echo "  NOTE: fleet.js says turn 1 alone costs ~35k tokens (system-prompt cache"
  echo "  write), so ~50k is the floor for a run that does anything. That floor is"
  echo "  why this fires hourly instead of every 15 minutes — the lever is how MANY"
  echo "  runs, not how small each one is."
  exit 0
fi

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

printf '{"kind":"config","at":%s,"hours":%s,"interval":%s,"load":%s,"synthetic_load":%s,"wake_lock":%s,"charging":"%s","device":"%s","kernel":"%s","fleet":%s,"local_model":%s,"every_min":%s,"run_budget":%s,"token_cap":%s,"engine":"%s","note":"%s"}\n' \
  "$(date +%s)" "$HOURS" "$INTERVAL" "$LOAD" "$([ "$LOAD" -gt 0 ] && echo true || echo false)" \
  "$([ "$WAKE_LOCK" -eq 1 ] && echo true || echo false)" "$(charging)" \
  "$(getprop ro.product.model 2>/dev/null || uname -m)" "$(uname -r)" \
  "$([ "$FLEET" -eq 1 ] && echo true || echo false)" \
  "$([ "$LOCALM" -eq 1 ] && echo true || echo false)" \
  "$EVERY_MIN" "$RUN_BUDGET" "$TOKEN_CAP" "$ENGINE" "$NOTE" >> "$LOG"

if [ "$FLEET" -eq 1 ]; then
  echo "AGENT WORK MODE — real runs, real tokens."
  echo "  every ${EVERY_MIN}min · ${RUN_BUDGET} tok/run · ceiling ${TOKEN_CAP} tok for the night"
  echo "  worst case: $(( (HOURS * 60 / EVERY_MIN) * RUN_BUDGET )) tok, capped at ${TOKEN_CAP}"
fi
echo "endurance run started · ${HOURS}h · sample every ${INTERVAL}s · load=${LOAD} · wake_lock=${WAKE_LOCK}"
echo "log: $LOG"
echo "leave it. screen off is fine and is the point."

START=$(date +%s)
LAST=$START
END=$((START + ${SECONDS_OVERRIDE:-$((HOURS * 3600))}))

NEXT_RUN=$START   # fire the first agent run immediately, so a total failure is
                  # visible in minute one instead of an hour from now

while [ "$(date +%s)" -lt "$END" ]; do
  sleep "$INTERVAL"
  NOW=$(date +%s)
  GAP=$((NOW - LAST))
  LAST=$NOW

  if [ "$NOW" -ge "$NEXT_RUN" ] && { [ "$FLEET" -eq 1 ] || [ "$LOCALM" -eq 1 ]; }; then
    NEXT_RUN=$((NOW + EVERY_MIN * 60))
    [ "$LOCALM" -eq 1 ] && local_turn
    if [ "$FLEET" -eq 1 ]; then RID=$(start_run); finish_run "$RID"; fi
    LAST=$(date +%s)   # the work took real time; don't score it as a Doze freeze
  fi
  printf '{"kind":"sample","at":%s,"elapsed":%s,"gap":%s,"battery":%s,"charging":"%s","temp_c":%s,"cockpit":"%s","load1":%s}\n' \
    "$NOW" "$((NOW - START))" "$GAP" "$(battery_pct)" "$(charging)" "$(temp_c)" "$(cockpit_up)" \
    "$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo null)" >> "$LOG"
done

cleanup
