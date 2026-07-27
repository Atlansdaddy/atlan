// ONE source of truth for "does this text look like a secret", the same way
// guards.js is the one source of truth for path safety. Used by the git egress
// gate, and by the debugger if it ever ships.
//
// This is a LAST-LINE check on data about to leave the box, not a vault. It
// looks for shapes, so it will miss a secret with no recognisable shape — it
// can prove something IS suspicious, never that a diff is clean. Treat a null
// result as "nothing matched", not as "safe".
//
// Findings deliberately carry the KIND and the location, never the matched
// bytes: a gate that echoes the secret it caught into a response body (and from
// there into a log, a screenshot, or a chat transcript) has leaked it itself.

export const SECRET_PATTERNS = [
  ['private-key-block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ['openai-key', /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['xai-key', /\bxai-[A-Za-z0-9-]{16,}/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['assigned-credential', /\b(?:api[_-]?key|secret|token|password|passwd|credential)\b\s*[:=]\s*['"][^'"\n]{8,}['"]/i],
  ['env-assigned-credential', /^\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*=\s*\S{8,}/m],
];

// Returns the distinct kinds matched — no values, no offsets that could be used
// to reconstruct one.
export function scanForSecrets(text) {
  const s = String(text || '');
  const kinds = [];
  for (const [kind, re] of SECRET_PATTERNS) {
    if (re.test(s)) kinds.push(kind);
  }
  return kinds;
}

export function looksSecret(text) {
  return scanForSecrets(text).length > 0;
}
