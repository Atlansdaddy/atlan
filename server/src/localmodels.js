import { existsSync, readdirSync, statSync, readlinkSync, readFileSync, writeFileSync, symlinkSync, renameSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

// Local model picker — swap which GGUF llama-server serves, from the cockpit.
// Only real where this node manages llama-server the systemd way (a models
// dir with an active.gguf symlink + systemctl on PATH — the home-node shape).
// Anywhere else `supported` is false and the UI hides the whole card:
// honest capability, never a broken button.
const MODELS_DIR = process.env.ATLAN_MODELS_DIR ?? '/root/models';
const ACTIVE = join(MODELS_DIR, 'active.gguf');
const ARGS_FILE = join(MODELS_DIR, 'models.json'); // { "<name>.gguf": "--extra --args" }
const DEFAULTS_FILE = '/etc/default/llama-server'; // unit reads LLAMA_EXTRA_ARGS from here
const SERVICE = 'llama-server.service';
const HEALTH = 'http://127.0.0.1:8080/health';

function supported() {
  try { return !!readlinkSync(ACTIVE) && existsSync('/usr/bin/systemctl'); } catch { return false; }
}
const loadArgs = () => { try { return JSON.parse(readFileSync(ARGS_FILE, 'utf8')); } catch { return {}; } };

export function localModels() {
  if (!supported()) return { supported: false, active: null, models: [] };
  const args = loadArgs();
  const active = readlinkSync(ACTIVE).split('/').pop();
  const models = readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith('.gguf') && f !== 'active.gguf')
    .map((f) => ({
      name: f,
      gb: +(statSync(join(MODELS_DIR, f)).size / 1e9).toFixed(1),
      args: args[f] ?? '',
      active: f === active,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { supported: true, active, models };
}

const run = (cmd, a) => new Promise((res, rej) => execFile(cmd, a, (e, out) => (e ? rej(e) : res(out))));

export async function activateLocalModel(name) {
  if (!supported()) throw new Error('local model swap not supported on this node');
  if (!/^[\w.+-]+\.gguf$/.test(name) || name === 'active.gguf') throw new Error('bad model name');
  const file = join(MODELS_DIR, name);
  if (!existsSync(file)) throw new Error(`no such model: ${name}`);
  const extra = loadArgs()[name] ?? '';
  // Order matters: defaults file, then symlink (atomic rename), then restart —
  // dying mid-way leaves a coherent old-or-new pair, never a silent mismatch.
  let d = '';
  try { d = readFileSync(DEFAULTS_FILE, 'utf8'); } catch { /* fresh file */ }
  d = /^LLAMA_EXTRA_ARGS=/m.test(d)
    ? d.replace(/^LLAMA_EXTRA_ARGS=.*$/m, `LLAMA_EXTRA_ARGS="${extra}"`)
    : `${d}${d === '' || d.endsWith('\n') ? '' : '\n'}LLAMA_EXTRA_ARGS="${extra}"\n`;
  writeFileSync(DEFAULTS_FILE, d);
  const tmp = `${ACTIVE}.next`;
  rmSync(tmp, { force: true });
  symlinkSync(file, tmp);
  renameSync(tmp, ACTIVE);
  await run('systemctl', ['restart', SERVICE]);
  for (let i = 0; i < 90; i++) { // big models take a minute to load
    try {
      const r = await fetch(HEALTH, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return { ok: true, active: name };
    } catch { /* still loading */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${name} is loading slow or failed — check: journalctl -u llama-server`);
}
