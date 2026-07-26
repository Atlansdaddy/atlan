// src/lib/probes/v05/adapters/javascript/js-sql-raw-001-template-literal.js
//
// XL-002 adapter for JavaScript / TypeScript. Phase 2 migration of the v0.4
// "SQL Injection" probe (probeSQLInjectionTemplateLiterals in
// src/lib/probes/v05.js). Re-expresses the template-literal interpolation
// detector verbatim against the JS/TS file slice.
//
// shadow:true — the v0.4 probe stays authoritative.
// legacy_finding_id_seed:'SQL Injection' keeps stableId() byte-identical to
// the v0.4 probe so a future shadow:false flip preserves suppressions. The
// v05-phase2 parity test guards against drift from the v0.4 detector.

import { javascriptFiles } from '../../shared-detectors/javascript-scope.js';

const PROBE_NAME = 'JS SQL Injection (XL-002)';

// Verbatim copies of the v0.4 detector constants. The parity test fails if
// these diverge from src/lib/probes/v05.js.
const SQL_PARAMETERIZED_TAGS = new Set(['sql', 'pg', 'postgres', 'slonik', 'drizzle']);
const SQL_RISK_CALLEES =
  /\b(?:db|client|connection|conn|pool|knex|sequelize)\.(?:query|raw|execute|unsafe)\s*\(\s*`/g;
const SQL_BARE_CALLEES = /\b(?:query|execute|raw|unsafe|prepare)\s*\(\s*`/g;
const SQL_HAS_INTERPOLATION = /\$\{[^}]+\}/;

export const JS_SQL_RAW_001 = {
  probe_id: 'JS-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'javascript',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.{js,jsx,ts,tsx,mjs,cjs}',
  what_it_catches:
    'A template literal with ${...} interpolation passed to a db/client/knex/sequelize .query/.raw/.execute call, or a bare query/execute/raw call on a string that looks like SQL. The user value is parsed as SQL, not bound as data.',
  why_ai_v05:
    'Autocomplete emits string interpolation because it is shorter than the parameterized driver call. "Filter where column equals a value" produces a backtick template before it produces a bound parameter.',
  vibe_v05: '"The query is just a string and the value goes in the string."',
  detection_approach:
    'Per line (JS/TS slice): skip safe parameterized tagged templates (sql`...`, pg`...` etc.); flag a risky callee with ${} interpolation in a 4-line span (critical); flag a bare callee + interpolation when the span looks like SQL (high). Identical logic to the v0.4 probe.',
  fp_gates_v05: [
    'parameterized SQL tag libraries (sql, pg, postgres, slonik, drizzle)',
    'template literals with no ${} interpolation',
    'bare callees whose span does not look like SQL',
    'test files / scanner self-source / fixture tree (javascriptFiles())',
  ],
  remediation:
    'Use parameterized queries. pg: db.query("... WHERE id = $1", [id]). Prisma: prisma.user.findUnique({ where: { id } }). Knex: knex("users").where({ id }). Never interpolate user input into the SQL string.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/JS-SQL-RAW-001/positive.js',
    negative: 'src/lib/probes/v05/fixtures/JS-SQL-RAW-001/negative.js',
  },
  known_incidents: 'CWE-89; OWASP A03 Injection',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: 'SQL Injection',
  detect(files) {
    const findings = [];
    for (const file of javascriptFiles(files)) {
      const lines = file.content.split('\n');
      lines.forEach((line, i) => {
        const tagMatch = line.match(/(\w+)`[^`]*\$\{/);
        if (tagMatch && SQL_PARAMETERIZED_TAGS.has(tagMatch[1].toLowerCase())) {
          return;
        }

        const m1 = SQL_RISK_CALLEES.exec(line);
        SQL_RISK_CALLEES.lastIndex = 0;
        const span = lines.slice(i, Math.min(lines.length, i + 4)).join('\n');
        if (m1 && SQL_HAS_INTERPOLATION.test(span)) {
          findings.push({
            id: `sqli-tl-${file.path}-${i}`,
            probe: PROBE_NAME,
            title: 'SQL query built with template-literal interpolation',
            severity: 'critical',
            category: 'Injection',
            cwe: 'CWE-89',
            file: file.path,
            line: i + 1,
            evidence: line.trim().slice(0, 200),
            remediation:
              'Use parameterized queries. The canonical pattern depends on the driver: with `pg` use `db.query("SELECT * FROM users WHERE id = $1", [id])`; with Prisma use `prisma.user.findUnique({ where: { id } })`; with Knex use `knex("users").where({ id })`. The pattern flagged here interpolates user input into the SQL string at parse time, which is the textbook SQL injection.',
          });
          return;
        }

        const m2 = SQL_BARE_CALLEES.exec(line);
        SQL_BARE_CALLEES.lastIndex = 0;
        if (m2 && SQL_HAS_INTERPOLATION.test(span)) {
          const looksLikeSQL = /SELECT |INSERT INTO|UPDATE |DELETE FROM/i.test(span);
          if (looksLikeSQL) {
            findings.push({
              id: `sqli-tl-${file.path}-${i}`,
              probe: PROBE_NAME,
              title: 'Likely SQL query built with template-literal interpolation',
              severity: 'high',
              category: 'Injection',
              cwe: 'CWE-89',
              file: file.path,
              line: i + 1,
              evidence: line.trim().slice(0, 200),
              remediation:
                "This call interpolates user input into a SQL string. Switch to parameterized queries using the driver's built-in placeholder syntax. See the related Learn pattern for driver-specific examples.",
            });
          }
        }
      });
    }
    return findings;
  },
};
