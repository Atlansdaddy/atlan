# Atlan — setup (for a fresh clone)

Atlan runs its own Node server and you drive it from a browser at `http://127.0.0.1:4589`. **Where the server can run decides how you use it** — read the platform table first.

## Which path is yours?

| You have… | Do this |
|---|---|
| **A PC (Linux / macOS / Windows)** | On-device install below. Easiest — it's just Node. |
| **A capable Android phone** | On-device install below, in Termux + proot. Power-user setup. |
| **An iPhone/iPad, or any phone you don't want to set up** | **Cloud-client mode** — run the server on a PC/node once, open the URL on the phone. No Termux. |

**You also need an engine.** Atlan drives models; it needs at least one configured or the app runs but the agent has no brain:
- **Claude subscription or Anthropic API key** → the full agent, with hands (reads/edits files, runs tools, builds).
- **A free cloud key** (Gemini, Groq, …) → chat "brains" only, no hands — good for a zero-cost look.
- **Local `llama-server`** → free/offline, if the hardware can run a model well.

---

## On-device install

### PC (Linux / macOS)
```bash
git clone https://github.com/Atlansdaddy/atlan.git
cd atlan
npm install
bin/atlan-serve.sh start        # or: node server/src/index.js
```
Open `http://127.0.0.1:4589`.

### Windows → use WSL2 (not native Windows)
Native Windows Node runs the server + Chat + brains + voice + preview + editor + fleet, but the **Term tab (tmux), the `bin/atlan-serve.sh` launcher (bash), and APK builds are Linux-only** and will error. Run it in **WSL2** — a real Linux environment where everything works (and you get the OS Bash sandbox proot can't provide):
```powershell
wsl --install         # then reboot, open the Ubuntu shell
```
Then follow the Linux steps above *inside* WSL. Access it from Windows at the same `http://127.0.0.1:4589`.

### Android phone (Termux + proot)
The Node server needs a Linux userland; on Android that's Termux + proot. **The one-button APK does not remove this** — the APK is a client wrapper; the server still runs here.

1. Install **Termux from [F-Droid](https://f-droid.org/packages/com.termux/)** — *not* the Play Store version (it's outdated and breaks).
2. In Termux:
   ```bash
   pkg update -y && pkg install -y proot-distro
   proot-distro install ubuntu
   proot-distro login ubuntu
   ```
3. Now inside Ubuntu (proot):
   ```bash
   apt update && apt install -y nodejs npm git
   git clone https://github.com/Atlansdaddy/atlan.git
   cd atlan && npm install
   bin/atlan-serve.sh start
   ```
4. Open `http://127.0.0.1:4589` in the phone's browser (Chrome recommended for voice input).

> **OEM note:** Samsung/Xiaomi and other aggressive battery managers may kill Termux in the background. Set Termux to **Battery → Unrestricted** and allow auto-start. Low-RAM phones will struggle with local models — use a cloud engine there.

---

## Cloud-client mode (iPhone, or any phone without Termux)

iOS cannot run a shell or background server at all, and not every Android phone is worth setting up. In those cases run the **server once on a PC / home node / cloud VM**, and connect the phone as a plain browser client:

1. Install and run Atlan on the PC/node (PC steps above).
2. Expose it to the phone **safely** — do **not** open a bare port. Two good options:
   - **Tailscale (recommended, free):** put both devices on your tailnet, then on the host run `tailscale serve --bg 4589` — this proxies loopback over the tailnet via HTTPS, reachable only by your own devices. Atlan **auto-allows its own tailnet origin at startup**, so there's no `ATLAN_ORIGIN` to set; just add `ATLAN_SECURE_COOKIE=1` for the Secure cookie over TLS. The Doctor tab shows the exact reach URL and confirms the origin guard will allow it. **Never `tailscale funnel`** — that's public-internet exposure.
   - **Cloudflare Tunnel + Access** (see `docs/SECURITY.md`) if you want an org-gated public hostname.
3. On the phone, open the tailnet/tunnel URL. Add to home screen for an app-like PWA. It's the full cockpit; only the *server* lives on the PC.

This is the "semi-local closed loop" — the broadly-shareable path, and the only path on iPhone.

---

## Keeping it running

- **`bin/atlan-serve.sh {start|stop|restart|status|log}`** — a detached supervisor that respawns the server if it crashes and survives a dropped terminal/session (it does **not** survive a full reboot on its own). On a phone it also holds a Termux wake-lock.
- **Survive a reboot (phone):** install the **Termux:Boot** app (F-Droid) and open it once to arm it. The boot script `bin/termux-boot.sh` (copy to `~/.termux/boot/atlan-boot.sh` in Termux — one is auto-placed on this instance) re-enters proot and starts the server on device boot. On Samsung, also set Termux battery to Unrestricted.
- **Honest ceiling:** Android's phantom-process killer can still take the whole Termux tree despite this. For always-on, run the server on a PC/home node (cloud-client mode).

---

## Install & run (quick reference)
```bash
git clone https://github.com/Atlansdaddy/atlan.git
cd atlan
npm install
bin/atlan-serve.sh start        # durable; or: node server/src/index.js
```
Open `http://127.0.0.1:4589`. **First run asks you to set a password** (8+ chars). You stay logged in on that device (an httpOnly session cookie that survives restarts) — no token to paste, no re-login.

## Configure (optional — every value has a sane default)
```bash
cp atlan.config.example.json atlan.config.json
```
Knobs: `projectsDir` (where your code lives — default `/root`), `defaultBuildProject`, `port`, `previewPort`, and `brand` (name + contact email used for push). Environment variables override the file (`ATLAN_PORT`, `ATLAN_FLEET_DIR`, `ATLAN_PROJECTS`, `ATLAN_CONTACT_EMAIL`, …). Nothing personal is baked into the code — this gitignored file is the only place instance-specific values live.

## First things to do in the app
1. **Set an engine** — Doctor tab → Engine keys. Add a Claude/Anthropic key (full agent) or a free Gemini/Groq key (chat), or start `llama-server` for local. Without one, the agent has no brain.
2. **Take the tour** — the `?` button, top right; it walks every control (28 steps).
3. **Doctor tab** — green means a feature's prerequisites are met; red names what to install.
4. **Preflight** (Doctor tab) — the "is it safe to expose?" checklist. Atlan is loopback-only by default; keep it that way unless you deliberately tunnel it (Cloudflare Tunnel + Access — see `docs/SECURITY.md`).

## Tests
```bash
npm test        # boots a throwaway instance on a spare port, runs every suite, tears down
```
This never touches your real cockpit or its password.

## Notes for sharing
Each person runs their **own** instance with their **own** password and their **own** engine key/login — there's no shared server and no multi-tenant account system (by design; it keeps every instance private and offline-capable). "Sharing" Atlan means sharing the repo, not an account.
