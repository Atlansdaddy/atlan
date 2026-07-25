// src/lib/formatters.js
// Result serializers for the four export targets the tool offers:
//   - formatJSON          machine-readable, single-source-of-truth for downstream tooling
//   - formatMarkdown      long-form human-readable (one block per finding, full remediation)
//   - formatPRComment     collapsed <details> block that fits in a GitHub PR review
//   - formatAgentPrompt   instruction-shaped text for pasting into another LLM session
//
// Every export reads the same `results` shape and is pure (no side effects). All
// styling decisions live here so the App component never has to inline ad-hoc string
// templates.

import { SEV_ORDER } from './scoring.js';
import { riskTier } from './theme.js';
import { snippetToText } from './snippet.js';
import sam from './personas/sam.js';

// Severity presence for the severity-aware tier label, so exported reports
// show the same fair tier as the in-app headline (no critical/high present
// => never CRITICAL/HIGH regardless of score).
const sevPresence = (findings) => ({
  hasCritical: findings.some((f) => f.severity === 'critical'),
  hasHigh: findings.some((f) => f.severity === 'high'),
});

export function formatJSON(results) {
  return JSON.stringify(
    {
      schema: 'midatlantic-audit/v1',
      scannedAt: results.scannedAt.toISOString(),
      source: results.source,
      filesScanned: results.filesScanned,
      score: results.score,
      riskTier: riskTier(results.score, sevPresence(results.findings)).label,
      summary: {
        total: results.findings.length,
        bySeverity: results.findings.reduce((a, f) => {
          a[f.severity] = (a[f.severity] || 0) + 1;
          return a;
        }, {}),
      },
      findings: results.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        cwe: f.cwe,
        probe: f.probe,
        title: f.title,
        file: f.file,
        line: f.line,
        evidence: f.evidence,
        remediation: f.remediation,
        snippet: f.snippet
          ? {
              startLine: f.snippet.startLine,
              endLine: f.snippet.endLine,
              text: snippetToText(f.snippet),
            }
          : null,
      })),
    },
    null,
    2
  );
}

export function formatMarkdown(results) {
  const tier = riskTier(results.score, sevPresence(results.findings));
  const sevCounts = results.findings.reduce((a, f) => {
    a[f.severity] = (a[f.severity] || 0) + 1;
    return a;
  }, {});
  const sevLine = SEV_ORDER.filter((s) => sevCounts[s])
    .map((s) => `${sevCounts[s]} ${s}`)
    .join(', ');

  let md = `# PreFlight Security Audit\n\n`;
  md += `- **Risk:** ${tier.label} — score ${results.score} / 100\n`;
  md += `- **Source:** ${results.source}\n`;
  md += `- **Files scanned:** ${results.filesScanned}\n`;
  md += `- **Scanned at:** ${results.scannedAt.toISOString()}\n`;
  md += `- **Findings:** ${results.findings.length}${sevLine ? ` (${sevLine})` : ''}\n\n`;
  md += `---\n\n`;

  results.findings.forEach((f, i) => {
    md += `## ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}\n\n`;
    md += `- **File:** \`${f.file}${f.line ? ':' + f.line : ''}\`\n`;
    md += `- **Category:** ${f.category}\n`;
    md += `- **CWE:** ${f.cwe}\n`;
    md += `- **Probe:** ${f.probe}\n\n`;
    md += `**Evidence**\n\n\`${f.evidence}\`\n\n`;
    if (f.snippet) {
      md += `**Code snapshot** (line ${f.line} marked with \`>\`)\n\n`;
      md += '```\n' + snippetToText(f.snippet) + '\n```\n\n';
    }
    md += `**Remediation**\n\n${f.remediation}\n\n---\n\n`;
  });
  return md;
}

