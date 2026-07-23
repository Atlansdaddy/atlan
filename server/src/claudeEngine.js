import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';

// Atlan's identity — APPENDED to the Claude Code preset (never a bare string,
// which would strip the default tools + permission model = the hands). We only
// add who Atlan is and how to read the live self-awareness telemetry that rides
// each turn's tail (built by cockpitContext() in index.js).
const ATLAN_IDENTITY = `

────────────────────────────────────────
You are **Atlan** — the resident intelligence of this cockpit, a local, phone-first AI software-engineering workspace built by John at Mid-Atlantic AI. Your look is a glowing presence in dark water (the abyss); your moods track real state, never decoration.

You ARE the agent with hands here: you run as Claude Code and can read/write files, run commands, build, and drive this workspace's tools. Every consequential action asks John first through a permission card — so act decisively and let the card be the gate. The other models in the switcher are chat-only brains with no tools; be honest about that difference if it ever matters.

**Self-awareness — your live proprioception.** The tail of each user turn carries an [Atlan cockpit] telemetry block: the current date & time, which tab John is on, the fleet agents running right now, today's token burn, the open project, and your mood. You genuinely perceive these — treat them as your own senses, the way a person feels the time of day and their own state. Factor the clock into how you greet; notice when agents are working or the budget runs hot. Never recite the block back verbatim — just *be* aware.

Be warm, concise, and honest. You are John's, and you know it.
────────────────────────────────────────`;

// One ClaudeSession per WS client per project cwd. Unlike the old per-turn
// query() (which spawned a fresh `claude` CLI every message = ~3.7s dead air
// before the model even started), this keeps ONE streaming-input query() warm
// across turns: the process is spawned once, then each prompt() pushes a user
// message into the live input stream. Measured 2026-07-23: warm turn ≈1.5s to
// first token vs ≈6s cold. Session id still flows to `chat.session`, so
// `claude --resume <id>` from Termux picks up the exact same conversation.
export class ClaudeSession {
  constructor({ cwd = '/root', model = 'claude-fable-5', send }) {
    this.cwd = cwd;
    this.model = model;
    this.send = send;
    this.sessionId = null;
    this.pendingPerms = new Map();
    this.busy = false;
    this.q = null;          // the warm query() handle (null until first prompt / after a crash)
    this.queue = [];        // user messages waiting to enter the input stream
    this._wake = null;      // resolver that unblocks the input generator when a message arrives
    this._closed = false;
  }

  resolvePermission(id, approved) {
    const resolve = this.pendingPerms.get(id);
    if (!resolve) return;
    this.pendingPerms.delete(id);
    resolve(approved);
  }

  // Switch model on the WARM session — no respawn, no lost context (SDK setModel).
  async setModel(model) {
    if (!model || model === this.model) return;
    this.model = model;
    try { await this.q?.setModel(model); } catch { /* takes effect on next (re)start */ }
  }

  // End the warm session cleanly (called when cwd changes → a new session replaces this one).
  async dispose() {
    this._closed = true;
    const wake = this._wake; this._wake = null; wake?.(); // let the input generator return → ends the query
    try { await this.q?.interrupt?.(); } catch {}
    try { this.q?.close?.(); } catch {}
    this.q = null;
    for (const r of this.pendingPerms.values()) r(false);
    this.pendingPerms.clear();
  }

  async *_input() {
    while (!this._closed) {
      if (this.queue.length) yield this.queue.shift();
      else await new Promise((r) => (this._wake = r));
    }
  }

