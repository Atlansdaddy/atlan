// src/lib/probes/_internal/masking.js
//
// Comment/string/template-literal masking helpers + placeholder-name
// detection shared by probeSecrets, probeAuthWeakness, probeMCPSecurity,
// and probeClientAuthStorage. Extracted from the prior builtin.js
// monolith when it crossed the file-size HIGH threshold. The functions
// themselves are byte-identical to the original; only the location moved.

// Substrings inside a regex-matched value that obviously mark the value as a
// placeholder rather than a real secret. The list is intentionally broad
// because the cost of a single FP placeholder match is high (every "your-key"
// firing trains users to ignore the panel). False negatives from a real
// secret that happens to embed one of these substrings are improbable and
// would still be caught at runtime by the issuing service's own scanner.
//
// Matches: `AKIAXXXXXXXXXXXXXXXX`, `sk_live_xxxxxxxxxxxxxxxxxxxx`,
// `xoxb-REPLACE-ME-WITH-A-REAL-BOT-TOKEN`, `xoxp-DEMO-DEMO-DEMO-DEMO`,
// `sk-proj-REPLACE_THIS_BEFORE_RUNNING_LOCALLY`,
// `AKIAIOSFODNN7EXAMPLE` (the AWS-published documentation value),
// `<your-key-here>`.
export const SECRET_VALUE_PLACEHOLDER_RE =
  /x{4,}|REPLACE[_\-]?(?:ME|THIS|HERE|WITH|YOUR)?|YOUR[_\-]?(?:KEY|API|TOKEN|SECRET|PRIVATE|SLACK|AWS|STRIPE|OPENAI|ANTHROPIC|GITHUB|GOOGLE|[A-Z]+)[_\-A-Z]*HERE|YOUR[_\-]?(?:KEY|API|TOKEN|SECRET|PRIVATE)|PLACEHOLDER|DEMO[_\-]?(?:DEMO|TOKEN|KEY)?|EXAMPLE|<[^<>]+>|\{\{[^}]+\}\}|CHANGE[_\-]?ME|\bTODO(?:[_\-]\w+)*\b|FILL[_\-]?(?:IN|ME|HERE)|^stub[._-]/i;

// True when the match's enclosing statement assigns to a variable whose
// name explicitly marks it as a sample/example/test/fake fixture, e.g.
// `const SAMPLE_OPENAI_KEY = 'sk-proj-...'` or `const FAKE_STRIPE = 'sk_live_...'`.
// Both signals — explicit naming AND value shape — are required for suppression;
// generic names like `API_KEY` or `AWS_SECRET` continue to fire, since those
// are exactly what real leaked code looks like.
export const PLACEHOLDER_VAR_NAME_RE =
  /\b(?:SAMPLE|EXAMPLE|FAKE|DUMMY|MOCK|FIXTURE|PLACEHOLDER|STUB|NOT_?A_?REAL|TEST_(?:KEY|TOKEN|SECRET|API))[_A-Z0-9]*\s*[:=]/;
export function isMatchInPlaceholderNamedAssignment(content, matchIndex) {
  // Check the entire line containing the match. Looking only at content BEFORE
  // the match misses cases where a sibling secret pattern matches mid-identifier
  // (e.g. Generic-Hardcoded-Secret matching `API_KEY = "..."` from inside
  // TEST_API_KEY — the LHS identifier sits partly after the match index).
  const lineStart = content.lastIndexOf('\n', matchIndex - 1) + 1;
  const lineEnd = content.indexOf('\n', matchIndex);
  const line = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
  return PLACEHOLDER_VAR_NAME_RE.test(line);
}

