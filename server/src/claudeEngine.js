import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';

// One ClaudeSession per WS client per project cwd. Turn-based: each prompt()
// is a query() resumed from the last session id, which is also what makes
// `claude --resume <id>` from Termux pick up the exact same conversation.
export class ClaudeSession {
  constructor({ cwd = '/root', model = 'claude-fable-5', send }) {
    this.cwd = cwd;
    this.model = model;
    this.send = send;
    this.sessionId = null;
    this.pendingPerms = new Map();
    this.busy = false;
  }

  resolvePermission(id, approved) {
    const resolve = this.pendingPerms.get(id);
    if (!resolve) return;
    this.pendingPerms.delete(id);
    resolve(approved);
  }

  async prompt(text) {
    if (this.busy) {
      this.send({ t: 'chat.err', msg: 'Still working the current turn — it will finish or you can kill it.' });
      return;
    }
    this.busy = true;
    this.send({ t: 'atlan.mood', mood: 'building' });
    // Immediate feedback so the turn never feels dead: the UI shows a working
    // pulse the instant this fires, before the model has produced a token.
    this.send({ t: 'chat.turnstart' });
    try {
      const q = query({
        prompt: text,
        options: {
          cwd: this.cwd,
          model: this.model,
          // settingSources:[] is a SECURITY boundary, not a preference: without it
          // the SDK loads ~/.claude + project settings.local.json, whose accumulated
          // "always allow" rules (and auto-approved sandboxed Bash) let tools run
          // WITHOUT ever hitting canUseTool — i.e. no permission card. The fleet was
          // hardened against exactly this; the interactive Chat path must match, or
          // "every dangerous tool asks you first" is a lie (boundary-honesty audit,
          // 2026-07-22). Empty = only the permission card below decides.
          settingSources: [],
          // Stream partial messages so text + thinking flow token-by-token
          // instead of landing in one dead-air lump. thinking:adaptive lets the
          // model reason visibly; the UI renders it in a collapsible panel.
          includePartialMessages: true,
          thinking: { type: 'adaptive' },
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
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          this.sessionId = m.session_id;
          this.send({ t: 'chat.session', id: m.session_id, cwd: this.cwd });
        } else if (m.type === 'stream_event') {
          // Live deltas — the whole point of the streaming fix.
          const ev = m.event;
          if (ev?.type === 'content_block_start') {
            const t = ev.content_block?.type;
            if (t === 'thinking') this.send({ t: 'chat.thinkstart' });
            else if (t === 'text') this.send({ t: 'chat.textstart' });
          } else if (ev?.type === 'content_block_delta') {
            const d = ev.delta;
            if (d?.type === 'text_delta') this.send({ t: 'chat.delta', text: d.text });
            else if (d?.type === 'thinking_delta') this.send({ t: 'chat.think', text: d.thinking });
          }
        } else if (m.type === 'assistant') {
          // Text + thinking already streamed above; here we only surface tool
          // calls (their inputs arrive complete on this message).
          for (const block of m.message?.content ?? []) {
            if (block.type === 'tool_use') this.send({ t: 'tool.use', name: block.name, input: preview(block.input) });
          }
        } else if (m.type === 'result') {
          if (m.session_id) this.sessionId = m.session_id;
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
      this.send({ t: 'chat.err', msg: String(err?.message ?? err) });
      this.send({ t: 'atlan.mood', mood: 'alarmed' });
    } finally {
      this.busy = false;
      for (const resolve of this.pendingPerms.values()) resolve(false);
      this.pendingPerms.clear();
    }
  }
}

// Trim tool inputs so a giant Write payload doesn't flood the WS/UI.
function preview(input) {
  const s = JSON.stringify(input ?? {});
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}
