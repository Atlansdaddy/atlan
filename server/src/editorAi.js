import { engineRoster, brainChat, resolveBrain } from './brains.js';
import { guardPath } from './guards.js';

// Inline AI edit — the Tier-2 pipe (helis-d). A chat-only brain proposes a
// replacement for the open buffer or the current selection; nothing touches
// disk here. The client applies the result to the CodeMirror buffer and the
// user's manual Save goes back through the guarded /api/file, so this endpoint
// is a *generator*, not a writer. That is why it complements the
// pseudo-assistant's sendToEditor rather than duplicating it: same destination
// (the review canvas), different trigger (edit-in-place vs chat-proposes).
//
// guardPath still runs with blockAppRoot even though we never write: it stops
// the cockpit's own source and credential files from being read INTO a prompt
// and shipped to a third-party brain. Refusal has to happen before the model
// call, not before the disk write.
export async function handleInlineAiEdit(req, res) {
  try {
    const path = String(req.body.path || '').trim();
    const content = String(req.body.content || '');
    const selection = req.body.selection ? String(req.body.selection) : null;
    const instruction = String(req.body.instruction || '').trim();

    if (!path) throw new Error('file path is required');
    if (!instruction) throw new Error('instruction is required');

    guardPath(path, { blockAppRoot: true });

    // The UI's #modelSel can emit an AGENT id (claude/codex/...), which is not
    // a brain and would come back from brainChat as `unknown engine: claude` —
    // his original blind `roster.find(r => r.ready)` also ignored the user's
    // choice entirely. resolveBrain honours a real pick and falls back only
    // when the pick has no hands-free brain behind it.
    const roster = await engineRoster();
    const { provider, model, chosen, fellBack } = await resolveBrain(req.body.engine, req.body.model, roster);

    let prompt = `You are a precise code editor. Modify the code snippet based on the following instruction.
Instruction: ${instruction}

`;
    if (selection) {
      prompt += `Original Selection:\n\`\`\`\n${selection}\n\`\`\`\n\nReturn ONLY the replacement code for this selection. Do not include markdown code block formatting (like \`\`\`), no explanations. Return the exact raw code replacement.`;
    } else {
      prompt += `Full File Content:\n\`\`\`\n${content}\n\`\`\`\n\nReturn ONLY the modified file content. Do not include markdown code block formatting (like \`\`\`), no explanations. Return the exact raw code replacement.`;
    }

    // brainChat reports failure by SENDING a chat.err frame, not by throwing.
    // His mockSend only listened for chat.msg, so an errored call left reply
    // as '' and returned {ok:true, content:''} — and the client's no-selection
    // path does cmEditor.setValue(content), i.e. a failed model call would
    // silently blank the user's file. Capture the error frame and never let an
    // empty body out of here.
    let reply = '', errMsg = null;
    const mockSend = (msg) => {
      if (msg.t === 'chat.msg' && msg.role === 'brain') reply = msg.text;
      if (msg.t === 'chat.err') errMsg = msg.msg;
    };

    await brainChat({
      provider,
      model,
      history: [
        { role: 'system', content: 'You are a raw code replacement generator. You output ONLY valid source code. Never include markdown code fences (```), never explain anything, never apologize, never write conversational filler. Output the raw modified code and nothing else.' },
        { role: 'user', content: prompt },
      ],
      send: mockSend,
    });

    if (errMsg) throw new Error(errMsg);

    let cleanReply = reply.trim();
    if (cleanReply.startsWith('```')) {
      const lines = cleanReply.split('\n');
      if (lines[0].startsWith('```')) lines.shift();
      if (lines[lines.length - 1] === '```') lines.pop();
      cleanReply = lines.join('\n');
    }

    if (!cleanReply) throw new Error('model returned no content — edit not applied');

    res.json({ ok: true, content: cleanReply, engine: chosen, fellBack });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
