// personaDraft.js — describe what you want; get the form filled in.
//
// THE PROBLEM THIS IS FOR, IN THE USER'S WORDS: Persona+ is "hella scary to try
// and build and isn't at all easy to work with". That is not a documentation
// gap. Seven fields — NAME, FOCUS, BIO, SKILLS, NO_NOS, TEMPLATE, INSTRUCTIONS —
// ask you to have already decomposed your intent into the framework's shape
// before you are allowed to express it at all. People do not think in schemas.
// They think "I want a reviewer that is brutal about error handling and never
// touches tests".
//
// SO THE FORM STAYS AND THE AI JUST FILLS IT. This is deliberately NOT a chat
// that emits a persona and hides the fields. A filled form is cheap to tweak,
// legible, and free to change; re-prompting to nudge one line is expensive and
// nondeterministic. One shot to a complete draft, then you edit it yourself, or
// keep talking, or both. The artifact is still the artifact.
//
// NOTHING IS SAVED HERE. The draft is returned for review and the user presses
// save — an AI that quietly writes into your persona list is the kind of help
// nobody asked for.

import { compileCommand, compilePersona, listPersonas, templateSchema } from './personas.js';

const S = (v, max = 4000) => String(v ?? '').slice(0, max).trim();
const LIST = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/))
  .map((x) => S(x, 200)).filter(Boolean).slice(0, 24);

/** The instruction the drafting engine gets. Kept here so it has ONE home. */
export function draftPrompt(intent, { kind = 'persona' } = {}) {
  const shape = kind === 'command'
    ? `{"name":"","description":"","variables":[{"name":"","type":"string|number|boolean|enum","required":true,"options":[]}],"template":{},"checkers":[]}`
    : `{"name":"","focus":"","bio":"","skills":[],"no_nos":[],"template":"","instructions":"","profile":"scout|builder|verifier"}`;

  return [
    `You are filling in an Atlan ${kind === 'command' ? 'structured command' : 'Persona+'} form for someone who described what they want in plain language.`,
    '',
    `THEIR REQUEST: ${intent}`,
    '',
    'Rules:',
    '- Reply with ONLY a JSON object of exactly this shape. No prose, no code fences.',
    `  ${shape}`,
    kind === 'persona'
      ? '- FOCUS is the scope limit and it is the most important field: one sentence naming what this persona does and, by implication, what it does not. Vague focus makes a useless persona.'
      : '- VARIABLES become typed parameters; TEMPLATE fields become the constrained answer shape. Prefer few, well-named variables over many.',
    kind === 'persona'
      ? '- NO_NOS are hard prohibitions, phrased as things never to do. If the request implies a boundary, make it explicit here.'
      : '- CHECKERS are deterministic assertions a computer can grade without a model. Only add ones that are genuinely checkable.',
    '- profile: scout is read-only, builder can write, verifier reads and runs checks. Pick the least powerful one that does the job.',
    '- Fill every field with something real. Leaving a field empty puts the work back on the person who asked.',
  ].join('\n');
}

/**
 * Coerce whatever the model returned into the shape upsertPersona accepts.
 *
 * Models return JSON that is ALMOST right — a string where a list belongs, a
 * missing profile, prose wrapped in fences. Refusing that would make the feature
 * feel broken for a reason the user cannot see or fix, so this normalises what
 * it can and reports what it could not, instead of throwing.
 */
export function normaliseDraft(raw, { kind = 'persona' } = {}) {
  let obj = raw;
  if (typeof raw === 'string') {
    const fenced = raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start < 0 || end <= start) return { ok: false, error: 'the engine did not return a JSON object' };
    try { obj = JSON.parse(fenced.slice(start, end + 1)); } catch (e) { return { ok: false, error: `unparseable draft: ${e.message}` }; }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'draft was not an object' };

  if (kind === 'command') {
    return {
      ok: true,
      draft: {
        name: S(obj.name, 80),
        description: S(obj.description, 600),
        variables: Array.isArray(obj.variables) ? obj.variables.slice(0, 24) : [],
        template: obj.template && typeof obj.template === 'object' ? obj.template : {},
        checkers: Array.isArray(obj.checkers) ? obj.checkers.slice(0, 24) : [],
      },
      missing: [!S(obj.name) && 'name', !Object.keys(obj.template ?? {}).length && 'template'].filter(Boolean),
    };
  }

  const draft = {
    name: S(obj.name, 80),
    focus: S(obj.focus, 600),
    bio: S(obj.bio),
    skills: LIST(obj.skills),
    no_nos: LIST(obj.no_nos ?? obj.noNos ?? obj.no_gos),
    template: S(obj.template),
    instructions: S(obj.instructions),
    profile: ['scout', 'builder', 'verifier'].includes(obj.profile) ? obj.profile : 'scout',
  };
  // The two upsertPersona actually refuses on. Reported rather than thrown, so
  // the UI can show the draft with the gaps highlighted instead of an error.
  const missing = [!draft.name && 'name', !draft.focus && 'focus'].filter(Boolean);
  return { ok: true, draft, missing };
}

/**
 * What this persona would COMPILE to — the actual system prompt.
 *
 * The draft is judged on its output, not on how the seven fields read. A form
 * you cannot see the result of is still a form you have to imagine your way
 * through, which is the complaint this whole file is answering. compilePersona
 * takes the same shape upsertPersona stores, so a draft compiles without ever
 * being saved.
 */
export function previewCompiled(draft) {
  try { return compilePersona(draft); } catch { return ''; }
}

export const _testInternals = { S, LIST, compileCommand, listPersonas, templateSchema };
