#!/bin/bash
# Atlan test runner: boots the server on a throwaway state, runs both suites,
# tears down. Exit non-zero if anything is red. Preserves any already-running
# dev server by using a separate port.
set -e
cd "$(dirname "$0")/.."

PORT=4589
if curl -s -m1 "http://127.0.0.1:$PORT/api/doctor" >/dev/null 2>&1; then
  echo "▸ using already-running cockpit on :$PORT"
  OWN=0
else
  echo "▸ booting cockpit for tests"
  node server/src/index.js > /tmp/atlan-test-server.log 2>&1 &
  SRV=$!
  OWN=1
  for i in $(seq 1 20); do curl -s -m1 "http://127.0.0.1:$PORT/api/doctor" >/dev/null 2>&1 && break; sleep 0.5; done
fi

RC=0
echo; echo "═══ adversarial ═══"; node test/adversarial.mjs || RC=1
echo; echo "═══ playwright ui ═══"; node test/ui.spec.mjs || RC=1

[ "$OWN" = "1" ] && kill "$SRV" 2>/dev/null
echo; [ "$RC" = "0" ] && echo "✓ ALL GREEN" || echo "✗ FAILURES ABOVE"
exit $RC
