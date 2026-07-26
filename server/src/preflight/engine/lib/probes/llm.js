// src/lib/probes/llm.js
//
// LLM/RAG security probes: LLM injection, MCP server hygiene, AI code smells.
//
// Extracted from the prior builtin.js monolith when it crossed the
// file-size HIGH threshold. Probe bodies are byte-identical to the
// originals; only the location moved. Public import surface is
// preserved by builtin.js, which is now a back-compat shim re-exporting
// every probe function from its new family file.

import { isTestFile, isScannerSelfSource } from '../file-filter.js';
import { maskCommentsAndStringsFromContent } from './_internal/masking.js';

export function probeLLMSecurity(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$|\.py$/.test(file.path)) return;
    const content = file.content;
    const lines = content.split('\n');
    const isClientFile =
      /^['"]use client['"]/m.test(content) ||
      (/\.tsx?$/.test(file.path) &&
        /(components|app)\//.test(file.path) &&
        !/\/api\/|\/server\/|route\.[jt]sx?$|middleware\./.test(file.path));

    // LLM01: Prompt Injection — user input concatenated into prompts
    lines.forEach((line, i) => {
      if (
        /(?:content|prompt|messages|system)\s*:\s*[`'"][^`'"]*\$\{[^}]*(?:req\.|request\.|userInput|userMessage|body\.|query\.|params\.|searchParams)/.test(
          line
        )
      ) {
        findings.push({
          id: `llm-injection-${file.path}-${i}`,
          probe: 'LLM Security',
          title: 'User input interpolated into LLM prompt (prompt injection)',
          severity: 'high',
          category: 'AI/LLM Security',
          cwe: 'CWE-1336 (LLM01)',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Direct string interpolation enables prompt injection. The user can override your system prompt with payloads like "Ignore previous instructions." Pass user input as a separate user-role message, never interpolated into the system prompt or tool descriptions. Validate the LLM output schema before acting on it. OWASP LLM01:2025.',
        });
      }
    });

    // LLM02: Sensitive Information Disclosure — LLM call from client
    lines.forEach((line, i) => {
      if (
        isClientFile &&
        /(openai|anthropic|cohere|together|replicate|groq|mistral)\.(?:chat|completions|messages|generate|complete)/i.test(
          line
        )
      ) {
        findings.push({
          id: `llm-client-${file.path}-${i}`,
          probe: 'LLM Security',
          title: 'LLM API call from client component (key exposure)',
          severity: 'critical',
          category: 'AI/LLM Security',
          cwe: 'CWE-200 (LLM02)',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'LLM API calls from client code expose your provider key to every visitor. Move the call to a server route handler, API route, or Edge Function. Pass only the prompt content from client to server, never the key. OWASP LLM02:2025.',
        });
      }
    });

    // LLM05: Improper Output Handling — LLM output rendered as HTML
    lines.forEach((line, i) => {
      if (/dangerouslySetInnerHTML/.test(line)) {
        const ctx = lines.slice(Math.max(0, i - 5), i + 1).join(' ');
        if (
          /(completion|response|message|content|reply|llmOutput|aiResponse)/i.test(ctx) &&
          /(openai|anthropic|chat|llm|generate)/i.test(content)
        ) {
          findings.push({
            id: `llm-html-${file.path}-${i}`,
            probe: 'LLM Security',
            title: 'LLM response possibly rendered as raw HTML',
            severity: 'high',
            category: 'AI/LLM Security',
            cwe: 'CWE-79 (LLM05)',
            file: file.path,
            line: i + 1,
            evidence: line.trim().slice(0, 200),
            remediation:
              'LLMs can be coerced into emitting HTML/JS via prompt injection; rendering through dangerouslySetInnerHTML becomes XSS. Use react-markdown with rehype-sanitize, or DOMPurify the HTML before injection. OWASP LLM05:2025.',
          });
        }
      }
    });

    // LLM06: Excessive Agency — dangerous LangChain/agent tools
    const dangerousAgent = content.match(
      /\b(PythonREPL|PythonREPLTool|ShellTool|RequestsTool|RequestsGetTool|RequestsPostTool|BashProcess|TerminalTool|FileManagementToolkit|ExperimentalCodeInterpreter)\b/
    );
    if (dangerousAgent) {
      const ln = content.slice(0, dangerousAgent.index).split('\n').length;
      findings.push({
        id: `llm-agency-${file.path}-${dangerousAgent.index}`,
        probe: 'LLM Security',
        title: `${dangerousAgent[0]} grants arbitrary code execution to the LLM`,
        severity: 'critical',
        category: 'AI/LLM Security',
        cwe: 'CWE-94 (LLM06)',
        file: file.path,
        line: ln,
        evidence: dangerousAgent[0],
        remediation:
          'PythonREPL, ShellTool, RequestsTool and similar let the LLM execute arbitrary code or make arbitrary network requests on your server. A successful prompt injection becomes RCE. Replace with narrowly-scoped tools that take typed arguments and validate them. If sandboxed execution is genuinely needed, isolate it in Pyodide, Modal, e2b, or Daytona. OWASP LLM06:2025.',
      });
    }

    // LLM06: Tool definitions with destructive names
    const destructiveTool = [
      ...content.matchAll(
        /name\s*:\s*['"`]((?:exec|run_?shell|run_?command|execute_?code|execute_?python|delete_?file|delete_?user|run_?sql|grant_?admin|sudo)[a-z_]*)['"`]/gi
      ),
    ];
    destructiveTool.forEach((m) => {
      const ln = content.slice(0, m.index).split('\n').length;
      findings.push({
        id: `llm-tool-${file.path}-${m.index}`,
        probe: 'LLM Security',
        title: `LLM tool with destructive name: "${m[1]}"`,
        severity: 'high',
        category: 'AI/LLM Security',
        cwe: 'CWE-77 (LLM06)',
        file: file.path,
        line: ln,
        evidence: m[0],
        remediation:
          'Tools with destructive capabilities exposed to an LLM agent must perform authorization checks INSIDE the tool implementation, not just at the route level. The LLM can be tricked into calling them by indirect prompt injection (poisoned issues, README, RAG content). Validate caller identity, scope, and arguments inside every tool. OWASP LLM06:2025.',
      });
    });

    // LLM07: System Prompt Leakage — hardcoded system prompt in client bundle
    if (isClientFile) {
      const sysPrompt = content.match(
        /(?:system\s*[:=]\s*|role\s*:\s*['"`]system['"`][\s\S]{0,80}content\s*:\s*)['"`]([^'"`]{40,})['"`]/
      );
      if (sysPrompt) {
        const ln = content.slice(0, sysPrompt.index).split('\n').length;
        findings.push({
          id: `llm-prompt-${file.path}-${sysPrompt.index}`,
          probe: 'LLM Security',
          title: 'System prompt embedded in client-side bundle',
          severity: 'medium',
          category: 'AI/LLM Security',
          cwe: 'CWE-200 (LLM07)',
          file: file.path,
          line: ln,
          evidence: sysPrompt[1].slice(0, 100) + (sysPrompt[1].length > 100 ? '...' : ''),
          remediation:
            'System prompts shipped to the client are inspectable by every user (DevTools, View Source) and reveal product logic, guardrails, and competitive IP. Move prompt construction server-side. OWASP LLM07:2025.',
        });
      }
    }

    // LLM10: Unbounded Consumption — no max_tokens and no rate limit
    const hasLLMCall =
      /(openai|anthropic|cohere|together|replicate|groq)\.(?:chat|completions|messages|generate|complete)/i.test(
        content
      );
    if (hasLLMCall && !/max_tokens|maxTokens|max_output_tokens/i.test(content)) {
      findings.push({
        id: `llm-unbounded-${file.path}`,
        probe: 'LLM Security',
        title: 'LLM call without max_tokens limit',
        severity: 'low',
        category: 'AI/LLM Security',
        cwe: 'CWE-770 (LLM10)',
        file: file.path,
        line: 1,
        evidence: 'LLM API call detected with no max_tokens / max_output_tokens parameter',
        remediation:
          'Without an output cap, an attacker can craft inputs that force long generations, multiplying your bill (Denial of Wallet) and degrading service. Always set a reasonable max_tokens. Pair with per-user rate limits. OWASP LLM10:2025.',
      });
    }
  });
  return findings;
}