// True when the match site lies inside a single-line // comment or an
// unterminated /* */ block comment. A documentation comment naming a secret
// shape ("// AKIAIOSFODNN7EXAMPLE is the AWS-documented sample value") is
// teaching, not leaking; suppress.
export function isMatchInsideComment(content, matchIndex) {
  const lineStart = content.lastIndexOf('\n', matchIndex - 1) + 1;
  const beforeOnLine = content.slice(lineStart, matchIndex);
  // // comment opened earlier on this line, before the match
  if (/\/\//.test(beforeOnLine)) return true;
  // Inside a /* ... */ block that opens before the match and hasn't closed
  const lastOpen = content.lastIndexOf('/*', matchIndex);
  if (lastOpen === -1) return false;
  const closeAfterOpen = content.indexOf('*/', lastOpen);
  if (closeAfterOpen === -1 || closeAfterOpen > matchIndex) return true;
  return false;
}

// Whole-file content masker. Walks the content
// once, replacing the *interior* of multi-line `/* ... */` blocks, `//` line
// comments, and `'`/`"`/backtick string literals with spaces while preserving
// every newline and the opening/closing delimiters themselves. The output has
// the same line count and same indices as the input, so probes that emit
// line numbers and slice positions stay correct. This is the version
// structural probes should use when the FP set includes patterns hidden
// inside multi-line comments or template-literal docstrings.
// Narrower mask for probes that scan per-line for real code patterns inside
// string literals (e.g. `localStorage.setItem('jwt', token)` — the literal
// 'jwt' MUST stay visible). This mask blanks only block comments, line
// comments, and BACKTICK template literals. Single/double-quoted string
// content is preserved. Indices and newlines preserved.
export function maskBlockCommentsAndTemplateLiterals(content) {
  if (typeof content !== 'string' || content.length === 0) return content || '';
  const out = [];
  const len = content.length;
  let i = 0;
  const blankExceptNewline = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < len) {
    const c = content[i];
    const c2 = i + 1 < len ? content[i + 1] : '';
    if (c === '/' && c2 === '*') {
      out.push('/', '*');
      const end = content.indexOf('*/', i + 2);
      if (end === -1) {
        for (let j = i + 2; j < len; j++) out.push(blankExceptNewline(content[j]));
        return out.join('');
      }
      for (let j = i + 2; j < end; j++) out.push(blankExceptNewline(content[j]));
      out.push('*', '/');
      i = end + 2;
      continue;
    }
    if (c === '/' && c2 === '/') {
      out.push('/', '/');
      let j = i + 2;
      while (j < len && content[j] !== '\n') {
        out.push(' ');
        j++;
      }
      i = j;
      continue;
    }
    if (c === '`') {
      out.push('`');
      let j = i + 1;
      while (j < len) {
        if (content[j] === '\\' && j + 1 < len) {
          out.push(blankExceptNewline(content[j]));
          out.push(blankExceptNewline(content[j + 1]));
          j += 2;
          continue;
        }
        if (content[j] === '`') break;
        out.push(blankExceptNewline(content[j]));
        j++;
      }
      if (j >= len) return out.join('');
      out.push('`');
      i = j + 1;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

export function maskCommentsAndStringsFromContent(content) {
  if (typeof content !== 'string' || content.length === 0) return content || '';
  const out = [];
  const len = content.length;
  let i = 0;
  const blankExceptNewline = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < len) {
    const c = content[i];
    const c2 = i + 1 < len ? content[i + 1] : '';
    // /* block comment (may span lines)
    if (c === '/' && c2 === '*') {
      out.push('/', '*');
      const end = content.indexOf('*/', i + 2);
      if (end === -1) {
        for (let j = i + 2; j < len; j++) out.push(blankExceptNewline(content[j]));
        return out.join('');
      }
      for (let j = i + 2; j < end; j++) out.push(blankExceptNewline(content[j]));
      out.push('*', '/');
      i = end + 2;
      continue;
    }
    // // line comment
    if (c === '/' && c2 === '/') {
      out.push('/', '/');
      let j = i + 2;
      while (j < len && content[j] !== '\n') {
        out.push(' ');
        j++;
      }
      i = j;
      continue;
    }
    // String literal: ' " or backtick. Template literals can span lines.
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out.push(quote);
      let j = i + 1;
      while (j < len) {
        if (content[j] === '\\' && j + 1 < len) {
          // Skip escape and the character it escapes; blank both, preserve newlines.
          out.push(blankExceptNewline(content[j]));
          out.push(blankExceptNewline(content[j + 1]));
          j += 2;
          continue;
        }
        if (content[j] === quote) break;
        out.push(blankExceptNewline(content[j]));
        j++;
      }
      if (j >= len) return out.join(''); // unterminated string; trail consumed
      out.push(quote);
      i = j + 1;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

// True when a Private Key Block match should be SUPPRESSED. Two cases:
//   1. A matching END marker exists nearby and the body contains placeholder
//      markers (the canonical "documentation PEM" shape).
//   2. No END marker exists within a reasonable window — this is a framing
//      reference, not a key. Real PEM blocks always pair BEGIN and END within
//      ~50 lines because the body is dense base64; an unaccompanied BEGIN is
//      either a constant naming the framing (`export const BEGIN = '-----...'`)
//      or a documentation snippet truncated to the header.
export function isPEMBodyPlaceholderOrHeaderOnly(content, beginIndex) {
  const afterBegin = content.slice(beginIndex);
  const endIdx = afterBegin.search(/-----END /);
  // No END within the search window: framing-only reference, suppress.
  if (endIdx === -1) return true;
  if (endIdx > 4000) return true; // body too far to be a real PEM body
  const body = afterBegin.slice(0, endIdx);
  // Placeholder markers in the body (REPLACE_WITH_YOUR_KEY, EXAMPLE, ...).
  if (SECRET_VALUE_PLACEHOLDER_RE.test(body)) return true;
  // Framing-as-constants shape: `const BEGIN = '-----BEGIN ...'; const END = '-----END ...'`.
  // Real PEM bodies are dense base64 lines with no JS quotes, semicolons, or
  // language keywords. The presence of any of those between BEGIN and END
  // means we're looking at code that declares the framing as constants, not
  // a key body. Suppress.
  if (/['";]|\bexport\b|\bconst\b|\blet\b|\bvar\b|\bfunction\b/.test(body)) return true;
  return false;
}

// True when the match site lies inside a backtick-delimited template literal
// that is NOT itself the value being assigned to a variable (i.e., the
// template literal contains text that LOOKS like code — a documentation
// snippet, JSX child string, or similar). The simplest reliable signal is
// the parity of unescaped backticks before the match: an odd count means
// the match is between opening and closing backticks of a template literal.
//
// This produces a small recall sacrifice on the rare case of a secret stored
// in a template literal that wraps the value (e.g. `const k = `sk-live-...`;`)
// but eliminates the much more common precision failure: documentation
// strings that quote a secret-shaped example via backticks. The recall risk
// is acceptable because secrets pinned via backticks are unusual in real
// code; production keys are almost always pinned via single or double quotes.
export function isMatchInsideTemplateLiteral(content, matchIndex) {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (content[i] === '\\' && i + 1 < content.length) {
      i++;
      continue;
    }
    if (content[i] === '`') count++;
  }
  return count % 2 === 1;
}
