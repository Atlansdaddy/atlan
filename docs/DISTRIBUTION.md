# Distribution — what "usable without cloning the repo" actually means

*Proposal, 2026-08-04. Nothing here is built; this is the decision doc John
asked for. The user-agnostic pass (same branch) is the prerequisite work and IS
built.*

## The real blocker isn't the download — it's where state lives

Today Atlan's runtime state is welded to the repo checkout:

| State | Lives at | Why that blocks no-clone installs |
|---|---|---|
| password hash, sessions | `<repo>/.fleet/auth.json` | an upgrade that replaces the folder logs everyone out / loses the password |
| encrypted API keys | `<repo>/.keys.enc` | same — and users will not expect keys inside an app folder |
| automation bearer | `<repo>/.auth-token` | same |
| inbox, burn ledger, routines, personas | `<repo>/.fleet/*` | history dies with the folder |
| snapshots / APKs | `<repo>/.snapshots`, `<repo>/.apk` | same |

`FLEET_DIR` is already env-overridable (tests use that), so the seam exists.
The move: **default user state to `~/.atlan/` when not explicitly configured**
(`ATLAN_HOME` to relocate), with a one-time automatic migration when the old
in-repo layout is detected. After that, the app folder is disposable — which is
the property every install method below depends on. This is the first PR of
distribution work, and it's useful even if we never ship an installer, because
it also ends the "app can write its own auth store through the editor"
class of worry in one structural stroke.

## Who installs Atlan, honestly

1. **Phone-first person with Termux** — today's core audience. Has node via
   proot; may not have git or want it.
2. **Linux/WSL2/mac tinkerer** — has node, maybe git; wants one command and a
   URL to open.
3. **Windows-native user** — the pass on this branch makes the server actually
   work there (separator guards, homedir detection); node via installer, no git.
4. **Docker person** — exists, but Docker doesn't exist on Termux, and Atlan is
   phone-first. Docker is a nice-to-have, never the front door.

## Options

### A. npm package — `npx atlan-cockpit` (recommended front door)
- One command on every host that has node ≥ 20 (including Termux proot). No
  git. Versioned upgrades (`npm i -g atlan-cockpit@latest`), trivial rollback.
- Needs: state in `~/.atlan` (above), a `bin` entry, and the `web/` +
  `server/` trees shipped in the package (`files` field — no build step exists,
  which makes this easy; the no-build rule finally pays rent at the registry).
- Watch-outs: `node-pty` is a native build — prebuilds cover mac/win/linux
  x64+arm64, but **proot/Termux compiles from source**, so the package must
  not hard-fail when node-gyp is missing: degrade the Term tab honestly (the
  capability-detection posture the codebase already has everywhere else).
  Publish under Mid-Atlantic AI's npm org; the name `atlan` is likely taken.

### B. One-line bootstrap script (the Termux path, and the fallback everywhere)
`curl -fsSL https://…/install.sh | bash`
- Downloads a release tarball (GitHub Releases, no git needed), unpacks to
  `~/.atlan/app`, `npm install --omit=dev` inside it, writes the
  service/boot wiring the host supports (systemd unit on WSL2/Linux,
  Termux:Boot script on the phone — both already exist in `bin/`, they just
  need the env-default treatment they got on this branch).
- This is the path that can ALSO set up the phone extras (wake-lock, watchdog)
  which npm never could. The script and the npm package are complementary,
  not rivals: the script can even just run `npm i -g` when npm is present.

### C. Docker image
- `docker run -p 4589:4589 -v atlan-state:/state midatlantic/atlan` for the
  server-closet crowd. Cheap to add once A exists (the Dockerfile is ~10
  lines against the npm package). Never the documented first step, because the
  primary audience cannot run it.

### D. Do nothing (status quo: git clone)
- Keeps the audience at "people comfortable cloning repos" — which contradicts
  "any user can get to this and use it." Clone stays the *contributor* path
  regardless.

## Recommendation

Sequence, each step shippable alone:

1. **State → `~/.atlan`** with auto-migration (enables everything; useful now).
2. **npm package** with `atlan` bin → `npx atlan-cockpit` starts the cockpit,
   prints the URL, sets the password on first visit. Term degrades gracefully
   where node-pty can't build.
3. **Bootstrap script** wrapping (2) + host wiring (systemd / Termux:Boot).
4. Docker, if ever, last.

Open questions for John:
- Package name (`atlan-cockpit`? `@midatlantic/atlan`?).
- Does first-run over the tailnet need anything extra once installs are
  trivial (today's setup-allowed-origin logic assumes the operator's device)?
- Auto-update posture: none / notify-only in Doctor / self-update command.
  (Given the security posture — an app that can rewrite itself is a liability —
  notify-only in Doctor feels right.)
