// src/lib/probes/agent-backdoor.js
//
// Agent / editor auto-execution backdoors.
//
// The 2026 "Miasma" npm supply-chain campaign (Microsoft Threat Intelligence,
// 2026-06-02; Red Hat advisory RHSB-2026-006) and its Mini Shai-Hulud
// predecessor do not stop at stealing credentials during `npm install`. They
// persist by writing config files that the developer's own tools auto-execute
// every time the project is opened:
//   - .claude/settings.json  -> a Claude Code SessionStart hook running a command
//   - .vscode/tasks.json     -> a task with runOptions.runOn = "folderOpen"
// Both run with no consent the moment the repo is opened in the agent/editor,
// and both survive `npm uninstall` because they live in the repo, not in
// node_modules.
//
// probeMaliciousArtifacts (supply-chain.js) already catches the KNOWN campaign
// by file path and IOC string. This probe is BEHAVIORAL: it flags any committed
// agent/editor config that auto-runs a shell command, whatever campaign wrote
// it. That is the durable detection. A new variant with new file names and a
// new exfil endpoint still has to register an auto-firing hook to persist, and
// that shape is exactly what this catches.
//
// Claude Code hook events and schema per Anthropic's published hooks reference.

import { isTestFile, isScannerSelfSource } from '../file-filter.js';

// Claude Code hook events that fire on their own when a project is opened or
// used, with no deliberate user action. SessionStart is the Miasma vector
// (fires every session open). The rest fire during ordinary agent operation.
const AUTO_FIRING_CLAUDE_EVENTS = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'Notification',
]);

// A command an honest project-setup hook would not run: pulling and executing
// remote code, spawning a shell/interpreter inline, decoding a base64 blob, or
// reaching known exfil infrastructure. Used only to ESCALATE severity; an
// auto-firing hook is reported regardless of whether it looks malicious,
// because the user did not consent to ANY command running on repo open.
const MALICIOUS_COMMAND_RE =
  /\b(?:curl|wget|node\s+-e|deno\s+run|base64\s+-d|atob|child_process|execSync|spawnSync|powershell|Invoke-WebRequest|iwr|certutil)\b|\/dev\/tcp|https?:\/\/|setup\.mjs|router_runtime|getsession\.org/i;

// Pull { event, command } pairs out of a Claude Code `hooks` object.
// Schema: hooks: { <Event>: [ { matcher?, hooks: [ { type:'command', command:'...' } ] } ] }
function claudeHookCommands(hooksObj) {
  const out = [];
  if (!hooksObj || typeof hooksObj !== 'object') return out;
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const inner = group && Array.isArray(group.hooks) ? group.hooks : [];
      for (const h of inner) {
        if (h && typeof h.command === 'string') out.push({ event, command: h.command });
      }
    }
  }
  return out;
}

function scanClaudeSettings(file, findings) {
  let cfg;
  try {
    cfg = JSON.parse(file.content);
  } catch {
    return; // malformed: nothing reliable to assert
  }
  claudeHookCommands(cfg.hooks).forEach(({ event, command }, i) => {
    const autoFires = AUTO_FIRING_CLAUDE_EVENTS.has(event);
    const malicious = MALICIOUS_COMMAND_RE.test(command);
    // Auto-firing event + remote/obfuscated command = critical. An auto-firing
    // benign-looking command is still high (it runs without your consent). A
    // manual-event hook is medium.
    const severity = malicious && autoFires ? 'critical' : autoFires ? 'high' : 'medium';
    findings.push({
      id: `agent-claude-hook-${file.path}-${event}-${i}`,
      probe: 'Agent Config Backdoor',
      title: malicious
        ? `Claude Code ${event} hook runs a remote or obfuscated command`
        : `Claude Code ${event} hook auto-executes a shell command`,
      severity,
      category: 'Supply Chain',
      cwe: 'CWE-829',
      file: file.path,
      line: 1,
      evidence: `"${event}" hook: ${command.slice(0, 160)}`,
      remediation: `A committed .claude/settings.json hook runs on the developer's machine whenever this project is opened in Claude Code${autoFires ? ` (the ${event} event fires automatically, with no user action)` : ''}. This is the persistence mechanism used by the 2026 Miasma / Shai-Hulud npm worms: they survive \`npm uninstall\` by writing a SessionStart hook here. If you did not author this hook, treat the host as compromised and follow this order exactly: 1) disconnect the machine from the network; 2) screenshot, then remove the hook. Do NOT revoke tokens yet, these worms wipe the home directory if they lose access while still resident; 3) rotate every reachable credential (npm, GitHub, SSH, cloud, Kubernetes) from a SEPARATE trusted machine. If you DID author it, move trusted setup into an explicit script a teammate runs deliberately, not an auto-firing hook.`,
    });
  });
}

function scanVscodeTasks(file, findings) {
  let cfg;
  try {
    cfg = JSON.parse(file.content);
  } catch {
    return;
  }
  const tasks = Array.isArray(cfg.tasks) ? cfg.tasks : [];
  tasks.forEach((task, i) => {
    if (!task || task.runOptions?.runOn !== 'folderOpen') return;
    const command = [task.command, ...(Array.isArray(task.args) ? task.args : [])]
      .filter((x) => typeof x === 'string')
      .join(' ');
    const malicious = MALICIOUS_COMMAND_RE.test(command);
    findings.push({
      id: `agent-vscode-autorun-${file.path}-${i}`,
      probe: 'Agent Config Backdoor',
      title: malicious
        ? 'VS Code task auto-runs a remote or obfuscated command on folder open'
        : 'VS Code task auto-runs on folder open',
      severity: malicious ? 'critical' : 'high',
      category: 'Supply Chain',
      cwe: 'CWE-829',
      file: file.path,
      line: 1,
      evidence: `runOn: folderOpen -> ${command.slice(0, 160) || '(see task definition)'}`,
      remediation: `A .vscode/tasks.json task with "runOn": "folderOpen" executes the moment this repo is opened in VS Code, with no prompt. The 2026 Miasma / Shai-Hulud npm worms use this to persist after \`npm uninstall\`. If you did not add this task, treat the host as compromised and follow this order: 1) disconnect from the network; 2) remove the task. Do NOT revoke tokens first, the worm wipes the home directory if it loses access while still resident; 3) rotate credentials from a SEPARATE trusted machine. Legitimate run-on-open tasks are rare; prefer a task you start manually via Terminal > Run Task.`,
    });
  });
}

export function probeAgentConfigBackdoor(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(file.path)) {
      scanClaudeSettings(file, findings);
    } else if (/(^|\/)\.vscode\/tasks\.json$/.test(file.path)) {
      scanVscodeTasks(file, findings);
    }
  });
  return findings;
}
