// src/lib/personas/index.js
//
// Persona+ registry. Four personas, each a single-purpose entity with an
// activation gate and one or more structured-command modes.
//
//   Sam  — security fix generation (SAM_COMMAND_FULL for Apply Fix,
//          SAM_COMMAND_SNIPPET for Copy Agent Prompt).
//   Demi — Vibe-Aware educational content (DEMI_MODE_AUTHOR for authoring,
//          DEMI_MODE_GRADE for grading content against the voice rules).
//   Drew — design rules enforcement against .preflight/design-rules.yml.
//   Vera — engineering rules enforcement against .preflight/engineering-rules.yml.
//
// All four follow the Persona+ pattern: NAME / FOCUS / BIO / SKILLS / NO_NOS /
// TEMPLATE / ACKNOWLEDGMENT / INSTRUCTIONS, with optional STRUCTURED_COMMANDS
// when a persona ships with more than one input contract.

import sam from './sam.js';
import demi from './demi.js';
import drew from './drew.js';
import vera from './vera.js';

export { sam, demi, drew, vera };

export const PERSONAS = {
  sam,
  demi,
  drew,
  vera,
};

export default PERSONAS;
