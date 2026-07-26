// src/lib/probes/_internal/const-eval.js
//
// Lightweight same-file constant resolution for sink classifiers.
//
// Real-scan finding 2026-07 (Atlan cockpit): every XSS finding in a 22-finding
// report was a false positive, and all of them for the same reason. The sink
// classifier could tell a string literal from an expression, but it could not
// tell that an expression resolves to a constant:
//
//   const TPL = '<div class="row"></div>';   el.innerHTML = TPL;
//   const bits = `<b>${errCount}</b>`;       el.innerHTML = bits;      // numbers
//   function label(m){ switch(m){ case 1: return '-> vision';
//                                 default: return '-> read'; } }
//   el.innerHTML = label(mode);
//   el.innerHTML = escapeHtml(userText);     // author's own escaper
//
// None of those can carry an injection. Flagging them trains people to ignore
// the probe, which costs more than the finding was ever worth.
//
// This is deliberately NOT a general evaluator. It answers one narrow question
// for one file: "is this identifier or call guaranteed to produce a value the
// author wrote?" Anything it cannot prove, it declines, so the classifier
// falls back to treating the value as taintable.

// `const X = "literal"` / `'literal'` / backtick with no substitution / number.
// Escape sequences are allowed inside the literal, so `const TPL = "<div
// class=\"row\"></div>";` resolves. Without the escape branch the match ended
// at the first inner quote and the binding was missed (Atlan scan 2026-07).
const CONST_LITERAL_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`$\n]*`|-?\d+(?:\.\d+)?)\s*(?:[;,]|$)/gm;

// `const bits = \`<b>${errCount}</b>\`` — a template bound to a name. Whether
// it is constant depends on its substitutions, so it is resolved in a second
// pass once the numeric and literal bindings are known.
const CONST_TEMPLATE_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(`[^`]*`)\s*(?:[;,]|$)/gm;

// A binding whose value is numeric by construction: a number literal, a
// `.length` read, a parseInt/parseFloat/Number() call, or an arithmetic
// expression over those. Numbers cannot carry markup.
const NUMERIC_BINDING_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:-?\d+(?:\.\d+)?|[\w.$[\]]+\.length\b|(?:parseInt|parseFloat|Number)\s*\(|[\w.$]+\s*(?:\+\+|--)|[\w.$]+\s*[-*/%]\s*[\w.$\d]+)/gm;

// A locally defined escaper: a function whose body replaces HTML metacharacters
// or calls a known encoder. Authors routinely write their own two-line
// escapeHtml, and it is a real sanitizer even though it is not on any list.
const LOCAL_SANITIZER_RE =
  /(?:function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\s*)?\([^)]*\)\s*=>)\s*\{?[\s\S]{0,300}?\.replace\s*\(\s*\/\[[^\]]*(?:&|<|>|&amp;|&lt;)[^\]]*\]/g;

// Walk a function body from its opening brace and collect every `return`
// expression. Returns null when the body cannot be bounded confidently.
function returnExpressions(content, bodyStart) {
  let depth = 0;
  let i = bodyStart;
  let started = false;
  for (; i < content.length && i < bodyStart + 4000; i++) {
    const ch = content[i];
    if (ch === '{') {
      depth++;
      started = true;
    } else if (ch === '}') {
      depth--;
      if (started && depth === 0) break;
    }
  }
  if (!started || depth !== 0) return null;
  const body = content.slice(bodyStart, i);
  const returns = [];
  for (const m of body.matchAll(/\breturn\b([^;\n}]*)/g)) returns.push(m[1].trim());
  return returns;
}

/**
 * Map of same-file function name -> body text, for probes that need to look
 * inside a helper rather than only at the call site.
 *
 * Real-scan finding 2026-07: the cookie probe read a 10-line window from the
 * `Set-Cookie` call and reported httpOnly/secure/sameSite missing, when the
 * app built its header in a `cookieHeader()` helper that set all three. The
 * flags were there; the probe was looking at the wrong place and telling the
 * author their working code was insecure.
 */
export function collectFunctionBodies(content) {
  const bodies = new Map();
  if (typeof content !== 'string' || !content) return bodies;
  const decl =
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*=>\s*\{/g;
  for (const m of content.matchAll(decl)) {
    const name = m[1] || m[2];
    if (!name || bodies.has(name)) continue;
    const openIdx = content.indexOf('{', m.index + m[0].length - 1);
    if (openIdx < 0) continue;
    let depth = 0;
    let i = openIdx;
    for (; i < content.length && i < openIdx + 6000; i++) {
      const ch = content[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth === 0) bodies.set(name, content.slice(openIdx, i + 1));
  }
  return bodies;
}

/**
 * Text of `line` plus the bodies of any same-file functions it calls. Lets a
 * probe reason about a value that is assembled elsewhere without pretending
 * to do real interprocedural analysis: one hop, same file, by name.
 */
export function expandCalledHelpers(line, bodies, depth = 1) {
  if (!line || !bodies || bodies.size === 0) return line || '';
  let out = line;
  let frontier = [line];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const chunk of frontier) {
      for (const m of chunk.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        const body = bodies.get(m[1]);
        if (body && !out.includes(body)) {
          out += ' ' + body;
          next.push(body);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return out;
}

/**
 * Read the right-hand side of an assignment starting at `startIdx` in
 * `content`, stopping at the statement boundary rather than the end of the
 * line.
 *
 * Real-scan finding 2026-07 (second pass): a line-anchored regex was the
 * reason 24 XSS false positives survived the first const-eval fix. It broke on
 * every shape real code actually uses:
 *
 *   el.innerHTML = `<div class="card">      <- template continues for 8 lines
 *   const box = $('x'); box.innerHTML = ''; box.style.display = '';
 *   list.innerHTML = '<div class="hint">unreachable</div>'; }
 *
 * The first truncates to an unterminated backtick, the second and third
 * swallow the following statement or a closing brace, and in all three cases
 * the captured text is not a literal so the value reads as taintable.
 *
 * This walks the real expression: it tracks quote and template nesting, so a
 * `;` or newline inside a string or a `${}` does not end it.
 */
