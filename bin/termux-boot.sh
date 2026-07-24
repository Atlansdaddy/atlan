#!/data/data/com.termux/files/usr/bin/sh
# ── Atlan auto-start on device boot ───────────────────────────────────────
# Placed by Claude for John. Runs in TERMUX (not proot) when the phone boots,
# via the Termux:Boot addon app. It holds a wake-lock, then enters the proot
# ubuntu distro and runs the cockpit supervisor in the FOREGROUND so the proot
# session stays alive (inside proot, all processes die when proot exits). The
# whole thing is backgrounded (&) so Termux:Boot can move on.
#
# REQUIRES (one-time, phone-side — Claude can't do these):
#   1. Install the "Termux:Boot" app (F-Droid), open it once to arm it.
#   2. Samsung: Settings → Apps → Termux → Battery → "Unrestricted",
#      and Device care → allow Termux to auto-start / never sleep.
#   3. Reboot to test:  after boot, browse to http://127.0.0.1:4589/
#
# Honest ceiling: OneUI's phantom-process killer can still kill the Termux tree
# despite this. The bulletproof option is running the server on a PC/home node.

termux-wake-lock 2>/dev/null

proot-distro login ubuntu -- /root/atlan/bin/atlan-serve.sh boot &
