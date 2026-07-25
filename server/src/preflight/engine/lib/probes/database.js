// src/lib/probes/database.js
//
// Database-rules probes: Supabase RLS, Firebase Rules.
//
// Extracted from the prior builtin.js monolith when it crossed the
// file-size HIGH threshold. Probe bodies are byte-identical to the
// originals; only the location moved. Public import surface is
// preserved by builtin.js, which is now a back-compat shim re-exporting
// every probe function from its new family file.

export function probeSupabaseRLS(files) {
  const findings = [];
  files.forEach((file) => {
    if (!/\.sql$/.test(file.path)) return;
    const content = file.content;
    // Allow case-insensitive identifier capture (Supabase + Postgres allow "Users" etc).
    const tableMatches = [
      ...content.matchAll(
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[a-z_][\w]*\.)?["`]?([A-Za-z_][\w]*)["`]?/gi
      ),
    ];
    tableMatches.forEach((tm) => {
      const tableName = tm[1];
      // Match the same table regardless of schema qualifier (public.users, app.users, plain users).
      const enableRegex = new RegExp(
        `alter\\s+table\\s+(?:[a-z_][\\w]*\\.)?["\`]?${tableName}["\`]?\\s+enable\\s+row\\s+level\\s+security`,
        'i'
      );
      if (!enableRegex.test(content)) {
        findings.push({
          id: `rls-${file.path}-${tableName}`,
          probe: 'Supabase RLS Check',
          title: `Table "${tableName}" missing ENABLE ROW LEVEL SECURITY`,
          severity: 'critical',
          category: 'Data Breach',
          cwe: 'CWE-284',
          file: file.path,
          line: tm.index ? content.slice(0, tm.index).split('\n').length : 1,
          evidence: tm[0],
          remediation: `Add the following to your migration:\n\nALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY;\n\nThen create explicit policies for SELECT, INSERT, UPDATE, DELETE. Without RLS, any client with the anon key can read and modify all rows. This is the single most common Supabase production breach.`,
        });
      }
    });
    const permissivePolicies = [
      ...content.matchAll(/create\s+policy[\s\S]*?using\s*\(\s*true\s*\)/gi),
    ];
    permissivePolicies.forEach((pm) => {
      findings.push({
        id: `rls-permissive-${file.path}-${pm.index}`,
        probe: 'Supabase RLS Check',
        title: 'Permissive RLS policy "USING (true)"',
        severity: 'high',
        category: 'Data Breach',
        cwe: 'CWE-284',
        file: file.path,
        line: content.slice(0, pm.index).split('\n').length,
        evidence: pm[0].slice(0, 200).replace(/\s+/g, ' '),
        remediation: `A USING (true) policy allows the policy role to access every row. Replace with an explicit predicate, e.g. USING (auth.uid() = user_id) for owner-only access, or scope to specific roles.`,
      });
    });
    // Depth round 3: WITH CHECK (true) is the insert/update analog of USING(true).
    [...content.matchAll(/create\s+policy[\s\S]*?with\s+check\s*\(\s*true\s*\)/gi)].forEach(
      (pm) => {
        findings.push({
          id: `rls-permissive-check-${file.path}-${pm.index}`,
          probe: 'Supabase RLS Check',
          title: 'Permissive RLS policy "WITH CHECK (true)"',
          severity: 'high',
          category: 'Data Breach',
          cwe: 'CWE-284',
          file: file.path,
          line: content.slice(0, pm.index).split('\n').length,
          evidence: pm[0].slice(0, 200).replace(/\s+/g, ' '),
          remediation:
            'WITH CHECK (true) lets the policy role insert or update any row. Replace with the same ownership predicate you use for USING, e.g. WITH CHECK (auth.uid() = user_id).',
        });
      }
    );
    // Depth round 3: explicit DISABLE ROW LEVEL SECURITY is a critical
    // regression — the table was protected, now it isn't.
    [
      ...content.matchAll(
        /alter\s+table\s+(?:[a-z_][\w]*\.)?["`]?([A-Za-z_][\w]*)["`]?\s+disable\s+row\s+level\s+security/gi
      ),
    ].forEach((dm) => {
      findings.push({
        id: `rls-disabled-${file.path}-${dm.index}`,
        probe: 'Supabase RLS Check',
        title: `Row Level Security explicitly DISABLED on "${dm[1]}"`,
        severity: 'critical',
        category: 'Data Breach',
        cwe: 'CWE-284',
        file: file.path,
        line: content.slice(0, dm.index).split('\n').length,
        evidence: dm[0],
        remediation:
          'DISABLE ROW LEVEL SECURITY removes all per-row authorization. Any client with anon key access can read or modify every row. Re-enable with ALTER TABLE ... ENABLE ROW LEVEL SECURITY and define policies; if you intentionally need owner-bypass, scope it to specific roles via FORCE ROW LEVEL SECURITY semantics.',
      });
    });
    // SECURITY DEFINER function referenced inside USING() of a policy bypasses
    // the caller's RLS — runs with creator's permissions. Canonical RLS escape.
    const definerFns = [
      ...content.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z_]\w*)[\s\S]*?security\s+definer/gi
      ),
    ].map((m) => m[1]);
    if (definerFns.length) {
      const policyUsingFns = [
        ...content.matchAll(/create\s+policy[\s\S]*?using\s*\(\s*([a-zA-Z_]\w*)\s*\(/gi),
      ];
      policyUsingFns.forEach((pm) => {
        if (definerFns.includes(pm[1])) {
          findings.push({
            id: `rls-securitydefiner-${file.path}-${pm.index}`,
            probe: 'Supabase RLS Check',
            title: `Policy uses SECURITY DEFINER function ${pm[1]}() (bypasses caller's RLS)`,
            severity: 'high',
            category: 'Data Breach',
            cwe: 'CWE-274',
            file: file.path,
            line: content.slice(0, pm.index).split('\n').length,
            evidence: pm[0].slice(0, 200).replace(/\s+/g, ' '),
            remediation: `${pm[1]}() is declared SECURITY DEFINER, so it runs with the function-creator's privileges (usually postgres) rather than the caller's. When called from a policy, it can read data the caller wasn't authorized to see, defeating RLS. Switch the function to SECURITY INVOKER, or inline the check.`,
          });
        }
      });
    }
  });
  return findings;
}