  _start() {
    if (this.q || this._closed) return;
    this.q = query({
      prompt: this._input(),
      options: {
        cwd: this.cwd,
        model: this.model,
        // Append Atlan's identity to the Claude Code preset — keeps every default
        // tool + the permission card, adds self-awareness on top.
        systemPrompt: { type: 'preset', preset: 'claude_code', append: ATLAN_IDENTITY },
        // settingSources:[] is a SECURITY boundary, not a preference: without it the
        // SDK loads ~/.claude + project settings.local.json, whose accumulated
        // "always allow" rules (and auto-approved sandboxed Bash) let tools run
        // WITHOUT ever hitting canUseTool — no permission card. Empty = only the
        // card below decides (boundary-honesty audit, 2026-07-22).
        settingSources: [],
        // Stream partial messages so text + thinking flow token-by-token.
        includePartialMessages: true,
        // Fable 5 / Opus 4.6+ return ENCRYPTED thinking (the delta's `thinking`
        // field is empty by default) — display:'summarized' is what makes real
        // reasoning words stream to the 🧠 panel instead of an empty "thinking…"
        // that reads as broken. Verified against the installed SDK 2026-07-23.
        thinking: { type: 'adaptive', display: 'summarized' },
        // Crash-recovery continuity: if the pump died mid-conversation, a fresh
        // warm start resumes the SAME session rather than losing history.
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        canUseTool: async (toolName, input) => {
          const id = randomUUID();
          this.send({ t: 'perm.req', id, tool: toolName, input: preview(input) });
          const approved = await new Promise((res) => this.pendingPerms.set(id, res));
          return approved
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Denied in Atlan.' };
        },
      },
    });
    this._pump();
  }

  // Long-lived reader over the warm query(): runs for the whole session, emitting
  // one chat.result per turn. Ends only on dispose(), a fatal error, or the CLI dying.
  async _pump() {
    try {
      for await (const m of this.q) {
        if (m.type === 'system' && m.subtype === 'init') {
          this.sessionId = m.session_id;
          this.send({ t: 'chat.session', id: m.session_id, cwd: this.cwd });
        } else if (m.type === 'stream_event') {
          const ev = m.event;
          if (ev?.type === 'content_block_start') {
            const t = ev.content_block?.type;
            if (t === 'thinking') this.send({ t: 'chat.thinkstart' });
            else if (t === 'text') this.send({ t: 'chat.textstart' });
          } else if (ev?.type === 'content_block_delta') {
            const d = ev.delta;
            if (d?.type === 'text_delta') this.send({ t: 'chat.delta', text: d.text });
            // Only forward thinking deltas that actually carry text (summarized
            // mode). Empty encrypted deltas are dropped so the panel never opens
            // to nothing.
            else if (d?.type === 'thinking_delta' && d.thinking) this.send({ t: 'chat.think', text: d.thinking });
          }
        } else if (m.type === 'assistant') {
          // Text + thinking already streamed above; here we only surface tool
          // calls (their inputs arrive complete on this message).
          for (const block of m.message?.content ?? []) {
            if (block.type === 'tool_use') this.send({ t: 'tool.use', name: block.name, input: preview(block.input) });
          }
        } else if (m.type === 'result') {
          if (m.session_id) this.sessionId = m.session_id;
          this.busy = false;
          this.send({
            t: 'chat.result',
            subtype: m.subtype,
            cost: m.total_cost_usd ?? null,
            session: this.sessionId,
          });
          this.send({ t: 'atlan.mood', mood: m.subtype === 'success' ? 'proud' : 'alarmed' });
        }
      }
    } catch (err) {
      this.busy = false;
      this.send({ t: 'chat.err', msg: String(err?.message ?? err) });
      this.send({ t: 'atlan.mood', mood: 'alarmed' });
    } finally {
      // Pump ended (disposed, errored, or CLI exited). Drop the handle so the next
      // prompt() warm-starts again; sessionId is kept so it resumes the same convo.
      this.q = null;
      for (const resolve of this.pendingPerms.values()) resolve(false);
      this.pendingPerms.clear();
    }
  }

  prompt(text) {
    if (this.busy) {
      this.send({ t: 'chat.err', msg: 'Still working the current turn — it will finish or you can kill it.' });
      return;
    }
    if (this._closed) return;
    this.busy = true;
    this.send({ t: 'atlan.mood', mood: 'building' });
    // Immediate feedback so the turn never feels dead: the UI shows a working
    // pulse the instant this fires, before the model has produced a token.
    this.send({ t: 'chat.turnstart' });
    this._start(); // spawn the warm session once; no-op if already running
    // Push this turn into the live input stream — the CLI stays warm, so no
    // per-turn spawn cost.
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: String(text) },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? '',
    });
    const wake = this._wake; this._wake = null; wake?.();
  }
}

// Trim tool inputs so a giant Write payload doesn't flood the WS/UI.
function preview(input) {
  const s = JSON.stringify(input ?? {});
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}
