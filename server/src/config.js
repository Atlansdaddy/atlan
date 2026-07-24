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

// Where the user's code projects are scanned from + the default build target
export const PROJECTS_DIR = pick('ATLAN_PROJECTS', 'projectsDir', '/root');
export const DEFAULT_BUILD_PROJECT = pick('ATLAN_BUILD_PROJECT', 'defaultBuildProject', PROJECTS_DIR);

// Ports
export const PORT = Number(pick('ATLAN_PORT', 'port', 4589));
export const PREVIEW_PORT = Number(pick('ATLAN_PREVIEW_PORT', 'previewPort', 4590));

// Aggregate spend controls (peer review, 2026-07-22): per-run budgets don't
// bound concurrent runs, so a global daily token ceiling + a concurrency cap
// backstop the whole account. 0 = unlimited.
export const DAILY_TOKEN_CAP = Number(pick('ATLAN_DAILY_TOKEN_CAP', 'dailyTokenCap', 5_000_000));
export const MAX_CONCURRENT_RUNS = Number(pick('ATLAN_MAX_CONCURRENT_RUNS', 'maxConcurrentRuns', 6));

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

// Branding / identity — neutral defaults; a fork sets its own (logo stays a file)
export const BRAND = {
  name: file.brand?.name ?? 'Atlan',
  contactEmail: process.env.ATLAN_CONTACT_EMAIL ?? file.brand?.contactEmail ?? 'admin@localhost',
};
