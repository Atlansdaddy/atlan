#!/bin/bash
# Atlan test runner: ensures the cockpit is up, runs ALL suites via run-all.mjs
# (which also regenerates docs/RECEIPTS.md), tears down what it started.
set -e
cd "$(dirname "$0")/.."

PORT=4589
if curl -s -m1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  echo "▸ using already-running cockpit on :$PORT"
  OWN=0
else
  echo "▸ booting cockpit for tests"
  node server/src/index.js > /tmp/atlan-test-server.log 2>&1 &
  SRV=$!
  OWN=1
  for i in $(seq 1 20); do curl -s -m1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.5; done
fi

RC=0
RECEIPT_STAMP="$(date +%Y-%m-%d)" node test/run-all.mjs || RC=1

[ "$OWN" = "1" ] && kill "$SRV" 2>/dev/null
exit $RC
