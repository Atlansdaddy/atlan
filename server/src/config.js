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

// Branding / identity — neutral defaults; a fork sets its own (logo stays a file)
export const BRAND = {
  name: file.brand?.name ?? 'Atlan',
  contactEmail: process.env.ATLAN_CONTACT_EMAIL ?? file.brand?.contactEmail ?? 'admin@localhost',
};
