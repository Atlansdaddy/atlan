import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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
// `/root` is the phone/home-node home dir; win32 has no such path, so the
// hardcoded default put PROJECTS_DIR somewhere that cannot exist and every
// guardPath rejected. Ships in the SAME commit as the guards.js separator fix
// on purpose: a win32 projects-root without a win32-aware SENSITIVE test is
// exactly the fail-open combination.
const DEFAULT_PROJECTS = process.platform === 'win32' ? process.cwd() : '/root';
export const PROJECTS_DIR = pick('ATLAN_PROJECTS', 'projectsDir', DEFAULT_PROJECTS);
export const DEFAULT_BUILD_PROJECT = pick('ATLAN_BUILD_PROJECT', 'defaultBuildProject', PROJECTS_DIR);

// Ports
export const PORT = Number(pick('ATLAN_PORT', 'port', 4589));
export const PREVIEW_PORT = Number(pick('ATLAN_PREVIEW_PORT', 'previewPort', 4590));

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

// Homebuilt confinement tier the run DECLARES (server/src/sandbox/*). This is a
// DECLARATION, not a request: if the device establishes less, the run refuses to
// start and the Doctor names the rung that said no. Fail-closed is measured
// against the declaration and never against an absolute — an absolute rule ("no
// isolation, no run") turns the phone off, and a design that turns the primary
// platform off is a design the operator disables, which is the same outcome as
// no boundary with extra steps.
//
// DEFAULT IS T0 EVERYWHERE UNTIL THE ON-DEVICE LADDER IS MEASURED. T0 is not a
// silent degrade: its UI string says "This run was explicitly allowed to start
// ungated" in so many words. The ladder is green on the WSL2 accessory node
// (2026-08-05, 15/15); the PHONE numbers are unmeasured, and the default moves
// to T1 on the commit that attaches a phone transcript — not before. Raising it
// on a device that cannot hold it would refuse every run, which is the correct
// failure and still a bad default to ship blind.
export function declaredTier() {
  const t = process.env.ATLAN_CONFINE_TIER ?? file.confineTier ?? 'T0';
  return /^T[0-3]$/.test(String(t)) ? String(t) : 'T0';
}

// Branding / identity — neutral defaults; a fork sets its own (logo stays a file)
export const BRAND = {
  name: file.brand?.name ?? 'Atlan',
  contactEmail: process.env.ATLAN_CONTACT_EMAIL ?? file.brand?.contactEmail ?? 'admin@localhost',
};
