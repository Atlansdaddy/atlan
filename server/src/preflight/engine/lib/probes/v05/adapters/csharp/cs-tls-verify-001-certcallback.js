// src/lib/probes/v05/adapters/csharp/cs-tls-verify-001-certcallback.js
//
// XL-004 adapter for C#. RX-based. HttpClientHandler /
// ServicePointManager certificate-validation callbacks that
// unconditionally return true (or use the Dangerous* helper). Corpus:
// "HttpClientHandler.ServerCertificateCustomValidationCallback returning true".

import { csharpFiles, isCsCommentLine } from '../../shared-detectors/csharp-scope.js';

const PROBE_NAME = 'C# TLS Verification Disabled';

const CALLBACK_TRUE_RE =
  /(?:ServerCertificateCustomValidationCallback|ServerCertificateValidationCallback|RemoteCertificateValidationCallback)\s*(?:\+?=)\s*(?:\([^)]*\)\s*=>\s*true|delegate\s*\([^)]*\)\s*\{\s*return\s+true)/;
const DANGEROUS_HELPER_RE = /HttpClientHandler\.DangerousAcceptAnyServerCertificateValidator/;

export const CS_TLS_VERIFY_001 = {
  probe_id: 'CS-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'csharp',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.cs',
  what_it_catches:
    'A certificate-validation callback (ServerCertificateCustomValidationCallback / ServicePointManager / RemoteCertificateValidationCallback) that returns true unconditionally, or HttpClientHandler.DangerousAcceptAnyServerCertificateValidator.',
  why_ai_v05:
    'A self-signed or corporate cert breaks HttpClient; the corpus fix is a true-returning callback or the Dangerous* helper, not a pinned root.',
  vibe_v05: '"Return true from the cert callback so the request stops failing."',
  detection_approach:
    'RX per line: a cert-validation callback assigned a (..)=>true / delegate{return true}, or the DangerousAcceptAnyServerCertificateValidator helper.',
  fp_gates_v05: [
    'comment lines',
    'a callback that actually inspects sslPolicyErrors / the chain',
    '*Tests.cs / src/test / scanner self-source / fixture tree (csharpFiles())',
  ],
  remediation:
    'Remove the callback and use the platform trust store, or validate sslPolicyErrors == None and pin the expected certificate/thumbprint. Never return true unconditionally.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CS-TLS-VERIFY-001/positive.cs',
    negative: 'src/lib/probes/v05/fixtures/CS-TLS-VERIFY-001/negative.cs',
  },
  known_incidents: 'CWE-295; OWASP A02; .NET cert-callback MitM advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of csharpFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCsCommentLine(line)) return;
        if (!CALLBACK_TRUE_RE.test(line) && !DANGEROUS_HELPER_RE.test(line)) return;
        findings.push({
          id: `cs-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (cert callback returns true)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use the platform trust store, or validate sslPolicyErrors == None and pin the cert. Never return true unconditionally.',
        });
      });
    }
    return findings;
  },
};
