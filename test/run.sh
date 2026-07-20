#!/bin/bash
# Atlan test runner. Boots a THROWAWAY instance on a separate port with a temp
# state dir, so tests never touch your live cockpit (learned 2026-07-20 when a
# test set a password on the running instance). Tears it down after.
set -e
cd "$(dirname "$0")/.."

export ATLAN_PORT=4599
export ATLAN_PREVIEW_PORT=4600
export ATLAN_FLEET_DIR="$(mktemp -d /tmp/atlan-test-fleet.XXXXXX)"
export ATLAN_BASE="http://127.0.0.1:$ATLAN_PORT"
# point the hierarchy's local + cloud-sm tiers at the suite's mock engines
export ATLAN_TIER_LOCAL_BASE="http://127.0.0.1:8091"
export ATLAN_TIER_CLOUDSM_BASE="http://127.0.0.1:8092"
# a dedicated bearer for the test instance so it needs no password
export ATLAN_TOKEN="test-$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"

echo "▸ booting throwaway test cockpit on :$ATLAN_PORT (state: $ATLAN_FLEET_DIR)"
node server/src/index.js > /tmp/atlan-test-server.log 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null; rm -rf "$ATLAN_FLEET_DIR"; }
trap cleanup EXIT
for i in $(seq 1 20); do curl -s -m1 "$ATLAN_BASE/" >/dev/null 2>&1 && break; sleep 0.5; done

RC=0
RECEIPT_STAMP="$(date +%Y-%m-%d)" node test/run-all.mjs || RC=1
exit $RC