// --- Webhook Signature Verification ---

export function probeMCPSecurity(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    const isMCPConfig = /(claude_desktop_config\.json|\.mcp\.json|mcp\.json)$/.test(file.path);
    if (isMCPConfig) {
      let cfg;
      try {
        cfg = JSON.parse(file.content);
      } catch {
        return;
      }
      // Walk multiple known locations: top-level mcpServers/servers (Anthropic, Cursor),
      // nested mcp.servers (VS Code), and tools (LibreChat-style). Merge so all are checked.
      const candidateBuckets = [
        cfg.mcpServers,
        cfg.servers,
        cfg.tools,
        cfg.mcp?.servers,
        cfg.mcp?.mcpServers,
      ];
      const servers = candidateBuckets.filter(Boolean).reduce((a, b) => Object.assign(a, b), {});
      Object.entries(servers).forEach(([name, srv]) => {
        if (!srv) return;
        // Shell-spawning MCP servers
        if (
          srv.command &&
          /^(bash|sh|zsh|cmd|powershell|pwsh|node)$/.test(String(srv.command).toLowerCase())
        ) {
          const args = (srv.args || []).join(' ');
          if (/-c\b|-e\b|-Command/i.test(args)) {
            findings.push({
              id: `mcp-shell-${file.path}-${name}`,
              probe: 'MCP Security',
              title: `MCP server "${name}" spawns shell interpreter`,
              severity: 'critical',
              category: 'AI/LLM Security',
              cwe: 'CWE-77',
              file: file.path,
              line: 1,
              evidence: `${name}: ${srv.command} ${args}`.slice(0, 200),
              remediation:
                'MCP STDIO has known architectural command-injection issues (CVE-2025-49596 MCP Inspector, CVE-2026-22252 LibreChat, CVE-2026-22688 WeKnora). Configurations that spawn shell interpreters with -c / -e are exploitable via prompt injection. Replace with a fixed binary path and validated arguments.',
            });
          }
        }
        // Vulnerable mcp-server-git versions
        const cmdLine = `${srv.command || ''} ${(srv.args || []).join(' ')}`;
        if (/mcp-server-git/.test(cmdLine)) {
          findings.push({
            id: `mcp-git-${file.path}-${name}`,
            probe: 'MCP Security',
            title: `mcp-server-git in MCP config — verify version is post-Dec 2025`,
            severity: 'high',
            category: 'AI/LLM Security',
            cwe: 'CWE-1336',
            file: file.path,
            line: 1,
            evidence: cmdLine.slice(0, 200),
            remediation:
              'Versions of mcp-server-git released before December 8, 2025 are vulnerable to indirect prompt injection via malicious README files, issue descriptions, and webpages (Cyata research). Upgrade to a post-Dec-2025 release and pin by SHA / lockfile.',
          });
        }
        // Public bind
        const argStr = JSON.stringify(srv);
        if (/0\.0\.0\.0|"::"/i.test(argStr) || (srv.host && /^(0\.0\.0\.0|::)$/.test(srv.host))) {
          findings.push({
            id: `mcp-bind-${file.path}-${name}`,
            probe: 'MCP Security',
            title: `MCP server "${name}" binds to all network interfaces`,
            severity: 'high',
            category: 'AI/LLM Security',
            cwe: 'CWE-668',
            file: file.path,
            line: 1,
            evidence: argStr.slice(0, 200),
            remediation:
              'Researchers identified ~200K MCP servers internet-exposed on 0.0.0.0 with command-execution flaws. Bind to 127.0.0.1 unless deliberately publishing the server with authentication. (April 2026 OX Security advisory)',
          });
        }
      });
      return;
    }
    // Inline MCP usage in source
    if (!/\.(ts|tsx|js|jsx|py)$/.test(file.path)) return;
    if (/StdioServerTransport|stdio_server|StdioClientTransport/.test(file.content)) {
      if (/shell\s*:\s*true|spawn\(\s*["'`](bash|sh|cmd|powershell)/i.test(file.content)) {
        findings.push({
          id: `mcp-stdio-${file.path}`,
          probe: 'MCP Security',
          title: 'MCP STDIO server with shell:true / shell-spawn pattern',
          severity: 'high',
          category: 'AI/LLM Security',
          cwe: 'CWE-77',
          file: file.path,
          line: 1,
          evidence: 'StdioServerTransport with shell execution',
          remediation:
            'shell:true and dynamic shell command construction inside an MCP server is the exact pattern that produced multiple 2026 CVEs. Use exec with a fixed binary and explicit args; never pass through prompt content.',
        });
      }
    }
  });
  return findings;
}

