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

// Branding / identity — neutral defaults; a fork sets its own (logo stays a file)
export const BRAND = {
  name: file.brand?.name ?? 'Atlan',
  contactEmail: process.env.ATLAN_CONTACT_EMAIL ?? file.brand?.contactEmail ?? 'admin@localhost',
};
