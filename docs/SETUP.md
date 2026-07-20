# Atlan — setup (for a fresh clone)

Atlan runs its own server on your device and you use it from a browser at `http://127.0.0.1:4589`. It's designed for a phone running Linux under Termux/proot, but it runs on any Linux/macOS box too — you just won't need the Android build pieces unless you want APK builds.

## Requirements
- **Node.js 22+**
- For the on-phone flow: **Termux + a proot distro** (Ubuntu/Debian). On a normal computer, skip the proot bits.
- **Optional, per feature:**
  - APK builds (Build tab): JDK 21, Android SDK, and (on ARM phones) the qemu-aapt2 shim — the Doctor tab tells you exactly what's missing.
  - Local models (free, on-phone): `llama-server` (llama.cpp) on `:8080`.
  - Agent CLIs: `@openai/codex` and/or `@google/gemini-cli`, logged in.
  - Claude: a Claude subscription (OAuth — no API key needed) or an Anthropic API key.

## Install & run
```bash
git clone https://github.com/<you>/atlan.git
cd atlan
npm install
node server/src/index.js        # or: npm run dev
```
Open `http://127.0.0.1:4589`. **First run asks you to set a password** — pick anything 8+ characters. You stay logged in on that device (a session cookie that survives restarts); no token, no re-login.

## Configure (optional — every value has a sane default)
Copy the example and edit what you need:
```bash
cp atlan.config.example.json atlan.config.json
```
Knobs: `projectsDir` (where your code projects live — default `/root`), `defaultBuildProject`, `port`, `previewPort`, and `brand` (name + contact email used for push). Environment variables override the file (`ATLAN_PORT`, `ATLAN_FLEET_DIR`, `ATLAN_PROJECTS`, `ATLAN_CONTACT_EMAIL`, …). Nothing personal is baked into the code — this file (gitignored) is the only place instance-specific values live.

## First things to do in the app
1. **Take the tour** — the `?` button, top right. It walks every control.
2. **Doctor tab** — green means a feature's prerequisites are met; red tells you what to install.
3. **Add engine keys** (Doctor tab) if you want cloud models — encrypted at rest, never shown back.
4. **Preflight** (Doctor tab) — the "is it safe to expose?" checklist. Atlan is loopback-only by default; keep it that way unless you deliberately tunnel it (Cloudflare Tunnel + Access — see `docs/SECURITY.md`).

## Tests
```bash
npm test        # boots a throwaway instance on a spare port, runs every suite, tears down
```
This never touches your real cockpit or its password.

## Notes for sharing
Each person runs their **own** instance with their **own** password and their **own** Claude login — there's no shared server and no multi-tenant account system (by design; it keeps every instance private and offline-capable). "Sharing" Atlan means sharing the repo, not an account.
