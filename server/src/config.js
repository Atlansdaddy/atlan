import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

// One place for everything instance- or person-specific, so the code carries no
// personal data and a fork = editing atlan.config.json (or env), never source.
// Precedence: env var > atlan.config.json > neutral default.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

let file = {};
try { file = JSON.parse(readFileSync(join(REPO, 'atlan.config.json'), 'utf8')); } catch { /* optional */ }
const pick = (env, key, dflt) => process.env[env] ?? file[key] ?? dflt;

// State + app files (overridable so tests use a throwaway dir, never the real one)
export const FLEET_DIR = process.env.ATLAN_FLEET_DIR ?? join(REPO, '.fleet');
export const APP_ROOT = REPO; // where .auth-token, .snapshots, .keys.enc live

// Where the user's code projects are scanned from + the default build target.
// homedir(), not a literal `/root`: on the phone/home-node the operator IS
// root so nothing changes there, and every other user gets their own home
// instead of a path that cannot exist. win32 keeps cwd — a Windows home dir
// is a poor projects root (OneDrive redirection, Desktop clutter) and cwd is
// where the operator launched the cockpit from.
const DEFAULT_PROJECTS = process.platform === 'win32' ? process.cwd() : homedir();
export const PROJECTS_DIR = pick('ATLAN_PROJECTS', 'projectsDir', DEFAULT_PROJECTS);
export const DEFAULT_BUILD_PROJECT = pick('ATLAN_BUILD_PROJECT', 'defaultBuildProject', PROJECTS_DIR);

// Ports
export const PORT = Number(pick('ATLAN_PORT', 'port', 4589));
export const PREVIEW_PORT = Number(pick('ATLAN_PREVIEW_PORT', 'previewPort', 4590));
// The TLS front door a phone reaches the preview through, when one exists — e.g.
// `tailscale serve --bg --https=4591 4590`. This process never terminates TLS
// itself, so it cannot discover that port; 0 means "none configured" rather than
// a guessed default, because guessing 4591 is exactly how one operator's setup
// ended up hardcoded into shared code.
export const PREVIEW_TLS_PORT = Number(pick('ATLAN_PREVIEW_TLS_PORT', 'previewTlsPort', 0));

// Aggregate spend controls (peer review, 2026-07-22): per-run budgets don't
// bound concurrent runs, so a global daily token ceiling + a concurrency cap
// backstop the whole account. 0 = unlimited.
export const DAILY_TOKEN_CAP = Number(pick('ATLAN_DAILY_TOKEN_CAP', 'dailyTokenCap', 5_000_000));
export const MAX_CONCURRENT_RUNS = Number(pick('ATLAN_MAX_CONCURRENT_RUNS', 'maxConcurrentRuns', 6));

// Per-run budget reserve (peer review: budgets were checked POST-step, so one
// big model turn could overshoot the cap before we counted it). We stop
// authorizing new tool-driven turns once we're within this many fresh tokens of
// the budget, leaving headroom for the in-flight turn to finish — bounding
// overshoot to ~one turn instead of a whole generation. Capped at half the run's
// budget so a small run still does real work. A conservative single-turn
// output+input estimate; tune with ATLAN_TURN_RESERVE.
export const TURN_RESERVE = Number(pick('ATLAN_TURN_RESERVE', 'turnReserve', 16_000));

// OS-level Bash sandbox for AUTONOMOUS fleet runs (builder/verifier). The Agent
// SDK confines Bash via bubblewrap/seccomp when this is on AND the host provides
// user namespaces (Linux / WSL2 / a home node). proot on the phone has none, so
// failIfUnavailable stays false → it degrades to UNsandboxed there and the Doctor
// says so honestly (never a lie about the boundary). Off by default; opt in with
// ATLAN_SANDBOX=1 once the Doctor's bubblewrap check is green. Deliberately NOT
// applied to interactive Chat — that's human card-gated; this confines the
// autonomous fleet, which is exactly what the peer review flagged.
export function sandboxEnabled() { return process.env.ATLAN_SANDBOX === '1'; }
export function sandboxOption() {
  return sandboxEnabled() ? { enabled: true, failIfUnavailable: false } : undefined;
}

// Local OpenAI-compat LLM (llama-server or anything speaking /v1). One key —
// brains, harness, doctor and the model picker all read this instead of each
// hardcoding the author's :8080.
export const LOCAL_LLM_BASE = pick('ATLAN_LOCAL_LLM_BASE', 'localLlmBase', 'http://127.0.0.1:8080');

// Android SDK root for the APK pipeline + doctor checks. Default is the
// documented phone/home-node layout (~/android-sdk), not a literal /root.
export const ANDROID_SDK = pick('ATLAN_ANDROID_SDK', 'androidSdk', join(homedir(), 'android-sdk'));

