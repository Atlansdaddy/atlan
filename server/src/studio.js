// Studio — generation surfaces. Image first (ARCHITECTURE.md: "studio surfaces
// (image gen first, then music/audio)").
//
// The whole point: generate on the user's OWN SUBSCRIPTION, never a metered key.
// Codex CLI ships a built-in `image_gen` tool whose own SKILL.md states it
// "Does not require OPENAI_API_KEY" — it runs on the ChatGPT Plus/Pro login the
// codex engine is already authed with. Its CLI fallback (scripts/image_gen.py)
// DOES need a key and bills per image, so we never invoke that path.
//
// Why Atlan collects the file instead of asking Codex to save it:
// Codex copies its output through its own bubblewrap sandbox, and bwrap cannot
// create user namespaces under proot ("Creating new namespace failed") — so on
// the phone every agent-side `cp` fails even though the image generated fine.
// Atlan's Node is not sandboxed, so it reads the artifact directly out of
// $CODEX_HOME/generated_images/<thread_id>/ and files it as a normal attachment.
// That turns a hard phone-only blocker into a non-event.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { saveUpload } from './attachments.js';

const CODEX_HOME = process.env.CODEX_HOME ?? `${process.env.HOME ?? '/root'}/.codex`;
const GEN_DIR = join(CODEX_HOME, 'generated_images');
const TIMEOUT_MS = 300000;

export function studioRoster() {
  const codexReady = existsSync(join(CODEX_HOME, 'auth.json')) || existsSync(CODEX_HOME);
  return [{
    id: 'codex-image',
    kind: 'image',
    label: 'Image — Codex (ChatGPT subscription)',
    cost: 'subscription (no per-image billing)',
    ready: codexReady,
    needs: codexReady ? null : 'sign in: codex (Term tab)',
    note: 'built-in image_gen tool; game sprites/textures/mockups. Transparency via chroma-key removal.',
  }, {
    // Named honestly rather than hidden: the research found no sanctioned
    // subscription path for these. Veo 3.1 / Lyria 3 exist but only inside
    // Google Vids/Flow (web apps); their APIs are key-billed. Listing them as
    // "not available" beats a surface that silently can't deliver.
    id: 'video', kind: 'video', label: 'Video', ready: false,
    needs: 'no subscription-programmatic path exists (Veo is web-app or key-billed)',
  }, {
    id: 'music', kind: 'audio', label: 'Music', ready: false,
    needs: 'no subscription-programmatic path exists (Lyria is web-app or key-billed)',
  }];
}

// Newest .png under generated_images/<thread_id>/, or null. Scoped to the thread
// so a concurrent generation in another chat can't hand back the wrong asset.
function newestImage(threadId) {
  const dir = threadId ? join(GEN_DIR, threadId) : GEN_DIR;
  if (!existsSync(dir)) return null;
  const pngs = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => ({ f, p: join(dir, f), m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return pngs[0]?.p ?? null;
}

export async function generateImage({ prompt, cwd = process.cwd(), send }) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt required');

  // -s/--sandbox modes cannot initialize under proot (bwrap needs user
  // namespaces), so the bypass flag is the only mode that runs on-device. On a
  // native host this should follow the engine's configured permission level
  // rather than being hardcoded — see the permission-config work.
  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check',
    `Use the built-in image_gen tool to generate this image. Do not use the CLI fallback and do not ask for an API key. Do not try to copy or move the file afterwards — leave it where the tool writes it. Prompt: ${prompt}`];

  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd });
    child.stdin.end();
    let threadId = null, buf = '', stderrTail = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('image generation timed out (5min)')); }, TIMEOUT_MS);

    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'thread.started' && ev.thread_id) threadId = ev.thread_id;
        // Surface the agent's narration so the UI isn't a blank spinner.
        if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) {
          send?.({ t: 'studio.progress', text: ev.item.text });
        }
      }
    });
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-800); });

    child.on('close', async (code) => {
      clearTimeout(timer);
      const path = newestImage(threadId);
      if (!path) {
        return reject(new Error(`no image produced (codex exit ${code})${stderrTail ? ' — ' + stderrTail.trim().slice(-200) : ''}`));
      }
      try {
        // Re-file through saveUpload so it lands in .attachments with a proper
        // kind:'image' and can flow into a chat turn like any other attachment.
        const att = await saveUpload({
          name: `gen-${Date.now()}.png`,
          mime: 'image/png',
          data: readFileSync(path).toString('base64'),
        });
        resolve({ ...att, source: 'codex-image', origin: path });
      } catch (err) { reject(err); }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`codex not runnable: ${err.message}`)); });
  });
}