export function readAssignedExpression(content, startIdx) {
  let i = startIdx;
  while (i < content.length && /\s/.test(content[i])) i++;
  const start = i;
  let depth = 0; // (), [], {}
  let tmplDepth = 0; // nesting of ${ } inside templates
  let quote = null; // ' " `
  for (; i < content.length && i < start + 8000; i++) {
    const ch = content[i];
    const prev = content[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') {
        if (quote === '`' && tmplDepth > 0) continue;
        quote = null;
      } else if (quote === '`' && ch === '$' && content[i + 1] === '{') {
        tmplDepth++;
        i++;
      } else if (quote === '`' && ch === '}' && tmplDepth > 0) {
        tmplDepth--;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break; // closing brace of the enclosing block
      depth--;
    } else if ((ch === ';' || ch === '\n') && depth === 0) {
      // A newline only ends the statement when the expression looks complete.
      if (ch === ';') break;
      const soFar = content.slice(start, i).trim();
      if (soFar && !/[+\-*/%?:,.&|=([{]$/.test(soFar)) break;
    }
  }
  return content.slice(start, i).trim();
}

const isLiteralExpression = (expr) =>
  /^'[^']*'$/.test(expr) ||
  /^"[^"]*"$/.test(expr) ||
  (/^`[^`]*`$/.test(expr) && !expr.includes('${')) ||
  /^-?\d+(?:\.\d+)?$/.test(expr);

/**
 * Collect the names in `content` that provably produce author-written values.
 *
 * @returns {{constants:Set<string>, numerics:Set<string>, sanitizers:Set<string>, literalFns:Set<string>}}
 */
export function collectSafeBindings(content) {
  const constants = new Set();
  const numerics = new Set();
  const sanitizers = new Set();
  const literalFns = new Set();
  if (typeof content !== 'string' || !content) {
    return { constants, numerics, sanitizers, literalFns };
  }

  for (const m of content.matchAll(CONST_LITERAL_RE)) constants.add(m[1]);
  for (const m of content.matchAll(NUMERIC_BINDING_RE)) numerics.add(m[1]);
  for (const m of content.matchAll(LOCAL_SANITIZER_RE)) {
    const name = m[1] || m[2];
    if (name) sanitizers.add(name);
  }

  // Functions whose every return is a literal. This is the `switch (mode) {
  // case 1: return '-> vision'; default: return '-> read'; }` shape, which is
  // a lookup table written as control flow.
  for (const m of content.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) {
    const returns = returnExpressions(content, m.index + m[0].length - 1);
    if (!returns || returns.length === 0) continue;
    if (returns.every((r) => r === '' || isLiteralExpression(r))) literalFns.add(m[1]);
  }
  for (const m of content.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g
  )) {
    const returns = returnExpressions(content, m.index + m[0].length - 1);
    if (!returns || returns.length === 0) continue;
    if (returns.every((r) => r === '' || isLiteralExpression(r))) literalFns.add(m[1]);
  }

  // Second pass: a name bound to a template literal is constant when every
  // substitution in it is. Repeated so a chain of such bindings settles.
  const bindings = { constants, numerics, sanitizers, literalFns };
  for (let round = 0; round < 3; round++) {
    let added = false;
    for (const m of content.matchAll(CONST_TEMPLATE_RE)) {
      if (constants.has(m[1])) continue;
      if (resolvesToConstant(m[2], bindings)) {
        constants.add(m[1]);
        added = true;
      }
    }
    if (!added) break;
  }

  return bindings;
}