// --- 2026: Trojan Source / hidden bidi Unicode ---

export function probeAICodeSmells(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$/.test(file.path)) return;
    // Mask multi-line block comments, line comments, and string-literal
    // contents (including multi-line template literals and JSDoc blocks)
    // from the file content before pattern matching, so the probe fires
    // on actual code shape and not on a documentation block that quotes
    // the shape. Line numbers stay correct because the masker preserves
    // every `\n`.
    const masked = maskCommentsAndStringsFromContent(file.content);
    const originalLines = file.content.split('\n');
    // Empty catch: whitespace-only body. A catch whose body is a COMMENT is
    // documented intent and stays quiet — that boundary was settled by the
    // earlier adversarial precision rounds (v3/v5 suites) and the 2026-07
    // round reconfirmed it; the Pattern page text was corrected to match.
    // One finding per occurrence, line-anchored (the aggregated line-1 form
    // failed every structural check in the 2026-07 recall round).
    for (const m of masked.matchAll(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g)) {
      const ln = masked.slice(0, m.index).split('\n').length;
      findings.push({
        id: `smell-emptycatch-${file.path}-${m.index}`,
        probe: 'AI Code Smells',
        title: 'empty catch block silently swallows errors',
        // The Pattern page (ai-code-smells.md) calls this probe "informational":
        // "The expected response is 'go look at this code path more carefully'
        // rather than 'patch immediately'." Severity follows the Pattern page.
        severity: 'info',
        category: 'Misconfiguration',
        cwe: 'CWE-390',
        file: file.path,
        line: ln,
        evidence: (originalLines[ln - 1] || m[0]).trim().slice(0, 120),
        remediation:
          'Empty catch blocks are a documented signature of AI-generated code — industry studies show ~45% of AI code samples introduce OWASP Top 10 issues, and silent catches are one of the most common patterns. They mask security errors and operational issues. At minimum log; ideally only catch what you can recover from and let the rest propagate.',
      });
    }
    // "any" stays DENSITY-based: sparse idiomatic any (a typed catch clause,
    // a generic helper internal, an overload implementation signature, a
    // single boundary cast) is normal engineering and was pinned quiet by
    // the earlier adversarial precision rounds. Five or more occurrences in
    // one file is the smell.
    let anyType = 0;
    masked.split('\n').forEach((line) => {
      if (/:\s*any\b|as\s+any\b/.test(line)) anyType++;
    });
    if (anyType >= 5) {
      findings.push({
        id: `smell-anytype-${file.path}`,
        probe: 'AI Code Smells',
        title: `Heavy use of "any" type (${anyType} occurrences)`,
        severity: 'info',
        category: 'Misconfiguration',
        cwe: 'CWE-754',
        file: file.path,
        line: 1,
        evidence: `${anyType} uses of ": any" or "as any"`,
        remediation:
          '"any" disables type checking and is over-represented in AI-generated code. While not a vulnerability per se, dense "any" usage correlates with missing input validation downstream. Replace with concrete types or unknown + narrowing.',
      });
    }
  });
  return findings;
}

// --- 2026: .npmrc hygiene / package manager hardening ---