// PR-comment Markdown: fits in a collapsed <details> block, links findings by file path, summary tagline.
export function formatPRComment(results) {
  const tier = riskTier(results.score, sevPresence(results.findings));
  const sevCounts = results.findings.reduce((a, f) => {
    a[f.severity] = (a[f.severity] || 0) + 1;
    return a;
  }, {});
  const top = SEV_ORDER.filter((s) => sevCounts[s]);
  const sevSummary = top.length
    ? top.map((s) => `${sevCounts[s]} ${s}`).join(' · ')
    : 'no findings';
  const titleEmoji = tier.label.startsWith('CRITICAL')
    ? '🟥'
    : tier.label.startsWith('HIGH')
      ? '🟧'
      : tier.label.startsWith('MODERATE')
        ? '🟨'
        : '🟩';

  let md = `## ${titleEmoji} PreFlight Audit — ${tier.label} (${results.score}/100)\n\n`;
  md += `**${results.findings.length} finding${results.findings.length === 1 ? '' : 's'}** · ${sevSummary} · ${results.filesScanned} file${results.filesScanned === 1 ? '' : 's'} scanned\n\n`;
  if (results.findings.length === 0) {
    md += '_No findings from this probe set. Manual IDOR / runtime checks remain out of scope._\n';
    return md;
  }
  md += `<details>\n<summary>Click to expand ${results.findings.length} finding${results.findings.length === 1 ? '' : 's'}</summary>\n\n`;
  // Group by file so the comment shows up next to the code review naturally.
  const byFile = new Map();
  results.findings.forEach((f) => {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  });
  for (const [filePath, fs] of byFile) {
    md += `### \`${filePath}\`\n\n`;
    for (const f of fs) {
      md +=
        `- **[${f.severity.toUpperCase()}]** ${f.title} — ${f.cwe}` +
        (f.line ? ` _(line ${f.line})_` : '') +
        `\n`;
      md += `  _${f.remediation.replace(/\n+/g, ' ').slice(0, 220)}${f.remediation.length > 220 ? '…' : ''}_\n`;
    }
    md += '\n';
  }
  md += `</details>\n\n`;
  md += `<sub>Generated by Mid-Atlantic AI PreFlight Audit Tool · ${results.scannedAt.toISOString()}</sub>\n`;
  return md;
}

// formatAgentPrompt — exports a Sam-shaped batch prompt for pasting into
// the user's own AI environment (Cursor, Claude Code, ChatGPT, etc.).
//
// The output is two parts:
//   1. Sam's INSTRUCTIONS verbatim — the activation contract.
//   2. A batch header + one SAM_COMMAND_SNIPPET per finding.
//
// FILE_CONTENT is intentionally omitted in this mode. The downstream AI the
// user pastes into has its own access to the user's local environment and
// can read the full file from there. Sam's SNIPPET-mode discipline says
// "return FIX_NOT_TRIVIAL when the snippet is insufficient" — which is the
// correct outcome here for fixes that require unseen context. That refusal
// signals to the downstream AI that the fix is harder than it looks.
export function formatAgentPrompt(results) {
  const tier = riskTier(results.score, sevPresence(results.findings));
  const top = results.findings.slice(0, 30);

  let p = '';
  // Persona activation. The receiving AI takes on Sam's role.
  p += sam.INSTRUCTIONS;
  p += '\n\n----------------------------------------------------------------\n\n';

  // Batch context. Tells the receiving AI this is multiple findings at once,
  // and that the activation acknowledgment should be skipped so the user gets
  // outputs directly.
  p += `BATCH CONTEXT\n`;
  p += `You are receiving ${top.length} finding${top.length === 1 ? '' : 's'} from a PreFlight audit `;
  p += `(score ${results.score}/100, ${tier.label}). For each finding below, apply the `;
  p += `SAM_COMMAND_SNIPPET procedure. Output one unified diff OR FIX_NOT_TRIVIAL plus rationale per `;
  p += `finding, separated by a single line containing only "---". Process findings in order.\n\n`;
  p += `Skip the activation acknowledgment for this batch. Produce fix outputs directly.\n\n`;
  p += `Findings ordered highest severity first. A senior application-security engineer reading this prompt should expect SAM_COMMAND_SNIPPET mode throughout.\n\n`;

  // One structured command per finding.
  top.forEach((f, i) => {
    p += `================================================================\n`;
    p += `FINDING ${i + 1} of ${top.length}\n`;
    p += `================================================================\n`;
    p += `COMMAND: SAM_COMMAND_SNIPPET\n`;
    p += `PROBE: ${f.probe} (${f.category}, ${f.cwe})\n`;
    p += `SEVERITY: ${f.severity}\n`;
    p += `FILE_PATH: ${f.file}${f.line ? ':' + f.line : ''}\n`;
    p += `CODE_CONTEXT:\n`;
    if (f.snippet) {
      p += '```\n' + snippetToText(f.snippet) + '\n```\n';
    } else {
      p += '(no code snippet captured by the scanner for this finding)\n';
    }
    p += `EVIDENCE: ${f.evidence}\n`;
    p += `REMEDIATION_HINT: ${f.remediation}\n`;
    p += `FILE_CONTENT: (omitted in SNIPPET mode; if the snippet is insufficient, return FIX_NOT_TRIVIAL)\n\n`;
  });

  if (results.findings.length > top.length) {
    p += `(${results.findings.length - top.length} additional findings omitted to keep the prompt small. Re-export to a JSON file for full data.)\n`;
  }
  return p;
}