/**
 * True when `expr` resolves to something the author wrote, given the bindings
 * collected from the same file. Conservative: unknown means false.
 */
export function resolvesToConstant(expr, bindings) {
  if (!expr || !bindings) return false;
  const e = expr.trim();

  // A literal is a constant. This was missing, and it mattered: the function
  // was written to resolve identifiers and calls, with literals handled by the
  // caller, so every compound expression whose PARTS are literals — a ternary
  // between two strings, a concatenation of two strings — failed here.
  if (isLiteralExpression(e)) return true;

  // Concatenation of constants is a constant.
  //   row.innerHTML = html + '<button class="rowdel">x</button>';
  if (e.includes('+')) {
    const parts = splitTopLevel(e, '+');
    if (parts.length > 1 && parts.every((p) => resolvesToConstant(p, bindings))) return true;
  }

  // A bare identifier bound to a literal or a numeric value.
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    return bindings.constants.has(e) || bindings.numerics.has(e);
  }

  // A call of a local sanitizer or of a function that only returns literals.
  const call = e.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call && (bindings.sanitizers.has(call[1]) || bindings.literalFns.has(call[1]))) return true;

  // A ternary whose branches are all constants is a constant. Real code picks
  // between two bits of static markup constantly:
  //   box.innerHTML = items.length ? '' : '<div class="hint">none yet</div>';
  if (e.includes('?') && e.includes(':')) {
    const branches = ternaryBranches(e);
    if (branches && branches.every((b) => resolvesToConstant(b, bindings))) return true;
  }

  // A template literal whose every substitution is safe. The markup around the
  // holes is the author's; the question is only what goes in the holes.
  if (/^`[\s\S]*`$/.test(e)) {
    const subs = templateSubstitutions(e);
    if (subs.length === 0) return true;
    return subs.every((s) => isSafeSubstitution(s, bindings));
  }

  return false;
}

// Split on a binary operator at nesting depth zero, ignoring occurrences
// inside strings, templates, parens or brackets.
function splitTopLevel(expr, op) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let last = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === op && depth === 0) {
      parts.push(expr.slice(last, i).trim());
      last = i + 1;
    }
  }
  parts.push(expr.slice(last).trim());
  return parts.filter(Boolean);
}

// Split a ternary into its two branches, ignoring `?` and `:` that sit inside
// strings, templates or nested parens.
function ternaryBranches(expr) {
  let depth = 0;
  let quote = null;
  let qIdx = -1;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === '?' && depth === 0 && expr[i + 1] !== '.' && expr[i + 1] !== '?') {
      qIdx = i;
      break;
    }
  }
  if (qIdx < 0) return null;
  depth = 0;
  quote = null;
  for (let i = qIdx + 1; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ':' && depth === 0) {
      return [expr.slice(qIdx + 1, i).trim(), expr.slice(i + 1).trim()];
    }
  }
  return null;
}

// Substitutions of a template literal, tolerant of nested braces inside `${}`.
function templateSubstitutions(tmpl) {
  const out = [];
  for (let i = 0; i < tmpl.length - 1; i++) {
    if (tmpl[i] !== '$' || tmpl[i + 1] !== '{') continue;
    let depth = 1;
    let j = i + 2;
    for (; j < tmpl.length && depth > 0; j++) {
      if (tmpl[j] === '{') depth++;
      else if (tmpl[j] === '}') depth--;
    }
    out.push(tmpl.slice(i + 2, j - 1).trim());
    i = j - 1;
  }
  return out;
}

// A substitution is safe when it cannot introduce markup: a number, a
// same-file constant, a length read, a value passed through a sanitizer, or a
// ternary of those.
function isSafeSubstitution(s, bindings) {
  if (!s) return true;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return true;
  if (bindings.numerics.has(s) || bindings.constants.has(s)) return true;
  if (/\.length$/.test(s)) return true;
  // escapeHtml(x) inside a hole is the whole point of having an escaper.
  if (HTML_SANITIZER_IN_SUB.test(s)) return true;
  const call = s.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call && (bindings.sanitizers.has(call[1]) || bindings.literalFns.has(call[1]))) return true;
  const branches = ternaryBranches(s);
  if (branches && branches.every((b) => isSafeSubstitution(b, bindings))) return true;
  return false;
}

const HTML_SANITIZER_IN_SUB =
  /\b(?:DOMPurify\s*\.\s*sanitize|sanitizeHtml|escapeHtml|escape_html|he\s*\.\s*encode|validator\s*\.\s*escape)\s*\(/;