export function probeFirebaseRules(files) {
  const findings = [];
  files.forEach((file) => {
    // Depth round 3: added Realtime Database rules (database.rules.json /
    // database.rules / *.rules.bolt). RTDB uses a JSON tree of .read/.write
    // string expressions; check for the literal "true" or "auth != null".
    if (/(?:^|\/)database\.rules\.json$/.test(file.path)) {
      let parsed;
      try {
        parsed = JSON.parse(file.content);
      } catch {
        return;
      }
      const walk = (node, path, line) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, val] of Object.entries(node)) {
          if (key === '.read' || key === '.write') {
            const expr = String(val).trim();
            if (expr === 'true') {
              findings.push({
                id: `firebase-rtdb-true-${file.path}-${path}-${key}`,
                probe: 'Firebase Rules Check',
                title: `Realtime DB rule ${key} grants unrestricted access at ${path || '/'}`,
                severity: 'critical',
                category: 'Data Breach',
                cwe: 'CWE-284',
                file: file.path,
                line: 1,
                evidence: `"${path || '/'}": { "${key}": "true" }`,
                remediation: `"true" in a Realtime DB .read/.write rule lets anyone on the internet read or write this path. Replace with an auth + ownership expression, e.g. ".read": "auth != null && data.child('owner').val() === auth.uid".`,
              });
            } else if (expr === 'auth != null' || expr === 'auth.uid != null') {
              findings.push({
                id: `firebase-rtdb-authonly-${file.path}-${path}-${key}`,
                probe: 'Firebase Rules Check',
                title: `Realtime DB rule ${key} allows any authenticated user at ${path || '/'}`,
                severity: 'high',
                category: 'Data Breach',
                cwe: 'CWE-284',
                file: file.path,
                line: 1,
                evidence: `"${path || '/'}": { "${key}": "${expr}" }`,
                remediation:
                  'Any logged-in user can read or write this node, including reading other users data. Add an ownership check: "auth.uid === $uid" with a "$uid" wildcard segment.',
              });
            }
          } else if (typeof val === 'object') {
            walk(val, path + '/' + key, line);
          }
        }
      };
      if (parsed && parsed.rules) walk(parsed.rules, '', 1);
      return;
    }
    if (!/firestore\.rules$|storage\.rules$|\.rules\.bolt$/.test(file.path)) return;
    const content = file.content;
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (/allow\s+(read|write|create|update|delete|get|list)[^;]*:\s*if\s+true\s*;/.test(line)) {
        findings.push({
          id: `firebase-true-${file.path}-${i}`,
          probe: 'Firebase Rules Check',
          title: 'Firebase rule grants unrestricted access',
          severity: 'critical',
          category: 'Data Breach',
          cwe: 'CWE-284',
          file: file.path,
          line: i + 1,
          evidence: line.trim(),
          remediation: `"if true" allows anyone on the internet to read or write. Replace with an authentication check at minimum (request.auth != null) and an ownership check ideally (request.auth.uid == resource.data.userId). Test rules in the Firebase emulator before deploying.`,
        });
      }
      // Depth round 3: drop the storage-rules-only gate. Firestore rules with
      // `allow X: if request.auth != null` is THE canonical leak shape and
      // the Learn pattern names it explicitly. Also accept the
      // `request.auth.uid != null` semantic dup and `auth.uid IS NOT NULL`
      // SQL-ish variants.
      if (
        /allow\s+(?:read|write|create|update|delete|get|list)[^;]*:\s*if\s+request\.auth(?:\.uid)?\s*(?:!=|<>)\s*null\s*;/.test(
          line
        )
      ) {
        const isStorage = /storage\.rules$/.test(file.path);
        findings.push({
          id: `firebase-auth-only-${file.path}-${i}`,
          probe: 'Firebase Rules Check',
          title: isStorage
            ? 'Storage rule allows any authenticated user'
            : 'Firestore rule allows any authenticated user',
          severity: 'high',
          category: 'Data Breach',
          cwe: 'CWE-284',
          file: file.path,
          line: i + 1,
          evidence: line.trim(),
          remediation: isStorage
            ? `Any authenticated user can read or write this path, including users accessing each other's files. Add an ownership check, e.g. allow read: if request.auth.uid == resource.metadata.ownerId;`
            : `Any authenticated user can read or write this document, including reading other users data. Add ownership: allow read: if request.auth.uid == resource.data.owner; and writes that verify request.resource.data.owner == request.auth.uid.`,
        });
      }
      // Recursive wildcard + auth-only is the canonical "any logged-in user
      // reads everything" shape (per the Learn pattern).
      if (
        /match\s+\/\{[a-zA-Z_]+=\*\*\}\s*\{[^}]*allow\s+(?:read|write)[^;]*:\s*if\s+request\.auth\s*!=\s*null/.test(
          content
        ) &&
        line.includes('{document=**}')
      ) {
        findings.push({
          id: `firebase-recursive-wildcard-${file.path}-${i}`,
          probe: 'Firebase Rules Check',
          title: 'Recursive wildcard match grants auth-only access to all documents',
          severity: 'critical',
          category: 'Data Breach',
          cwe: 'CWE-284',
          file: file.path,
          line: i + 1,
          evidence: line.trim(),
          remediation:
            'A recursive wildcard `match /{document=**}` with `if request.auth != null` lets any logged-in user read every document in your database. Scope rules to specific collections with ownership predicates.',
        });
      }
      // Explicit disable of the implicit deny.
      if (/allow\s+(?:read|write|create|update|delete)[^;]*:\s*if\s+false\s*;/.test(line)) {
        // Explicit deny is intentional — no finding. Documented as the
        // recommended kill-switch.
      }
    });
  });
  return findings;
}
