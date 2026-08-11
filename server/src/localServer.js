// localServer.js — start/stop llama-server as a managed process, from the cockpit.
//
// localmodels.js swaps WHICH model a systemd-managed llama-server serves — the
// home-node shape. The phone has no systemd: llama-server is a binary you launch
// by hand in Termux, which is exactly the friction that makes the offline
// local-model → build loop a chore (start it to write, kill it to free RAM for
// gradle, on a 4GB phone that cannot hold both). This is the one-button toggle.
//
// DETECTED, NOT HARDCODED. The binary and model are found on disk (overridable
// by env), so this is not welded to one phone's paths. `available()` is false
// where neither is present, and the UI hides the button — an honest capability,
// never a dead control.
//
// SPAWN ARGS ARE NOT CLIENT INPUT. The client sends only start/stop. The binary,
// model and args come from config/detection, so nothing user-supplied reaches
// the process table.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { FLEET_DIR, LOCAL_LLM_BASE } from './config.js';

const HOME = homedir();
const PID_FILE = join(FLEET_DIR, 'llama.pid');
const LOG_FILE = join(FLEET_DIR, 'llama.log');
const PORT = (() => { try { return new URL(LOCAL_LLM_BASE).port || '8080'; } catch { return '8080'; } })();
const HOST = (() => { try { return new URL(LOCAL_LLM_BASE).hostname || '127.0.0.1'; } catch { return '127.0.0.1'; } })();
const MODELS_DIR = process.env.ATLAN_MODELS_DIR ?? join(HOME, 'models');

/** The llama-server binary: env override, then the two common on-device layouts. */
export function resolveBin() {
  const cands = [
    process.env.ATLAN_LLAMA_BIN,
    join(HOME, 'llama.cpp/build/bin/llama-server'),
    join(HOME, 'llama.cpp/llama-server'),
    '/usr/bin/llama-server', '/usr/local/bin/llama-server',
  ].filter(Boolean);
  return cands.find((p) => existsSync(p)) ?? null;
}

/**
 * The model to serve: env override, else the biggest real instruct model in the
 * models dir. Vocab-only test files (ggml-vocab-*) and the active.gguf symlink
 * are not models and are skipped — picking one loads a tokenizer that answers
 * nothing.
 */
export function resolveModel() {
  if (process.env.ATLAN_LLAMA_MODEL && existsSync(process.env.ATLAN_LLAMA_MODEL)) return process.env.ATLAN_LLAMA_MODEL;
  let best = null;
  try {
    for (const f of readdirSync(MODELS_DIR)) {
      if (!f.endsWith('.gguf') || f === 'active.gguf' || f.startsWith('ggml-vocab')) continue;
      const p = join(MODELS_DIR, f);
      const size = statSync(p).size;
      if (size < 50_000_000) continue; // a real model is tens+ of MB, not a vocab
      if (!best || size > best.size) best = { path: p, size };
    }
  } catch { /* no models dir */ }
  return best?.path ?? null;
}

/** True when a start button would have both a binary and a model to work with. */
export function available() { return !!resolveBin() && !!resolveModel(); }

function pidAlive() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    if (!pid) return 0;
    process.kill(pid, 0); // throws if gone
    return pid;
  } catch { return 0; }
}

/** Health/liveness: probe the server, and report the loaded model when up. */
export async function status() {
  const bin = resolveBin();
  const model = resolveModel();
  let running = false; let loaded = null;
  try {
    const r = await fetch(`${LOCAL_LLM_BASE}/health`, { signal: AbortSignal.timeout(1500) });
    running = r.ok;
  } catch { /* down */ }
  if (running) {
    try {
      const p = await fetch(`${LOCAL_LLM_BASE}/props`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
      loaded = (p?.model_path ?? p?.default_generation_settings?.model ?? '').split('/').pop() || null;
    } catch { /* props unavailable — still running */ }
  }
  return {
    available: !!bin && !!model,
    running,
    model: loaded ?? (model ? model.split('/').pop() : null),
    base: LOCAL_LLM_BASE,
    managed: !!pidAlive(),
  };
}

/**
 * Start llama-server if it is not already up. --jinja is NOT optional here: it
 * is what turns the tool-calling chat template on, and without it the local
 * model is chat-only (localAgent throws the "restart with --jinja" error). No
 * -t: llama-server auto-sizes threads to the device, which measured faster than
 * pinning a count on this big.LITTLE SoC.
 */
export async function start() {
  const s = await status();
  if (s.running) return { ...s, alreadyRunning: true };
  const bin = resolveBin();
  const model = resolveModel();
  if (!bin) throw new Error('no llama-server binary found (set ATLAN_LLAMA_BIN)');
  if (!model) throw new Error(`no model in ${MODELS_DIR} (set ATLAN_LLAMA_MODEL)`);
  const extra = (process.env.ATLAN_LLAMA_ARGS ?? '--jinja -c 4096 -ngl 0').split(/\s+/).filter(Boolean);
  if (!extra.includes('--jinja')) extra.unshift('--jinja'); // tools depend on it
  const args = [...extra, '-m', model, '--host', HOST, '--port', PORT];
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(bin, args, {
    detached: true, // outlives a cockpit restart; stop() finds it by pid
    stdio: ['ignore', log, log],
    // The binary links its sibling .so files; give it their dir so it loads
    // without a system-wide install.
    env: { ...process.env, LD_LIBRARY_PATH: `${dirname(bin)}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  // Wait for the model to finish loading (health flips 503 → 200).
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${LOCAL_LLM_BASE}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return { ...(await status()), started: true };
    } catch { /* still loading */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('llama-server did not become healthy in 120s — see .fleet/llama.log');
}

/** Stop the managed server. Kills the tracked pid, with a name backstop. */
export async function stop() {
  const pid = pidAlive();
  if (pid) { try { process.kill(pid); } catch { /* already gone */ } }
  // Backstop: a server started outside the cockpit (hand-launched) has no pid
  // file; kill by the exact binary path so this button is trustworthy.
  const bin = resolveBin();
  if (bin) { try { spawn('pkill', ['-f', bin]); } catch { /* pkill may be absent */ } }
  rmSync(PID_FILE, { force: true });
  await new Promise((r) => setTimeout(r, 800));
  return status();
}
