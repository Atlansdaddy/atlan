// src/lib/probes/ci.js
//
// CI / workflow probes: webhook signature validation, GitHub Actions hardening.
//
// Extracted from the prior builtin.js monolith when it crossed the
// file-size HIGH threshold. Probe bodies are byte-identical to the
// originals; only the location moved. Public import surface is
// preserved by builtin.js, which is now a back-compat shim re-exporting
// every probe function from its new family file.

import { isTestFile, isScannerSelfSource } from '../file-filter.js';

export function probeWebhookValidation(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$|\.py$/.test(file.path)) return;
    if (!/webhook/i.test(file.path) && !/webhook/i.test(file.content)) return;
    const c = file.content;
    if (/stripe/i.test(c) && /webhook/i.test(file.path)) {
      const verified = /(constructEvent|stripe-signature)/i.test(c);
      const readsBody = /(req\.body|request\.body|await\s+req\.text|await\s+req\.json)/i.test(c);
      if (readsBody && !verified) {
        findings.push({
          id: `webhook-stripe-${file.path}`,
          probe: 'Webhook Validation',
          title: 'Stripe webhook handler missing signature verification',
          severity: 'high',
          category: 'Auth & Access',
          cwe: 'CWE-345',
          file: file.path,
          line: 1,
          evidence: 'Reads request body, no constructEvent or stripe-signature check found',
          remediation:
            'Without signature verification anyone can POST a forged webhook to upgrade users, mark orders complete, or trigger refunds. Use stripe.webhooks.constructEvent(rawBody, sig, secret). Read the raw body, not JSON-parsed.',
        });
      }
    }
    if (/github|x-hub-signature/i.test(c) && /webhook/i.test(file.path)) {
      // Depth round 2: also accept crypto.subtle.verify (Web Crypto used by
      // CF Workers / Edge runtimes) — earlier the only "verified" signal was
      // Node's crypto.timingSafeEqual, FP-firing on every Worker.
      if (!/(x-hub-signature|verifyHmac|crypto\.timingSafeEqual|crypto\.subtle\.verify)/i.test(c)) {
        findings.push({
          id: `webhook-github-${file.path}`,
          probe: 'Webhook Validation',
          title: 'GitHub webhook handler missing HMAC verification',
          severity: 'high',
          category: 'Auth & Access',
          cwe: 'CWE-345',
          file: file.path,
          line: 1,
          evidence: 'No X-Hub-Signature-256 verification detected',
          remediation:
            'Verify the X-Hub-Signature-256 header against your webhook secret using crypto.timingSafeEqual or crypto.subtle.verify. Otherwise any attacker can forge events.',
        });
      }
    }
    // Depth round 2: provider widening. Each provider has (a) a name signal
    // (header or content keyword), and (b) a verification signal that, when
    // ABSENT in a body-reading handler, fires HIGH severity. Path-name
    // requirement dropped — Stripe handlers commonly live at /api/billing/...
    // without `webhook` in the path.
    const readsBody =
      /(req\.body|request\.body|await\s+req\.text|await\s+req\.json|request\.get_json|request\.data|request\.read)/i.test(
        c
      );
    const isHandler =
      readsBody &&
      /\bPOST\b|\bapp\.post\(|\brouter\.post\(|\@(?:app|router)\.(?:post|route)/i.test(c);

    const PROVIDERS = [
      {
        name: 'Slack',
        sig: /x-slack-signature/i,
        verify: /(?:createHmac|crypto\.subtle|hmac\.|verify)/i,
      },
      {
        name: 'Discord interactions',
        sig: /x-signature-ed25519|x-signature-timestamp/i,
        verify: /(?:nacl\.sign\.detached\.verify|tweetnacl|@noble\/ed25519)/i,
      },
      {
        name: 'Twilio',
        sig: /x-twilio-signature/i,
        verify: /(?:validateRequest|RequestValidator)/i,
      },
      {
        name: 'Shopify',
        sig: /x-shopify-hmac-sha256/i,
        verify: /(?:createHmac|hmac\.|timingSafeEqual|crypto\.subtle)/i,
      },
      {
        name: 'Square',
        sig: /x-square-hmacsha256-signature/i,
        verify: /(?:isValidWebhookEventSignature|createHmac|crypto\.subtle)/i,
      },
      {
        name: 'Svix / Standard Webhooks',
        sig: /\bsvix-(?:id|timestamp|signature)\b|\bwebhook-(?:id|timestamp|signature)\b/i,
        verify: /(?:wh\.verify|new\s+Webhook\s*\(|StandardWebhook|svix\.verify)/i,
      },
      {
        name: 'GitLab',
        sig: /x-gitlab-token/i,
        verify: /(?:x-gitlab-token['"\]]\s*[)=]|gitlabToken|secretCompare)/i,
      },
      {
        name: 'HubSpot',
        sig: /x-hubspot-signature/i,
        verify: /(?:createHmac|hmac\.|timingSafeEqual)/i,
      },
      {
        name: 'Vercel',
        sig: /x-vercel-signature/i,
        verify: /(?:createHmac|timingSafeEqual|crypto\.subtle)/i,
      },
      {
        name: 'Zoom',
        sig: /x-zm-signature|x-zm-request-timestamp/i,
        verify: /(?:createHmac|timingSafeEqual|crypto\.subtle)/i,
      },
      {
        name: 'Paddle',
        sig: /paddle-signature/i,
        verify: /(?:createHmac|timingSafeEqual)/i,
      },
      {
        name: 'LemonSqueezy',
        sig: /x-signature/i,
        verify: /(?:createHmac|timingSafeEqual)/i,
      },
    ];
    if (isHandler) {
      for (const p of PROVIDERS) {
        if (p.sig.test(c) && !p.verify.test(c)) {
          findings.push({
            id: `webhook-${p.name.replace(/\W+/g, '-').toLowerCase()}-${file.path}`,
            probe: 'Webhook Validation',
            title: `${p.name} webhook handler missing signature verification`,
            severity: 'high',
            category: 'Auth & Access',
            cwe: 'CWE-345',
            file: file.path,
            line: 1,
            evidence: `Reads request body and references ${p.name} signature header, but no verification call detected.`,
            remediation: `Validate the webhook signature with the provider's documented helper before trusting the event payload. ${p.name} signatures bind body + timestamp + secret; without the check, the endpoint accepts forged events.`,
          });
          break; // one provider per file is enough; don't multi-emit
        }
      }
    }
  });
  return findings;
}

// --- GitHub Actions Workflow Security ---

export function probeGitHubActions(files) {
  const findings = [];
  files.forEach((file) => {
    if (!/\.github\/workflows\/.+\.ya?ml$/.test(file.path)) return;
    const c = file.content;
    if (/pull_request_target/.test(c)) {
      // Depth round 3: the head.sha variant is the canonical attack shape the
      // Learn pattern shows, but the regex only caught head.ref/head_ref. Also
      // accept merge_commit_sha. The Learn pattern docs the exact shape we
      // were missing.
      const checkoutHead =
        /actions\/checkout@[\s\S]*?ref:\s*\$\{\{\s*github\.(?:event\.pull_request\.head\.(?:ref|sha)|head_ref|event\.pull_request\.merge_commit_sha)/.test(
          c
        );
      if (checkoutHead) {
        findings.push({
          id: `gha-prtarget-${file.path}`,
          probe: 'GitHub Actions',
          title: 'pull_request_target workflow checks out untrusted PR code',
          severity: 'critical',
          category: 'Supply Chain',
          cwe: 'CWE-829',
          file: file.path,
          line: 1,
          evidence: 'pull_request_target trigger combined with checkout of PR head ref',
          remediation:
            'pull_request_target runs with secrets and write permissions. Checking out the PR head and running scripts from it is privilege escalation: anyone who opens a PR can exfiltrate your secrets. Use pull_request instead, or split into untrusted-build (pull_request) plus trusted-deploy (workflow_run).',
        });
      }
    }
    // The uses: value may be single- or double-quoted (YAML allows both);
    // exclude quotes from the captures or a quoted 40-char SHA pin fails the
    // hex test below and gets misreported as a mutable ref.
    [...c.matchAll(/uses:\s*['"]?([^@\s'"]+)@([^\s'"]+)/g)].forEach((m) => {
      const [, action, ref] = m;
      if (action.startsWith('./') || action.includes('docker://')) return;
      const isSha = /^[a-f0-9]{40}$/.test(ref);
      const isVer = /^v?\d+(\.\d+)*$/.test(ref);
      // Depth round 3: GitHub's hardening guidance is unambiguous — only a
      // 40-char SHA is an immutable pin. Tags ARE mutable; a maintainer can
      // re-tag. Downgrade semver tags from "accepted" to medium.
      if (!isSha) {
        const ln = c.slice(0, m.index).split('\n').length;
        const isTag = isVer;
        findings.push({
          id: `gha-unpinned-${file.path}-${m.index}`,
          probe: 'GitHub Actions',
          title: isTag
            ? `Action "${action}" pinned to mutable tag "${ref}"`
            : `Action "${action}" pinned to mutable ref "${ref}"`,
          severity: 'medium',
          category: 'Supply Chain',
          cwe: 'CWE-1357',
          file: file.path,
          line: ln,
          evidence: m[0],
          remediation: isTag
            ? `Tags (including semver tags) are mutable on GitHub — the action's owner can re-tag the value at any time. GitHub's hardening guidance is to pin to a full 40-char commit SHA: uses: ${action}@<40-char-sha>. Dependabot/Renovate both support SHA-pinning with a comment for the tag.`
            : `If the action's owner is compromised your CI runs malicious code with whatever secrets you've granted. Pin to a full commit SHA: uses: ${action}@<40-char-sha>. Use Dependabot or Renovate to keep SHAs current.`,
        });
      }
    });
    // Depth round 3: permissions: write-all is explicit grant of every
    // permission to GITHUB_TOKEN. Critical.
    if (/permissions:\s*write-all\b/.test(c)) {
      const ln = c.slice(0, c.search(/permissions:\s*write-all/)).split('\n').length;
      findings.push({
        id: `gha-permissions-writeall-${file.path}`,
        probe: 'GitHub Actions',
        title: 'Workflow grants permissions: write-all to GITHUB_TOKEN',
        severity: 'critical',
        category: 'Supply Chain',
        cwe: 'CWE-250',
        file: file.path,
        line: ln,
        evidence: 'permissions: write-all',
        remediation:
          'write-all gives the workflow token write access to every scope (contents, issues, packages, deployments, etc.). Set the minimum necessary scope per job, e.g. permissions: { contents: read, pull-requests: write }. Default to permissions: read-all at the workflow level.',
      });
    }
    // Script injection: ${{ github.event.<untrusted>.<title|body|head.ref> }}
    // inside a `run:` block. The PR/issue/comment author controls these
    // fields; embedding them in a shell command runs as the workflow.
    [
      ...c.matchAll(
        /run:[^\n]*\$\{\{\s*github\.event\.(pull_request|issue|comment|discussion|review)\.(title|body|head\.ref)\s*\}\}/g
      ),
    ].forEach((m) => {
      const ln = c.slice(0, m.index).split('\n').length;
      findings.push({
        id: `gha-script-injection-${file.path}-${m.index}`,
        probe: 'GitHub Actions',
        title: `run: block interpolates attacker-controlled ${m[1]}.${m[2]}`,
        severity: 'high',
        category: 'Supply Chain',
        cwe: 'CWE-78',
        file: file.path,
        line: ln,
        evidence: m[0].slice(0, 200),
        remediation: `${m[1]}.${m[2]} is set by whoever opens the PR / issue / comment / discussion. Embedding it in a shell command turns the title into a shell command. Pass via env: instead — env: { FOO: \${{ github.event.${m[1]}.${m[2]} }} } and reference $FOO in run: which Bash quotes safely.`,
      });
    });
    // Self-hosted runner on a public-trigger workflow.
    if (
      /runs-on:\s*self-hosted/i.test(c) &&
      /on:\s*(?:[\s\S]*?\b)?(?:pull_request|pull_request_target)\b/.test(c)
    ) {
      findings.push({
        id: `gha-self-hosted-public-${file.path}`,
        probe: 'GitHub Actions',
        title: 'Self-hosted runner on a pull_request trigger',
        severity: 'high',
        category: 'Supply Chain',
        cwe: 'CWE-829',
        file: file.path,
        line: 1,
        evidence: 'runs-on: self-hosted with pull_request(_target) trigger',
        remediation:
          'GitHub explicitly recommends never using self-hosted runners on public repos with pull_request triggers — attackers can submit a PR whose code runs on your runner. Switch to ephemeral runners (Actions Runner Controller), GitHub-hosted runners, or restrict the workflow to a non-PR trigger.',
      });
    }
    // Credential exfiltration in a run: step. Two high-precision shapes, so a
    // legitimate `curl -H "Authorization: Bearer ${{ secrets.X }}" https://api`
    // (auth header to a known API) does NOT fire:
    //   (A) an env / printenv dump piped straight into a network command, or
    //   (B) a curl/wget that POSTs a secret as request DATA (-d/--data/-F/...).
    // This is the Miasma (June 2026) workflow vector: the worm injects a
    // workflow, often a fake codeql.yml, that ships ${{ secrets.* }} off-runner.
    [...c.matchAll(/^.*\b(?:curl|wget|nc|printenv|env)\b.*$/gim)].forEach((m) => {
      const stepLine = m[0];
      const envDumpToNet = /\b(?:printenv|env)\b\s*\|\s*(?:curl|wget|nc)\b/i.test(stepLine);
      // Anchor flags on whitespace, not \b: \b never matches before a dash
      // (a dash is a non-word char, so \b-d\b cannot match "-d").
      const dataFlag =
        /\b(?:curl|wget)\b.*\s(?:-d|-F|--data(?:-binary|-raw)?|--form|--upload-file)(?=\s|=|"|')/i.test(
          stepLine
        );
      const secretRef =
        /\$\{\{\s*secrets\./i.test(stepLine) ||
        /\$\{?GITHUB_TOKEN\}?/.test(stepLine) ||
        /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|APIKEY|API_KEY)\b/.test(stepLine) ||
        /\$\([^)]+\)|`[^`]+`/.test(stepLine); // command substitution as the payload
      if (!envDumpToNet && !(dataFlag && secretRef)) return;
      const ln = c.slice(0, m.index).split('\n').length;
      findings.push({
        id: `gha-secret-exfil-${file.path}-${m.index}`,
        probe: 'GitHub Actions',
        title: 'Workflow step sends secrets or credentials to an external host',
        severity: 'critical',
        category: 'Supply Chain',
        cwe: 'CWE-200',
        file: file.path,
        line: ln,
        evidence: stepLine.trim().slice(0, 200),
        remediation:
          'A run step that dumps the environment or POSTs ${{ secrets.* }} / $GITHUB_TOKEN as request data to curl / wget / nc is credential exfiltration. This is the injection shape used by the 2026 Miasma npm worm, often committed as a fake codeql.yml. Remove the step, rotate every secret the workflow can read, and review recent workflow runs for exfiltration. Secrets should never leave the runner.',
      });
    });
  });
  return findings;
}

// --- Client-side auth token storage ---
