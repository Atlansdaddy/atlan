// src/lib/probes/quality.js
// Code-quality + architecture cluster: console-in-prod, file-size warnings, async-without-
// try/catch, plus the classifyProject() heuristic that infers project shape (static HTML /
// monolithic SPA / modular SPA / monorepo / SSR / unknown) and probeArchitecture which emits
// the classification finding + type-specific teaching findings.

import {
  FILE_SIZE_WARN_LINES,
  FILE_SIZE_MED_LINES,
  FILE_SIZE_HIGH_LINES,
  FILE_SIZE_CRIT_LINES,
} from '../threat-intel.js';
import { isScannerSelfSource, isTestFile } from '../file-filter.js';
import { maskCommentsAndStringsFromContent } from './_internal/masking.js';

export function probeCodeQuality(files) {
  const findings = [];
  files.forEach((file) => {
    // Skip test files, lib/logger.js (a logger IS the right place for console mirroring),
    // generated bundles, and config files. We're judging *production source*.
    if (isTestFile(file.path)) return;
    if (/(^|\/)dist\//i.test(file.path)) return;
    if (/(^|\/)logger\.[jt]sx?$/i.test(file.path)) return;
    // Build/tool config files and tooling directories: console output there is
    // normal (build logs, script progress), not shipped production source.
    // FP triage 2026-07 (gemini-cli-fork scan).
    if (/\.config\.[mc]?[jt]sx?$/i.test(file.path)) return;
    if (/(^|\/)(scripts?|tools?|bin)\//i.test(file.path)) return;
    // Agent-skill script dirs (.gemini/skills/, .claude/commands/, etc.).
    if (/(^|\/)\.[\w-]+\/(skills?|commands?|hooks?|agents?)\//i.test(file.path)) return;
    if (/(^|\/)setup\.[jt]sx?$/i.test(file.path)) return;
    if (!/\.[jt]sx?$/i.test(file.path)) return;

    const content = file.content || '';
    // Shebang: an executable script. Console output is its interface.
    if (/^#!/.test(content)) return;
    const lines = content.split('\n');
    // Scanner self-source (breakers.js, threat-intel.js, probes/*, ...)
    // embeds attack/example code as DATA strings by design. The code-shape
    // checks below (.then-no-.catch, await-no-try/catch) match that string
    // content as if it were real control flow, which is a false positive.
    // console.* and file-size checks still run on these files (those remain
    // meaningful).
    const selfSource = isScannerSelfSource(file.path);

    // --- console.* in production source. Each occurrence becomes ONE finding (deduped per file).
    let consoleCount = 0;
    lines.forEach((line) => {
      const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
      if (/\bconsole\.(log|debug|info|warn|error|trace)\s*\(/.test(stripped)) {
        consoleCount++;
      }
    });
    if (consoleCount > 0) {
      findings.push({
        id: `cq-console-${file.path}`,
        probe: 'Code Quality',
        title: `${consoleCount} console.* call${consoleCount === 1 ? '' : 's'} in production source`,
        severity: consoleCount > 5 ? 'medium' : 'low',
        category: 'Misconfiguration',
        cwe: 'CWE-489',
        file: file.path,
        line: 1,
        evidence: `${consoleCount} occurrence(s) of console.log/debug/info/warn/error/trace`,
        remediation:
          'Console statements left in production source bloat the bundle, leak diagnostic data to user devtools, and confuse end-users debugging on their own. Route through a logger module that respects an env-driven log level, or strip with a build-time transform (Vite: define.replace).',
      });
    }

    // --- file size ladder (four bands, post 2026-06 dogfood-blind fix)
    // The old two-band ladder topped out at MEDIUM, so PreFlight's own oversized
    // files never gated its dogfood scan. The HIGH band at FILE_SIZE_HIGH_LINES
    // now does. Bands, largest first:
    //   >= 5000  CRITICAL  "emergency split"
    //   >= 3000  HIGH      "split required"     (gates the dogfood scan)
    //   >= 2000  MEDIUM    "architectural smell"
    //   >= 1500  LOW       "watch this"
    if (lines.length >= FILE_SIZE_CRIT_LINES) {
      findings.push({
        id: `cq-file-crit-${file.path}`,
        probe: 'Code Quality',
        title: `File is ${lines.length} lines (emergency split)`,
        severity: 'critical',
        category: 'Misconfiguration',
        cwe: 'CWE-1041',
        file: file.path,
        line: 1,
        evidence: `${lines.length} lines exceeds ${FILE_SIZE_CRIT_LINES} critical threshold`,
        remediation:
          'A file this large is unreviewable and untestable in isolation. Split it now into modules organized by responsibility before adding any more code.',
      });
    } else if (lines.length >= FILE_SIZE_HIGH_LINES) {
      findings.push({
        id: `cq-file-high-${file.path}`,
        probe: 'Code Quality',
        title: `File is ${lines.length} lines (split required)`,
        severity: 'high',
        category: 'Misconfiguration',
        cwe: 'CWE-1041',
        file: file.path,
        line: 1,
        evidence: `${lines.length} lines exceeds ${FILE_SIZE_HIGH_LINES} threshold`,
        remediation:
          'Files this large hurt onboarding, code review, and test isolation. Split into modules organized by responsibility (probes, formatters, history, UI components).',
      });
    } else if (lines.length >= FILE_SIZE_MED_LINES) {
      findings.push({
        id: `cq-file-med-${file.path}`,
        probe: 'Code Quality',
        title: `File is ${lines.length} lines (architectural smell)`,
        severity: 'medium',
        category: 'Misconfiguration',
        cwe: 'CWE-1041',
        file: file.path,
        line: 1,
        evidence: `${lines.length} lines exceeds ${FILE_SIZE_MED_LINES} threshold`,
        remediation:
          'A file growing past 2000 lines is accreting unrelated responsibilities. Plan a split along its natural seams during the next refactor.',
      });
    } else if (lines.length >= FILE_SIZE_WARN_LINES) {
      findings.push({
        id: `cq-file-large-${file.path}`,
        probe: 'Code Quality',
        title: `File is ${lines.length} lines (watch this)`,
        severity: 'low',
        category: 'Misconfiguration',
        cwe: 'CWE-1041',
        file: file.path,
        line: 1,
        evidence: `${lines.length} lines exceeds ${FILE_SIZE_WARN_LINES} warning threshold`,
        remediation:
          'Not a bug, but consider splitting on the next major refactor. Files over 1500 lines tend to accrete unrelated responsibilities and become harder to test in isolation.',
      });
    }

    // --- .then(...) without a subsequent .catch(...)
    // Walk the statement to its END (terminating semicolon, end of file, or back-to-column-1 at
    // the start of a new statement) before deciding it's unhandled. Previous fixed 200-char
    // window false-positived on .then() handlers with long bodies (adversarial-agent finding).
    if (!selfSource)
      [...content.matchAll(/\.then\s*\(/g)].forEach((m) => {
        // Walk forward through balanced parens / braces until we hit a semicolon at depth 0
        // or two consecutive newlines (paragraph break).
        let i = m.index;
        let pDepth = 0,
          bDepth = 0;
        let inSingle = false,
          inDouble = false,
          inBack = false;
        let lastChar = '';
        let chainEnd = content.length;
        for (; i < content.length; i++) {
          const ch = content[i];
          if (inSingle) {
            if (ch === "'" && lastChar !== '\\') inSingle = false;
            lastChar = ch;
            continue;
          }
          if (inDouble) {
            if (ch === '"' && lastChar !== '\\') inDouble = false;
            lastChar = ch;
            continue;
          }
          if (inBack) {
            if (ch === '`' && lastChar !== '\\') inBack = false;
            lastChar = ch;
            continue;
          }
          if (ch === "'") inSingle = true;
          else if (ch === '"') inDouble = true;
          else if (ch === '`') inBack = true;
          else if (ch === '(') pDepth++;
          else if (ch === ')') pDepth--;
          else if (ch === '{') bDepth++;
          else if (ch === '}') bDepth--;
          else if (ch === ';' && pDepth === 0 && bDepth === 0) {
            chainEnd = i;
            break;
          } else if (ch === '\n' && content[i + 1] === '\n' && pDepth === 0 && bDepth === 0) {
            chainEnd = i;
            break;
          }
          lastChar = ch;
        }
        const window = content.slice(m.index, chainEnd);
        if (/\.catch\s*\(|\.finally\s*\(/.test(window)) return;
        const ln = content.slice(0, m.index).split('\n').length;
        findings.push({
          id: `cq-then-no-catch-${file.path}-${m.index}`,
          probe: 'Code Quality',
          title: 'Promise .then() with no .catch() — unhandled rejection on error',
          severity: 'low',
          category: 'Misconfiguration',
          cwe: 'CWE-755',
          file: file.path,
          line: ln,
          evidence: window.slice(0, 80),
          remediation:
            'Add a .catch() handler, or prefer async/await with a try/catch wrapper. Unhandled promise rejections terminate Node processes in newer versions and leave a confusing console error in browsers.',
        });
      });

    // --- unhandled async rejection (fire-and-forget contexts only)
    // FP triage 2026-07 (gemini-cli-fork scan): the previous version flagged EVERY
    // async body containing await without try/catch — 9,938 findings on one
    // 2,273-file monorepo, nearly all wrong, because a helper whose caller wraps
    // the call in try/catch is correct code. The probe now fires only where a
    // rejection provably has no handler:
    //   1. an async callback handed to a fire-and-forget sink (event listener,
    //      timer, JSX on* handler) whose body lacks try/catch — nothing awaits
    //      these, so a rejection is unhandled by construction;
    //   2. a same-file async function invoked bare in statement position with no
    //      await/void/.catch — the classic `main()` at the bottom of a script.
    // Balanced brace scan SKIPS string and regex literals so a `const x = "}"`
    // or `/\}/` inside the body doesn't terminate parsing early (adversarial finding).
    // Detection runs on MASKED content (comments/string interiors blanked,
    // newlines preserved) so trigger shapes quoted in comments, strings, and
    // template literals can't fire (adversarial precision round 2026-07).
    const maskedContent = maskCommentsAndStringsFromContent(content);
    const asyncBodies = [
      ...maskedContent.matchAll(/async\s+(?:function\s+\w+\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{/g),
    ];
    if (!selfSource)
      asyncBodies.forEach((m) => {
        // Only async callbacks in fire-and-forget position. A plain async
        // function declaration is NOT flagged: its caller may (correctly)
        // handle the rejection.
        const pre = maskedContent.slice(Math.max(0, m.index - 80), m.index);
        const fireAndForget =
          /(?:addEventListener\s*\(\s*['"][^'"]*['"]\s*,\s*|setTimeout\s*\(\s*|setInterval\s*\(\s*|setImmediate\s*\(\s*|on[A-Z]\w*\s*=\s*\{\s*)$/.test(
            pre
          );
        if (!fireAndForget) return;
        let depth = 1;
        let i = m.index + m[0].length;
        let inSingle = false,
          inDouble = false,
          inBack = false,
          inLineComment = false,
          inBlockComment = false;
        let prev = '';
        while (i < maskedContent.length && depth > 0) {
          const ch = maskedContent[i];
          const next = maskedContent[i + 1];
          if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            i++;
            prev = ch;
            continue;
          }
          if (inBlockComment) {
            if (ch === '*' && next === '/') {
              inBlockComment = false;
              i++;
            }
            i++;
            prev = ch;
            continue;
          }
          if (inSingle) {
            if (ch === "'" && prev !== '\\') inSingle = false;
            i++;
            prev = ch;
            continue;
          }
          if (inDouble) {
            if (ch === '"' && prev !== '\\') inDouble = false;
            i++;
            prev = ch;
            continue;
          }
          if (inBack) {
            if (ch === '`' && prev !== '\\') inBack = false;
            i++;
            prev = ch;
            continue;
          }
          if (ch === '/' && next === '/') {
            inLineComment = true;
            i += 2;
            prev = next;
            continue;
          }
          if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 2;
            prev = next;
            continue;
          }
          if (ch === "'") inSingle = true;
          else if (ch === '"') inDouble = true;
          else if (ch === '`') inBack = true;
          else if (ch === '{') depth++;
          else if (ch === '}') depth--;
          i++;
          prev = ch;
        }
        const body = maskedContent.slice(m.index + m[0].length, i - 1);
        // A body whose awaits are individually .catch-chained handles its
        // rejections without try/catch (adversarial precision round 2026-07).
        if (/\bawait\b/.test(body) && !/\btry\s*\{/.test(body) && !/\.catch\s*\(/.test(body)) {
          const ln = maskedContent.slice(0, m.index).split('\n').length;
          findings.push({
            id: `cq-async-no-try-${file.path}-${m.index}`,
            probe: 'Code Quality',
            title: 'async callback in fire-and-forget position with no try/catch',
            severity: 'low',
            category: 'Misconfiguration',
            cwe: 'CWE-755',
            file: file.path,
            line: ln,
            evidence: m[0].slice(0, 120),
            remediation:
              'Nothing awaits an async callback passed to an event listener, timer, or JSX handler, so a rejection inside it has no handler: it surfaces as an unhandled rejection in the console (and can kill a Node process). Wrap the body in try/catch and decide whether to surface the error to the UI, log it, or retry.',
          });
        }
      });

    // Same-file async function invoked bare in statement position — `main();`
    // with no await/void/.catch. try/catch around the call site does NOT help:
    // a synchronous try cannot catch an un-awaited promise rejection.
    if (!selfSource) {
      const asyncNames = new Set();
      for (const dm of maskedContent.matchAll(/\basync\s+function\s+(\w+)/g)) asyncNames.add(dm[1]);
      for (const dm of maskedContent.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*async\b/g))
        asyncNames.add(dm[1]);
      // A sync declaration of the same name anywhere in the file (an inner
      // shadow, an overload) makes bare-call resolution ambiguous — skip the
      // name entirely (adversarial precision round 2026-07).
      for (const dm of maskedContent.matchAll(/(\basync\s+)?function\s+(\w+)/g)) {
        if (!dm[1]) asyncNames.delete(dm[2]);
      }
      for (const dm of maskedContent.matchAll(
        /\b(?:const|let|var)\s+(\w+)\s*=\s*(?!async\b)(?:function\b|\()/g
      )) {
        asyncNames.delete(dm[1]);
      }
      if (asyncNames.size) {
        const originalLines = content.split('\n');
        maskedContent.split('\n').forEach((lineText, idx) => {
          const call = lineText.match(/^\s*(\w+)\s*\([^)]*\)\s*;?\s*$/);
          if (!call || !asyncNames.has(call[1])) return;
          findings.push({
            id: `cq-async-fire-forget-${file.path}-${idx + 1}`,
            probe: 'Code Quality',
            title: `fire-and-forget call to async function "${call[1]}" — rejection unhandled`,
            severity: 'low',
            category: 'Misconfiguration',
            cwe: 'CWE-755',
            file: file.path,
            line: idx + 1,
            evidence: (originalLines[idx] || lineText).trim().slice(0, 120),
            remediation: `${call[1]}() is async but nothing consumes its promise. If it rejects, the error is unhandled (newer Node versions crash the process). Append .catch() to the call, await it inside an async context, or mark the intent explicit with void ${call[1]}() plus internal error handling.`,
          });
        });
      }
    }
  });
  return findings;
}

// --- Architecture classifier + per-type best-practice teaching ---
// Heuristic classifier; emits one info finding with the detected type + signals so the user can
// verify the classification was reasonable, then emits low/medium findings for type-specific
// anti-patterns. Each finding includes extended teaching ("why this matters") so the audit doubles
// as a learning tool, not just a checklist.
export function classifyProject(files) {
  const has = (re) => files.some((f) => re.test(f.path));
  const fileCount = files.length;
  const signals = [];

  let pkg = null;
  const pkgFile = files.find(
    (f) => /(^|\/)package\.json$/.test(f.path) && !/node_modules/.test(f.path)
  );
  if (pkgFile) {
    try {
      pkg = JSON.parse(pkgFile.content);
    } catch {}
  }
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};

  const subPackages = files.filter((f) =>
    /(^|\/)(packages|services|apps)\/[^/]+\/package\.json$/.test(f.path)
  );
  // Require ≥2 sub-packages to qualify as a monorepo. A single package under packages/
  // is just a folder convention (adversarial finding).
  const monorepoDirs = subPackages.length >= 2;
  if (monorepoDirs)
    signals.push(`${subPackages.length} package.json files under packages/ services/ or apps/`);
  // Library detection: Vite build.lib config, package.json#main + exports without an index.html.
  const viteConfig = files.find((f) => /(^|\/)vite\.config\.[jt]s$/.test(f.path));
  const hasViteLibMode =
    viteConfig && /build\s*:\s*\{[\s\S]*?lib\s*:/.test(viteConfig.content || '');
  const hasStorybook = files.some((f) => /(^|\/)\.storybook\//.test(f.path));
  const hasPkgExports =
    pkg && (pkg.exports || pkg.main) && !files.some((f) => /(^|\/)index\.html$/.test(f.path));
  if (hasViteLibMode) signals.push('vite.config has build.lib');
  if (hasStorybook) signals.push('.storybook directory present');
  if (hasPkgExports) signals.push('package.json#exports/main set, no index.html');

  const hasReactNative = !!deps['react-native'] || !!deps.expo;
  if (hasReactNative) signals.push('react-native or expo dependency');
  // Tauri and Electron get separate labels — different stacks, different security teaching.
  const hasTauri = files.some((f) => /(^|\/)src-tauri\//.test(f.path)) || !!deps['@tauri-apps/api'];
  const hasElectron = !!deps.electron;
  if (hasTauri) signals.push('Tauri shell (src-tauri/)');
  if (hasElectron) signals.push('Electron main process dependency');
  const hasAstro = !!deps.astro || has(/\.astro$/);
  // Inspect astro.config for output mode — defaults to 'static' but server/hybrid modes are SSR.
  const astroConfig = files.find((f) => /(^|\/)astro\.config\.(js|mjs|ts)$/.test(f.path));
  const astroOutput = astroConfig
    ? (astroConfig.content.match(/output\s*:\s*['"](\w+)['"]/) || [])[1]
    : null;
  if (astroOutput) signals.push(`astro output: ${astroOutput}`);
  const hasNextExport = pkg && /['"]output['"]\s*:\s*['"]export['"]/.test(pkgFile?.content || '');
  const hasNext = !!deps.next;
  const hasExpress = !!deps.express || !!deps.fastify || !!deps.koa;
  if (hasExpress) signals.push('express/fastify/koa server dependency');
  const hasReact = !!deps.react;
  const hasVue = !!deps.vue;
  const hasSvelte = !!deps.svelte;
  const hasInk = !!deps.ink; // React for terminals → CLI, not SPA (adversarial finding)
  if (hasInk) signals.push('ink dependency (React for terminals)');
  const hasNotebook = has(/\.ipynb$/);
  const hasBin = !!(pkg && pkg.bin);
  const hasHtml = has(/\.html?$/);
  // Python project detection (adversarial finding: ipynb-with-py-files was falling through to unknown)
  const hasPyproject = files.some((f) => /(^|\/)pyproject\.toml$/.test(f.path));
  const hasRequirements = files.some((f) => /(^|\/)requirements(\-\w+)?\.txt$/.test(f.path));
  const hasSetupPy = files.some((f) => /(^|\/)setup\.(py|cfg)$/.test(f.path));
  const isPython = (hasPyproject || hasRequirements || hasSetupPy) && !pkg;
  if (isPython) signals.push('pyproject.toml / requirements.txt / setup.py detected');
  const sourceFiles = files.filter(
    (f) => /\.[jt]sx?$/.test(f.path) && !/node_modules|dist|\.test\.|\.spec\.|\/test\//.test(f.path)
  );
  const largestSourceLines = Math.max(
    0,
    ...sourceFiles.map((f) => (f.content || '').split('\n').length)
  );
  const totalSrcLines = sourceFiles.reduce((a, f) => a + (f.content || '').split('\n').length, 0);

  let type, label, summary;
  if (isPython) {
    type = 'python';
    label = 'Python Project';
    summary = `Python project detected (${hasPyproject ? 'pyproject.toml' : hasSetupPy ? 'setup.py' : 'requirements.txt'}). Probes targeting Python source patterns will run; JS-specific probes are skipped.`;
  } else if (hasNotebook && files.filter((f) => /\.ipynb$/.test(f.path)).length >= 2) {
    type = 'notebook';
    label = 'Notebook / Data Science';
    summary = '.ipynb files dominate. Treat as a notebook codebase.';
  } else if (monorepoDirs) {
    // Distinguish a plain monorepo from monorepo+SSR.
    if (hasNext) {
      type = 'monorepo-ssr';
      label = 'Monorepo with Next.js (SSR + multiple packages)';
      summary = `${subPackages.length} sub-packages + Next.js dependency — monorepo serving an SSR app.`;
    } else {
      type = 'monorepo';
      label = 'Microservices monorepo';
      summary = `${subPackages.length} package.json files under packages/ services/ apps/.`;
    }
  } else if (hasReactNative) {
    type = 'mobile';
    label = 'Mobile (React Native / Expo)';
    summary = 'react-native or expo manifest detected.';
  } else if (hasTauri) {
    type = 'desktop-tauri';
    label = 'Desktop (Tauri)';
    summary =
      'src-tauri/ present — Rust-backed desktop shell with a webview UI. Note: security model differs from Electron (no Node integration).';
  } else if (hasElectron) {
    type = 'desktop-electron';
    label = 'Desktop (Electron)';
    summary =
      'electron dependency — Node-backed desktop shell. Watch for nodeIntegration and contextIsolation footguns.';
  } else if (hasAstro) {
    if (astroOutput === 'server' || astroOutput === 'hybrid') {
      type = 'ssr-astro';
      label = `SSR (Astro, output: ${astroOutput})`;
      summary = `Astro framework with output: "${astroOutput}" — renders some routes on the server at request time.`;
    } else {
      type = 'ssg';
      label = 'Static Site Generator (Astro)';
      summary = 'Astro framework, static output (default or explicit). Pre-rendered HTML.';
    }
  } else if (hasNextExport) {
    type = 'ssg';
    label = 'Static Site Generator (Next export)';
    summary = 'Next.js with output: "export" — pre-rendered static output.';
  } else if (hasNext) {
    type = 'ssr';
    label = 'Server-Side Rendered (Next.js)';
    summary = 'Next.js without static export — render at request time on the server.';
  } else if (hasInk && hasBin) {
    type = 'cli-ink';
    label = 'CLI Tool (React-rendered terminal UI via Ink)';
    summary =
      'package.json has a bin entry AND react+ink — a CLI using React-for-terminals, not an SPA.';
  } else if (hasBin && !hasReact && !hasVue && !hasSvelte) {
    type = 'cli';
    label = 'CLI Tool';
    summary = 'package.json has a bin entry and no UI framework dependency.';
  } else if (hasExpress && !hasReact && !hasVue && !hasSvelte) {
    type = 'backend-api';
    label = 'Backend API';
    summary = 'Express/Fastify/Koa with no frontend framework.';
  } else if (hasViteLibMode || hasStorybook || hasPkgExports) {
    type = 'library';
    label = 'Component / Utility Library';
    summary = hasViteLibMode
      ? 'Vite library mode build.'
      : hasStorybook
        ? 'Storybook config present — library shipped with isolated component previews.'
        : 'package.json declares exports/main and no index.html — meant to be consumed, not deployed.';
  } else if (hasReact || hasVue || hasSvelte) {
    // SPA — distinguish monolith from modular
    if (largestSourceLines >= 1500 && largestSourceLines / Math.max(totalSrcLines, 1) > 0.4) {
      type = 'monolithic-spa';
      label = 'Monolithic SPA';
      summary = `${hasReact ? 'React' : hasVue ? 'Vue' : 'Svelte'} SPA with one file (${largestSourceLines} lines) holding ${Math.round((100 * largestSourceLines) / Math.max(totalSrcLines, 1))}% of the source.`;
    } else if (sourceFiles.length >= 6) {
      type = 'modular-spa';
      label = 'Modular SPA';
      summary = `${hasReact ? 'React' : hasVue ? 'Vue' : 'Svelte'} SPA, ${sourceFiles.length} source files, largest is ${largestSourceLines} lines.`;
    } else {
      type = 'small-spa';
      label = 'Small SPA';
      summary = `${hasReact ? 'React' : hasVue ? 'Vue' : 'Svelte'} SPA, ${sourceFiles.length} source file${sourceFiles.length === 1 ? '' : 's'}.`;
    }
  } else if (hasHtml && !pkg) {
    type = 'static-html';
    label = 'Static HTML / CSS';
    summary = '.html files, no package.json or build tool — plain static site.';
  } else if (hasHtml && pkg) {
    type = 'static-html-build';
    label = 'Static HTML with build tool';
    summary = '.html plus a build tool but no framework — landing-page / static-site-with-bundler.';
  } else {
    type = 'unknown';
    label = 'Unknown';
    summary = `Could not classify (${fileCount} files, ${sourceFiles.length} JS/TS source).`;
  }
  signals.unshift(`largest source file: ${largestSourceLines} lines`);
  signals.unshift(`source files: ${sourceFiles.length}`);
  return { type, label, summary, signals, largestSourceLines, sourceFileCount: sourceFiles.length };
}

// Project types where the architecture probe has nothing actionable to emit. For these
// the classifier ran and tagged the project as "healthy by shape" — surfacing a finding
// would be pure noise (the user already knows the shape they built). Other probes still
// run and emit their own findings; the architecture probe just doesn't tax the score
// with informational cheerleading.
const HEALTHY_TYPES = new Set(['modular-spa', 'small-spa', 'ssr', 'unknown']);

export function probeArchitecture(files) {
  const findings = [];
  const klass = classifyProject(files);

  // Skip the architecture probe entirely when the classifier says we're in a healthy state.
  // The shape is information; if there's nothing to act on, no finding.
  if (HEALTHY_TYPES.has(klass.type)) return findings;

  // Type-detected-as-suboptimal — emit the classification + the type-specific teaching.
  findings.push({
    id: `arch-classify-${klass.type}`,
    probe: 'Architecture',
    title: `Detected: ${klass.label}`,
    severity: 'info',
    category: 'Misconfiguration',
    cwe: 'INFO-architecture',
    file: 'project root',
    line: 1,
    evidence: `${klass.summary}\nSignals: ${klass.signals.join(' · ')}`,
    remediation: `This is informational — it tells you what architecture the audit thinks you have so the type-specific rules below make sense.

Why architecture matters:
• A bug in a 200-line module is a bad afternoon. A bug in a 4000-line module that does six things is a bad week.
• Code organization isn't a style preference; it's a leverage choice. Smaller, single-purpose modules are easier to test, easier to reason about, easier to delete, and easier for AI tools (and humans) to refactor without breaking unrelated functionality.
• "Microservices vs monolith" is a deployment-and-team question, not a code-organization question. A well-modularized monolith and a well-designed microservice mesh share the same principle: clear boundaries between unrelated concerns. Most teams should NOT adopt microservices for code-organization reasons — that's a tooling tax for something module structure already solves.

If the classification looks wrong (e.g., you got "Unknown" or a category that doesn't match), the signal list above shows what the heuristic saw. Architecture is judgment-driven; this is a starting point.`,
  });

  // Type-specific best-practice findings.
  if (klass.type === 'monolithic-spa') {
    findings.push({
      id: 'arch-monolith-split',
      probe: 'Architecture',
      title: `Single source file is ${klass.largestSourceLines} lines (consider splitting)`,
      severity: 'low',
      category: 'Misconfiguration',
      cwe: 'CWE-1041',
      file: 'src/ (root)',
      line: 1,
      evidence: `largest source file: ${klass.largestSourceLines} lines; ${klass.sourceFileCount} total source files`,
      remediation: `Why monolith-in-one-file fails:
• Diffs become huge: a 5-line behavior change reads as part of a 4000-line file in code review.
• Test isolation is impossible: a bug in module A re-runs every test in the file.
• Mental model overload: every reader has to load all responsibilities to understand any one.
• AI-assisted refactors get worse: Claude / Cursor / Copilot quality degrades on long files because more unrelated context competes for attention.

How to split:
• Identify natural seams — usually: one file per probe, one for formatters, one for history, one for theme, components in their own directory.
• Move bottom-up: leaves first (small helpers), then groups, last the main component.
• Keep the public import surface stable: re-export from the old file path during transition so callers don't need updates.

When NOT to split:
• Files under ~500 lines are usually fine in one file. Splitting prematurely costs more than it saves.
• Components that are genuinely tightly coupled (e.g., a wizard with 5 steps that all share state) may belong together.`,
    });
  }

  if (klass.type === 'static-html' || klass.type === 'static-html-build') {
    findings.push({
      id: 'arch-static-html-teach',
      probe: 'Architecture',
      title: 'Static HTML — minimum-viable hardening checklist',
      severity: 'info',
      category: 'Misconfiguration',
      cwe: 'INFO-architecture',
      file: 'index.html',
      line: 1,
      evidence: 'static HTML detected',
      remediation: `Best practices for a static HTML site:
• Every page has <meta name="viewport"> for mobile (WCAG 1.4.10).
• Every page has lang="en" on <html> (WCAG 3.1.1).
• Every page has a <title>, a <meta name="description">, and Open Graph + Twitter Card tags for social shares.
• Add a Content-Security-Policy via <meta http-equiv> or server header — disables inline scripts/handlers that XSS depends on.
• Minify CSS and HTML for production (Vite / esbuild handle this automatically).
• Add cache-busting filename hashes for CSS/JS so users get fresh assets on deploy.
• Defer-load non-critical JS with <script defer> or <script type="module">.

The HTML Hygiene, SEO Hygiene, and A11y Landmarks probes above check each of these.`,
    });
  }

  if (klass.type === 'monorepo') {
    findings.push({
      id: 'arch-monorepo-teach',
      probe: 'Architecture',
      title: 'Microservices monorepo — boundary discipline matters more than any other check',
      severity: 'info',
      category: 'Misconfiguration',
      cwe: 'INFO-architecture',
      file: 'project root',
      line: 1,
      evidence: 'multiple package.json found',
      remediation: `Best practices for monorepos:
• Each service has its own package.json with explicit "name" and "version". No "private: true" workspace inherits versioning from parent.
• Cross-service imports MUST go through the published package name, never relative paths into a sibling package. Enforce with eslint-plugin-import or workspace constraints.
• Each service has its own README.md, its own test suite, its own CI matrix entry.
• Shared types live in a dedicated package (e.g. packages/types) — not duplicated across services.
• Lockfile is at the root, not per-package; let your package manager (pnpm / yarn workspaces / npm workspaces) handle hoisting.
• Atomic refactors across services are the killer feature of a monorepo — use them, don't avoid them.

Anti-pattern: a monorepo where every service still ships independently with no shared code. That's just a folder with multiple repos jammed in it — you have the tooling overhead with none of the benefit.`,
    });
  }

  // (Removed: modular-spa / small-spa teaching. HEALTHY_TYPES gate above returns
  // before reaching here, so emitting this would be unreachable code.)

  if (klass.type === 'ssr') {
    findings.push({
      id: 'arch-ssr-teach',
      probe: 'Architecture',
      title: 'SSR — server-only code separation is the failure mode',
      severity: 'info',
      category: 'Misconfiguration',
      cwe: 'INFO-architecture',
      file: 'project root',
      line: 1,
      evidence: 'Next.js without static export',
      remediation: `Best practices for SSR (Next.js / Remix / SvelteKit):
• Server-only modules MUST not leak into the client bundle. Use "server-only" import (Next.js) or the explicit /server/ directory convention.
• Database credentials, API keys, and PII helpers belong in server-only paths. The NEXT_PUBLIC_ probe above catches the easiest leak.
• Hydration boundaries are expensive — minimize them. Use Server Components by default; Client Components for islands.
• Streaming responses (React 18+) cut TTFB but require all data fetches to be promise-aware up front.
• Edge runtime has different APIs from Node — code that uses fs / crypto.randomBytes / etc. won't run there.`,
    });
  }

  return findings;
}
