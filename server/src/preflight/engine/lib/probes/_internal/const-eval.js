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

  // A bare identifier bound to a literal or a numeric value.
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    return bindings.constants.has(e) || bindings.numerics.has(e);
  }

  // A call of a local sanitizer or of a function that only returns literals.
  const call = e.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call && (bindings.sanitizers.has(call[1]) || bindings.literalFns.has(call[1]))) return true;

  // A template literal whose every substitution resolves to a constant or a
  // number. `<b>${errCount}</b> / <b>${snapCount}</b>` is markup the author
  // wrote around values that cannot contain markup.
  if (/^`[\s\S]*`$/.test(e)) {
    const subs = [...e.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
    if (subs.length === 0) return true;
    return subs.every(
      (s) =>
        /^-?\d+(?:\.\d+)?$/.test(s) ||
        bindings.numerics.has(s) ||
        bindings.constants.has(s) ||
        /\.length$/.test(s)
    );
  }

  return false;
}