// OS confinement for the exec-mode agent CLIs (server/src/lib/sandbox.js). The
// Agent SDK's `sandbox` option above does not reach those four — agents.js and
// studio.js spawn them directly with their native gates switched off.
//
// Off by default, and that default is a PHONE decision rather than a shrug:
// Termux/proot has no user namespaces, so confining unconditionally would refuse
// every run and Atlan would not start on its primary platform. What it must
// never do is pretend. So the switch has THREE states, not two:
//   unset  — no confinement; every spawn still carries a `{enforced:false}`
//            descriptor and the Doctor reports it in those words.
//   1      — confine where the host proves it can; where it cannot, run with the
//            ungated label attached. The label is the contract — there is no
//            code path that asks for a boundary and silently does without one.
//   strict — confine or do not run. For a home node taking untrusted work, where
//            "it did not run" is the correct outcome.
export function confineMode() {
  const v = String(pick('ATLAN_CONFINE', 'confine', '')).trim();
  return v === 'strict' ? 'strict' : v === '1' ? 'on' : 'off';
}

// ── the second layer, and the only one a phone can hold ────────────────────
//
// These two are NOT alternatives. confineMode() above builds NAMESPACES
// (unshare + setpriv): a real filesystem and PID boundary, and impossible on an
// unrooted Android device — no GKI arm64 defconfig ships CONFIG_USER_NS, and
// Android's own zygote seccomp filter blocks mount(2) and chroot(2) outright.
//
// declaredTier() below drives a SECCOMP-BPF filter instead, which is the one
// kernel-enforced control that survives on a phone: seccomp(2) is explicitly
// allowlisted for app processes, PRoot does not intercept it, and no_new_privs
// is already set by PRoot's own launcher. Filters cannot be removed, are
// inherited across fork and preserved across execve.
//
// They COMPOSE. Seccomp installs inside a namespace perfectly well, so a host
// with both gets both; a phone gets the seccomp half alone. What seccomp cannot
// do is paths — a filter sees a userspace pointer it must not dereference — so
// it does not replace the namespace layer, it sits beside it.

// Homebuilt confinement tier the run DECLARES (server/src/sandbox/*). This is a
// DECLARATION, not a request: if the device establishes less, the run refuses to
// start and the Doctor names the rung that said no. Fail-closed is measured
// against the declaration and never against an absolute — an absolute rule ("no
// isolation, no run") turns the phone off, and a design that turns the primary
// platform off is a design the operator disables, which is the same outcome as
// no boundary with extra steps.
//
// DEFAULT IS T0. It was briefly T1 on 2026-08-07 and that was WRONG — the
// measurement behind it came from a context Atlan does not run in.
//
// The bare kernel numbers are good. 15/15 on the WSL2 node; 14/15 on a real
// Android 15 kernel (6.6.30-android15, via adb), the single miss being Landlock,
// which is absent until the android16-6.12 GKI. Egress denial passed there — a
// genuine kernel-enforced boundary on the primary platform.
//
// BUT ATLAN RUNS INSIDE PROOT ON THE PHONE, AND UNDER PROOT THE LADDER DROPS TO
// 11/15. Measured, same binary, same box:
//
//   ✗ ptrace-arbitration   RET_TRACE returned 0/Success — something IS between
//                          us and the kernel, which is exactly what this rung
//                          exists to notice
//   ✗ egress-denial        child killed by SIGSYS
//   ✗ selftest-denyset     child killed by SIGSYS
//   ✗ selftest-allowsanity child killed by SIGSYS
//
// The last two are T1 rungs, so under proot a device establishes T0 and a T1
// default would REFUSE EVERY RUN on the platform this project exists for. The
// fail-closed design would have worked perfectly and the product would have been
// unusable. PROOT_NO_SECCOMP=1 does not help (still 11/15), so it is the filter
// STACKING, not proot's acceleration.
//
// The mechanism, and the reason this is fixable rather than fatal: our filter's
// tail is default-deny (rung14 proves it), and a ptrace supervisor makes the
// traced child issue syscalls on proot's behalf that our allow-list never
// listed. They hit the default-deny and die with SIGSYS. Composing with a
// supervisor means the allow-list has to cover what the supervisor itself needs,
// or the launcher has to detect arbitration and adapt. That is engineering work,
// not a wall.
//
// Until then T0 is the honest default, and it is not a silent degrade: its UI
// string says "This run was explicitly allowed to start ungated" in words.
// Measure any device with `node test/phone-ladder.mjs` — run it INSIDE proot,
// because that is where the agents are.
export function declaredTier() {
  const t = process.env.ATLAN_CONFINE_TIER ?? file.confineTier ?? 'T0';
  return /^T[0-3]$/.test(String(t)) ? String(t) : 'T0';
}

// Branding / identity — neutral defaults; a fork sets its own (logo stays a file)
export const BRAND = {
  name: file.brand?.name ?? 'Atlan',
  contactEmail: process.env.ATLAN_CONTACT_EMAIL ?? file.brand?.contactEmail ?? 'admin@localhost',
};
