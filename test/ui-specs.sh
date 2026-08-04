#!/usr/bin/env bash
# Drive the UI/UX specs against a throwaway cockpit.
#
# These are NOT in run-all.mjs — see docs/UI-AUDIT.md. They currently fail on
# real defects, and each spec joins the gate the day its surface reaches zero.
#
#   bash test/ui-specs.sh              # all five
#   bash test/ui-specs.sh ui-editor    # one surface
set -u
cd "$(dirname "$0")/.."

free() { node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
export ATLAN_PORT=$(free) ATLAN_PREVIEW_PORT=$(free)
export ATLAN_FLEET_DIR=$(mktemp -d /tmp/atlan-uispec.XXXX)
export ATLAN_TOKEN="uispec-$(head -c8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export ATLAN_BASE="http://127.0.0.1:$ATLAN_PORT"

node server/src/index.js > /tmp/uispec-server.log 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null; rm -rf "$ATLAN_FLEET_DIR"; }
trap cleanup EXIT

for _ in $(seq 1 40); do curl -s -m1 "$ATLAN_BASE/" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -s -m2 "$ATLAN_BASE/" >/dev/null 2>&1; then
  echo "cockpit never came up on :$ATLAN_PORT — see /tmp/uispec-server.log" >&2
  exit 1
fi

SPECS=${1:-"ui-chat ui-editor ui-fleet ui-doctor ui-tutorial"}
fail=0
for f in $SPECS; do
  echo "######## $f"
  timeout 420 node "test/$f.spec.mjs" 2>&1 | grep -E '✗|XX|passed,'
  [ "${PIPESTATUS[0]}" -eq 0 ] || fail=1
done
exit $fail
