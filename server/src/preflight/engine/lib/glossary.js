// src/lib/glossary.js
//
// The PreFlight glossary. Every concept PreFlight names anywhere in the app
// (probe findings, patterns, field reports, Sam / Demi / Drew / Vera, the
// manifesto) has a one-line definition here and a link to an authoritative
// free reference. The component at /learn/glossary renders it; nothing else
// in the app references this module directly, by design — the glossary is a
// reference surface, not a runtime dependency.
//
// Curation criteria:
//   1. Every term has a one-sentence definition under ~25 words.
//   2. Every external link goes to a free, authoritative source: Wikipedia,
//      MDN, OWASP, MITRE CWE, RFCs, official spec / vendor docs, named
//      research organizations. No paywalled book pages. No competing
//      security platforms.
//   3. Where PreFlight has its own pattern / field-report page, the entry's
//      `internal` field links to it. The external link is the broader
//      reference; the internal link is the PreFlight-specific deep dive.
//   4. Groups are ordered roughly by how often a viber will encounter the
//      vocabulary: security first, AI/LLM second, CS fundamentals later for
//      readers who want to keep going.
//
// Entry schema:
//   {
//     term: 'Display name',
//     definition: 'One sentence, plain English.',
//     link: 'https://...',           // external authoritative source
//     internal?: '/learn/...',       // optional internal PreFlight page
//     aliases?: ['acronym', 'syn.'], // optional alternate names for search
//   }

export const GLOSSARY_GROUPS = [
  // ============================================================================
  // Web application security
  // ============================================================================
  {
    id: 'web-security',
    title: 'Web application security',
    intro:
      'The vocabulary that shows up on most finding cards. If you read one section in order, this is the one.',
    entries: [
      {
        term: 'XSS (Cross-Site Scripting)',
        definition:
          "Attacker-controlled HTML or JavaScript executed in a victim's browser via a vulnerable page.",
        link: 'https://owasp.org/www-community/attacks/xss/',
        internal: '/learn/patterns/html-hygiene',
        aliases: ['cross site scripting'],
      },
      {
        term: 'CSRF (Cross-Site Request Forgery)',
        definition:
          'A request the user did not intend, sent from a malicious site to a service the user is logged into.',
        link: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html',
        aliases: ['xsrf'],
      },
      {
        term: 'SSRF (Server-Side Request Forgery)',
        definition:
          'A server tricked into making an outbound HTTP request to a destination the attacker controls or chooses.',
        link: 'https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/',
        internal: '/learn/patterns/ssrf-open-redirect',
      },
      {
        term: 'SQL injection',
        definition:
          'User input concatenated into a SQL string at parse time, letting attackers rewrite the query.',
        link: 'https://owasp.org/Top10/A03_2021-Injection/',
        internal: '/learn/patterns/sql-injection',
        aliases: ['sqli'],
      },
      {
        term: 'Path traversal',
        definition:
          'A user-controlled path that lets the attacker read or write files outside the intended directory.',
        link: 'https://owasp.org/www-community/attacks/Path_Traversal',
        internal: '/learn/patterns/path-traversal',
      },
      {
        term: 'IDOR (Insecure Direct Object Reference)',
        definition:
          "Authorization missing on a per-row basis; user A can request user B's record by changing an ID.",
        link: 'https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html',
      },
      {
        term: 'RCE (Remote Code Execution)',
        definition:
          'An attacker runs arbitrary code on the target system without prior authorization.',
        link: 'https://cwe.mitre.org/data/definitions/94.html',
        aliases: ['remote code execution'],
      },
      {
        term: 'Open redirect',
        definition:
          "An endpoint that redirects to a URL controlled by the user, letting attackers borrow the domain's trust.",
        link: 'https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html',
        internal: '/learn/patterns/ssrf-open-redirect',
      },
      {
        term: 'CORS (Cross-Origin Resource Sharing)',
        definition:
          'The browser policy that controls which origins can read responses from a given API.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
        internal: '/learn/patterns/cors',
      },
      {
        term: 'CSP (Content Security Policy)',
        definition:
          'A response header that whitelists which sources a page can load scripts, styles, images, and connections from.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP',
        internal: '/learn/patterns/security-headers',
      },
      {
        term: 'HSTS (HTTP Strict Transport Security)',
        definition:
          'A header that tells browsers to use HTTPS for the domain for a given duration, defeating downgrade attacks.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
        internal: '/learn/patterns/security-headers',
      },
      {
        term: 'X-Frame-Options',
        definition:
          'A header that prevents a page from being embedded in an iframe (clickjacking defense).',
        link: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options',
      },
      {
        term: 'Subresource Integrity (SRI)',
        definition:
          'A hash attribute on a script or stylesheet tag that lets the browser refuse altered content.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity',
        internal: '/learn/patterns/subresource-integrity',
      },
      {
        term: 'HttpOnly cookie',
        definition:
          'A cookie attribute that prevents JavaScript from reading the cookie value, mitigating XSS-to-session theft.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#httponly',
        internal: '/learn/patterns/cookie-security',
      },
      {
        term: 'SameSite cookie',
        definition:
          'A cookie attribute that controls whether the cookie is sent on cross-site requests (CSRF defense).',
        link: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitesamesite-value',
      },
      {
        term: 'JWT (JSON Web Token)',
        definition:
          'A signed-or-encrypted token format with a JSON payload, commonly used for auth state.',
        link: 'https://datatracker.ietf.org/doc/html/rfc7519',
        internal: '/learn/patterns/auth-weakness',
      },
      {
        term: 'OAuth 2.0',
        definition:
          'The standard authorization framework that lets a user grant a third-party app limited access to their account.',
        link: 'https://datatracker.ietf.org/doc/html/rfc6749',
      },
      {
        term: 'OpenID Connect (OIDC)',
        definition:
          'An identity layer on top of OAuth 2.0 that lets clients verify who the user is.',
        link: 'https://openid.net/specs/openid-connect-core-1_0.html',
      },
      {
        term: 'mTLS (Mutual TLS)',
        definition:
          'TLS where both the client and the server present certificates, used for service-to-service auth.',
        link: 'https://en.wikipedia.org/wiki/Mutual_authentication',
      },
      {
        term: 'MFA (Multi-Factor Authentication)',
        definition:
          'Requiring two or more independent credentials (password, device, biometric) for a single login.',
        link: 'https://en.wikipedia.org/wiki/Multi-factor_authentication',
      },
      {
        term: 'SAML',
        definition:
          'An XML-based standard for enterprise single sign-on, predates and overlaps with OAuth/OIDC.',
        link: 'https://en.wikipedia.org/wiki/Security_Assertion_Markup_Language',
      },
      {
        term: 'Same-Origin Policy (SOP)',
        definition:
          'The browser rule that prevents scripts on one origin from reading data on another.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy',
      },
      {
        term: 'Tabnabbing',
        definition:
          'An attack where a page opened via target="_blank" rewrites the parent tab to a phishing site.',
        link: 'https://owasp.org/www-community/attacks/Reverse_Tabnabbing',
      },
      {
        term: 'Clickjacking',
        definition:
          'Tricking a user into clicking something different from what they perceive, often via an invisible iframe.',
        link: 'https://owasp.org/www-community/attacks/Clickjacking',
      },
      {
        term: 'Trojan Source',
        definition:
          'A code-execution attack that uses Unicode bidi control characters to make source render differently than it compiles.',
        link: 'https://trojansource.codes/',
        internal: '/learn/patterns/trojan-source',
      },
    ],
  },

  // ============================================================================
  // Cryptography + identity
  // ============================================================================
  {
    id: 'crypto',
    title: 'Cryptography and identity',
    intro:
      'The primitives behind every authentication, signature, and secret. Most findings touch one of these.',
    entries: [
      {
        term: 'AES (Advanced Encryption Standard)',
        definition: 'The default symmetric cipher for most data-at-rest and TLS workloads.',
        link: 'https://en.wikipedia.org/wiki/Advanced_Encryption_Standard',
      },
      {
        term: 'RSA',
        definition: 'A widely-used asymmetric cipher; keys are typically 2048 or 4096 bits.',
        link: 'https://en.wikipedia.org/wiki/RSA_cryptosystem',
      },
      {
        term: 'ECDSA',
        definition:
          'Elliptic Curve Digital Signature Algorithm. Faster and smaller-key than RSA for the same security.',
        link: 'https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm',
      },
      {
        term: 'Ed25519',
        definition: 'A modern elliptic-curve signature scheme. Recommended for new signing keys.',
        link: 'https://ed25519.cr.yp.to/',
      },
      {
        term: 'HMAC',
        definition:
          'A message authentication code built on a hash function. Used for signing webhooks and JWTs.',
        link: 'https://datatracker.ietf.org/doc/html/rfc2104',
      },
      {
        term: 'SHA-256',
        definition: 'A 256-bit cryptographic hash function in the SHA-2 family.',
        link: 'https://en.wikipedia.org/wiki/SHA-2',
      },
      {
        term: 'CSPRNG',
        definition:
          'Cryptographically secure pseudo-random number generator. Math.random is NOT one.',
        link: 'https://en.wikipedia.org/wiki/Cryptographically_secure_pseudorandom_number_generator',
        internal: '/learn/patterns/weak-randomness',
      },
      {
        term: 'Salt',
        definition:
          'Random bytes added to a password before hashing so the same password produces different hashes.',
        link: 'https://en.wikipedia.org/wiki/Salt_(cryptography)',
      },
      {
        term: 'Nonce',
        definition: 'A number used once. Random or sequential, used to prevent replay attacks.',
        link: 'https://en.wikipedia.org/wiki/Cryptographic_nonce',
      },
      {
        term: 'Argon2',
        definition:
          'The modern recommended password-hashing function. Tunable for memory + time costs.',
        link: 'https://en.wikipedia.org/wiki/Argon2',
      },
      {
        term: 'bcrypt',
        definition:
          'A long-standing password-hashing function. Still acceptable; Argon2 is the modern preference.',
        link: 'https://en.wikipedia.org/wiki/Bcrypt',
      },
      {
        term: 'HSM (Hardware Security Module)',
        definition:
          'A dedicated device for storing keys and performing crypto operations. Keys never leave the HSM.',
        link: 'https://en.wikipedia.org/wiki/Hardware_security_module',
      },
      {
        term: 'Certificate transparency',
        definition:
          'A public log of every issued TLS certificate. Lets domain owners detect misissued certs.',
        link: 'https://certificate.transparency.dev/',
      },
    ],
  },

  // ============================================================================
  // Supply chain
  // ============================================================================
  {
    id: 'supply-chain',
    title: 'Supply chain',
    intro: 'The vocabulary of the 2025-2026 npm worm waves and the broader package-trust problem.',
    entries: [
      {
        term: 'Typosquat',
        definition:
          'A package registered with a name one character off from a popular one, hoping for install typos.',
        link: 'https://usa.kaspersky.com/resource-center/definitions/what-is-typosquatting',
        internal: '/learn/patterns/slopsquat-typosquat',
      },
      {
        term: 'Slopsquat',
        definition:
          'A package registered to match a name that LLMs commonly hallucinate, harvesting installs from vibe-coded projects.',
        link: 'https://www.lasso.security/blog/slopsquatting',
        internal: '/learn/patterns/slopsquat-typosquat',
      },
      {
        term: 'Dependency confusion',
        definition:
          'An attack that abuses package managers preferring public-registry versions over private ones with the same name.',
        link: 'https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610',
      },
      {
        term: 'SBOM (Software Bill of Materials)',
        definition:
          'A formal record of every dependency in a build. Used for vulnerability scanning and audit.',
        link: 'https://www.cisa.gov/sbom',
      },
      {
        term: 'SLSA',
        definition:
          'Supply-chain Levels for Software Artifacts. A framework for build-pipeline integrity.',
        link: 'https://slsa.dev/',
      },
      {
        term: 'Postinstall script',
        definition:
          'An npm lifecycle hook that runs arbitrary code at install time. The execution surface most worms abuse.',
        link: 'https://docs.npmjs.com/cli/v10/using-npm/scripts',
        internal: '/learn/patterns/package-json-supply-chain',
      },
      {
        term: 'ignore-scripts',
        definition:
          'An npm config flag that disables lifecycle scripts. Recommended for CI runners.',
        link: 'https://docs.npmjs.com/cli/v10/using-npm/config#ignore-scripts',
      },
      {
        term: 'min-release-age',
        definition:
          'An npm config that refuses to install package versions younger than the given age. Defeats fast-moving worms.',
        link: 'https://docs.npmjs.com/cli/v10/using-npm/config',
      },
      {
        term: 'Lockfile',
        definition:
          'A version-pinned manifest (package-lock.json, yarn.lock, pnpm-lock.yaml) that fixes the dependency tree.',
        link: 'https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json',
      },
      {
        term: 'Shai-Hulud',
        definition:
          'The September 2025 npm worm wave. Postinstall scripts stole maintainer tokens and republished poisoned packages.',
        link: 'https://github.com/advisories?query=Shai-Hulud',
      },
      {
        term: 'Mini Shai-Hulud',
        definition:
          'The 2026 successor wave. April SAP / Bitwarden waves and the May 11 TanStack wave by TeamPCP.',
        link: '/learn/incidents/mini-shai-hulud-tanstack-2026-05',
        internal: '/learn/incidents/mini-shai-hulud-tanstack-2026-05',
      },
      {
        term: 'Indicator of Compromise (IOC)',
        definition:
          'A signature, hash, file path, or string that identifies a known attack on a host.',
        link: 'https://en.wikipedia.org/wiki/Indicator_of_compromise',
        internal: '/learn/patterns/malicious-artifacts',
      },
    ],
  },

  // ============================================================================
  // AI / LLM security
  // ============================================================================
  {
    id: 'ai-llm',
    title: 'AI and LLM security',
    intro: 'OWASP LLM Top 10 vocabulary plus the AI-tooling specifics PreFlight scans for.',
    entries: [
      {
        term: 'LLM (Large Language Model)',
        definition:
          'A transformer-based model trained on text to predict the next token. The thing your AI tool is.',
        link: 'https://en.wikipedia.org/wiki/Large_language_model',
      },
      {
        term: 'Prompt injection',
        definition:
          'User input crafted to override the system prompt and make the model follow attacker instructions.',
        link: 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/',
        internal: '/learn/patterns/llm-security',
      },
      {
        term: 'Indirect prompt injection',
        definition:
          'Prompt injection delivered via content the model reads later (a document, a page, a tool output).',
        link: 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/',
        internal: '/learn/patterns/rag-ingestion',
      },
      {
        term: 'RAG (Retrieval-Augmented Generation)',
        definition:
          'A pattern where the model is given chunks retrieved from a vector store as context for the query.',
        link: 'https://aws.amazon.com/what-is/retrieval-augmented-generation/',
        internal: '/learn/patterns/rag-ingestion',
      },
      {
        term: 'Embedding',
        definition:
          'A vector representation of text that captures semantic meaning. Used for similarity search.',
        link: 'https://en.wikipedia.org/wiki/Word_embedding',
      },
      {
        term: 'Vector store',
        definition:
          'A database optimized for high-dimensional nearest-neighbor search over embeddings.',
        link: 'https://en.wikipedia.org/wiki/Vector_database',
        internal: '/learn/patterns/vector-embedding-weaknesses',
      },
      {
        term: 'Context window',
        definition:
          'The maximum number of tokens (input + output) a model can attend to in one request.',
        link: 'https://en.wikipedia.org/wiki/Large_language_model#Context_window',
      },
      {
        term: 'System prompt',
        definition:
          "The fixed instruction text given to a model alongside the user prompt. Defines the assistant's persona.",
        link: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts',
      },
      {
        term: 'Temperature',
        definition:
          'The randomness knob on model sampling. 0 is deterministic; higher values increase variety.',
        link: 'https://docs.anthropic.com/en/api/messages',
      },
      {
        term: 'Tokenization',
        definition:
          'The step that splits text into subword units the model actually processes. Cost is per token.',
        link: 'https://platform.openai.com/tokenizer',
      },
      {
        term: 'In-context learning',
        definition:
          'A model adapting to a task from examples in the prompt, without weight updates.',
        link: 'https://en.wikipedia.org/wiki/Large_language_model#In-context_learning',
      },
      {
        term: 'Fine-tuning',
        definition:
          'Continuing the training of a pretrained model on task-specific data to adjust its weights.',
        link: 'https://en.wikipedia.org/wiki/Fine-tuning_(deep_learning)',
      },
      {
        term: 'RLHF (Reinforcement Learning from Human Feedback)',
        definition:
          'A training method where humans rank model outputs and the model learns to prefer the higher-ranked ones.',
        link: 'https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback',
      },
      {
        term: 'MCP (Model Context Protocol)',
        definition:
          'The standard for connecting AI assistants to local and remote tools. The interop layer for agents.',
        link: 'https://modelcontextprotocol.io/',
        internal: '/learn/patterns/mcp-security',
      },
      {
        term: 'Persona / Persona+',
        definition:
          "A structured prompt spec that defines an agent's role, skills, voice, and refusals. PreFlight ships four.",
        link: '/learn',
        internal: '/learn/manifesto',
      },
      {
        term: 'Jailbreak',
        definition:
          "A prompt-injection variant that bypasses an LLM's safety training to elicit refused outputs.",
        link: 'https://en.wikipedia.org/wiki/Prompt_injection',
      },
      {
        term: 'Hallucination',
        definition:
          'Model output that sounds plausible but is factually wrong or refers to things that do not exist.',
        link: 'https://en.wikipedia.org/wiki/Hallucination_(artificial_intelligence)',
      },
    ],
  },

  // ============================================================================
  // OWASP categories
  // ============================================================================
  {
    id: 'owasp',
    title: 'OWASP categories',
    intro:
      'The Top 10 (2025 edition) and LLM Top 10 (2025 edition), one-line each. Full mapping at /learn/owasp.',
    entries: [
      {
        term: 'A01: Broken Access Control',
        definition: 'Authorization missing or wrong. The most prevalent application security risk.',
        link: 'https://owasp.org/Top10/A01_2021-Broken_Access_Control/',
      },
      {
        term: 'A02: Cryptographic Failures',
        definition:
          'Secrets or sensitive data exposed via weak crypto, insecure storage, or insecure transport.',
        link: 'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
      },
      {
        term: 'A03: Injection',
        definition:
          'User input executed as code or query. SQL injection, command injection, NoSQL injection, LDAP injection.',
        link: 'https://owasp.org/Top10/A03_2021-Injection/',
      },
      {
        term: 'A04: Insecure Design',
        definition:
          'A system designed in a way that produces vulnerable shapes regardless of how carefully each line is written.',
        link: 'https://owasp.org/Top10/A04_2021-Insecure_Design/',
      },
      {
        term: 'A05: Security Misconfiguration',
        definition: 'Defaults left in production, security headers absent, dev surfaces exposed.',
        link: 'https://owasp.org/Top10/A05_2021-Security_Misconfiguration/',
      },
      {
        term: 'A06: Vulnerable and Outdated Components',
        definition:
          'Known-vulnerable dependencies still in production. Supply-chain compromises live here.',
        link: 'https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/',
      },
      {
        term: 'A07: Authentication Failures',
        definition:
          'Weak password policy, missing MFA, session handling errors, credential stuffing tolerance.',
        link: 'https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/',
      },
      {
        term: 'A08: Software and Data Integrity Failures',
        definition:
          'Trust placed in components or supply-chain artifacts that have not been verified.',
        link: 'https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/',
      },
      {
        term: 'A09: Security Logging Failures',
        definition:
          'Security events that happen without leaving a log. The blind spot in every incident response.',
        link: 'https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/',
      },
      {
        term: 'A10: SSRF',
        definition: 'Server-Side Request Forgery. Server fetches a URL the client supplies.',
        link: 'https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/',
      },
      {
        term: 'LLM01: Prompt Injection',
        definition:
          'User input that overrides the system prompt or smuggles instructions through retrieved context.',
        link: 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/',
      },
      {
        term: 'LLM02: Sensitive Information Disclosure',
        definition:
          'Model output that reveals data the calling user should not see (system prompt, other tenants, training data).',
        link: 'https://genai.owasp.org/llmrisk/llm02-sensitive-information-disclosure/',
      },
      {
        term: 'LLM04: Data and Model Poisoning',
        definition:
          'Attacker-controlled content injected into training data or RAG ingestion pipelines.',
        link: 'https://genai.owasp.org/llmrisk/llm04-data-and-model-poisoning/',
      },
      {
        term: 'LLM06: Excessive Agency',
        definition:
          'An agent with tool capabilities beyond what the task requires. Big blast radius on injection.',
        link: 'https://genai.owasp.org/llmrisk/llm06-excessive-agency/',
      },
      {
        term: 'LLM07: System Prompt Leakage',
        definition:
          'System prompts surfaced via error messages, debug output, or model-coaxed disclosure.',
        link: 'https://genai.owasp.org/llmrisk/llm07-system-prompt-leakage/',
      },
      {
        term: 'LLM08: Vector and Embedding Weaknesses',
        definition:
          'Cross-tenant retrieval leakage, embedding-cache poisoning, query-time scope filter bypass.',
        link: 'https://genai.owasp.org/llmrisk/llm08-vector-and-embedding-weaknesses/',
      },
    ],
  },

  // ============================================================================
  // CS fundamentals (CS101)
  // ============================================================================
  {
    id: 'cs101',
    title: 'CS fundamentals',
    intro:
      'Vocabulary every developer should be able to define. If you came from non-CS background and want to fill in the gaps, see also the Resources page CS section.',
    entries: [
      {
        term: 'Algorithm',
        definition:
          'A finite sequence of well-defined steps for solving a problem or computing a value.',
        link: 'https://en.wikipedia.org/wiki/Algorithm',
      },
      {
        term: 'Data structure',
        definition: 'A way of organizing data so the operations you care about are efficient.',
        link: 'https://en.wikipedia.org/wiki/Data_structure',
      },
      {
        term: 'Big O notation',
        definition: "Notation for how an algorithm's resource use grows as the input gets bigger.",
        link: 'https://en.wikipedia.org/wiki/Big_O_notation',
        aliases: ['complexity', 'asymptotic'],
      },
      {
        term: 'Hash table',
        definition:
          'A data structure with average O(1) lookup, insert, and delete via a hash function on keys.',
        link: 'https://en.wikipedia.org/wiki/Hash_table',
      },
      {
        term: 'Binary tree',
        definition:
          'A tree data structure where each node has at most two children. Foundation for many search structures.',
        link: 'https://en.wikipedia.org/wiki/Binary_tree',
      },
      {
        term: 'Graph',
        definition:
          'A set of nodes (vertices) and edges. Models networks, dependencies, relationships.',
        link: 'https://en.wikipedia.org/wiki/Graph_(discrete_mathematics)',
      },
      {
        term: 'Recursion',
        definition: 'A function calling itself, with a base case that stops the recursion.',
        link: 'https://en.wikipedia.org/wiki/Recursion_(computer_science)',
      },
      {
        term: 'Dynamic programming',
        definition:
          'An algorithm technique that solves problems by combining solutions to overlapping subproblems.',
        link: 'https://en.wikipedia.org/wiki/Dynamic_programming',
      },
      {
        term: 'Greedy algorithm',
        definition:
          'An algorithm that makes the locally-optimal choice at each step, hoping for a global optimum.',
        link: 'https://en.wikipedia.org/wiki/Greedy_algorithm',
      },
      {
        term: 'Divide and conquer',
        definition:
          'Solving a problem by recursively breaking it into smaller subproblems of the same type.',
        link: 'https://en.wikipedia.org/wiki/Divide-and-conquer_algorithm',
      },
      {
        term: 'OOP (Object-Oriented Programming)',
        definition:
          'A paradigm where state and behavior are bundled into objects with class-defined methods.',
        link: 'https://en.wikipedia.org/wiki/Object-oriented_programming',
      },
      {
        term: 'Functional programming',
        definition:
          'A paradigm where functions are first-class, state is immutable, and side effects are isolated.',
        link: 'https://en.wikipedia.org/wiki/Functional_programming',
      },
      {
        term: 'Pure function',
        definition:
          'A function whose output depends only on its arguments and that has no side effects.',
        link: 'https://en.wikipedia.org/wiki/Pure_function',
      },
      {
        term: 'Closure',
        definition:
          'A function bundled with its enclosing scope, so the function can reference variables from outside.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures',
      },
      {
        term: 'Mutability vs immutability',
        definition:
          'Whether a value can be changed after creation. Immutable values are safer to share across code.',
        link: 'https://en.wikipedia.org/wiki/Immutable_object',
      },
      {
        term: 'Abstraction',
        definition:
          'Hiding implementation details behind an interface. The thing that lets us reason about big systems.',
        link: 'https://en.wikipedia.org/wiki/Abstraction_(computer_science)',
      },
      {
        term: 'Encapsulation',
        definition:
          'Bundling state and the operations that act on it, hiding state from outside access.',
        link: 'https://en.wikipedia.org/wiki/Encapsulation_(computer_programming)',
      },
      {
        term: 'Polymorphism',
        definition: 'One name (function, operator, interface) usable across different types.',
        link: 'https://en.wikipedia.org/wiki/Polymorphism_(computer_science)',
      },
      {
        term: 'Type system',
        definition:
          'The rules a language uses to classify values and check that operations are valid for them.',
        link: 'https://en.wikipedia.org/wiki/Type_system',
      },
      {
        term: 'Garbage collection',
        definition: 'Automatic memory management. The runtime reclaims memory no longer reachable.',
        link: 'https://en.wikipedia.org/wiki/Garbage_collection_(computer_science)',
      },
    ],
  },

  // ============================================================================
  // Software architecture
  // ============================================================================
  {
    id: 'architecture',
    title: 'Software architecture',
    intro:
      'Patterns that show up once a system has more than one moving part. The Resources page links to free reading per term.',
    entries: [
      {
        term: 'Monolith',
        definition:
          'A single deployable unit that contains all the application code. Often a sensible starting point.',
        link: 'https://en.wikipedia.org/wiki/Monolithic_application',
      },
      {
        term: 'Microservice',
        definition:
          'A service responsible for one bounded capability, deployed independently. Comes with operational cost.',
        link: 'https://martinfowler.com/articles/microservices.html',
      },
      {
        term: 'Service-Oriented Architecture (SOA)',
        definition:
          'The broader pattern of decomposing a system into services that communicate over a network.',
        link: 'https://en.wikipedia.org/wiki/Service-oriented_architecture',
      },
      {
        term: 'Event-driven architecture',
        definition:
          'Components communicate by producing and consuming events on a queue or stream.',
        link: 'https://en.wikipedia.org/wiki/Event-driven_architecture',
      },
      {
        term: 'CQRS (Command Query Responsibility Segregation)',
        definition:
          'Separating write paths (commands) from read paths (queries), often with different data models.',
        link: 'https://martinfowler.com/bliki/CQRS.html',
      },
      {
        term: 'Event sourcing',
        definition:
          'Persisting the events that produced state rather than the state itself. Replay rebuilds the state.',
        link: 'https://martinfowler.com/eaaDev/EventSourcing.html',
      },
      {
        term: 'Idempotency',
        definition:
          'A property where applying the same operation multiple times has the same effect as applying it once.',
        link: 'https://en.wikipedia.org/wiki/Idempotence',
      },
      {
        term: 'CAP theorem',
        definition:
          'A distributed system can guarantee at most two of: consistency, availability, partition tolerance.',
        link: 'https://en.wikipedia.org/wiki/CAP_theorem',
      },
      {
        term: 'Eventual consistency',
        definition:
          'A consistency model where replicas converge over time, after a write quiet period.',
        link: 'https://en.wikipedia.org/wiki/Eventual_consistency',
      },
      {
        term: 'ACID',
        definition:
          'Atomicity, Consistency, Isolation, Durability. The transactional guarantees of traditional RDBMS.',
        link: 'https://en.wikipedia.org/wiki/ACID',
      },
      {
        term: 'BASE',
        definition:
          'Basically Available, Soft state, Eventually consistent. The trade-off many NoSQL systems make.',
        link: 'https://en.wikipedia.org/wiki/Eventual_consistency#Comparison_with_other_consistency_models',
      },
      {
        term: 'MVC',
        definition:
          'Model-View-Controller. A pattern that separates data, presentation, and input handling.',
        link: 'https://en.wikipedia.org/wiki/Model%E2%80%93view%E2%80%93controller',
      },
      {
        term: 'Hexagonal architecture',
        definition:
          'A pattern that separates business logic from inputs/outputs via ports and adapters.',
        link: 'https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)',
        aliases: ['ports and adapters'],
      },
      {
        term: 'Clean architecture',
        definition:
          'Layered architecture with dependencies pointing toward business rules, not away from them.',
        link: 'https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html',
      },
      {
        term: 'Dependency injection',
        definition:
          "Providing a component's dependencies from outside rather than letting it instantiate them.",
        link: 'https://en.wikipedia.org/wiki/Dependency_injection',
      },
      {
        term: 'Domain-Driven Design (DDD)',
        definition: 'Designing software around the language and structure of the problem domain.',
        link: 'https://en.wikipedia.org/wiki/Domain-driven_design',
      },
      {
        term: 'API gateway',
        definition:
          'A single entry point that routes requests to backend services. Adds auth, rate limits, observability.',
        link: 'https://en.wikipedia.org/wiki/API_gateway',
      },
      {
        term: 'Sidecar pattern',
        definition:
          'Deploying a helper process alongside an application to handle cross-cutting concerns.',
        link: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/sidecar',
      },
    ],
  },

  // ============================================================================
  // Distributed systems
  // ============================================================================
  {
    id: 'distributed',
    title: 'Distributed systems',
    intro: 'The vocabulary of systems where more than one process / machine is involved.',
    entries: [
      {
        term: 'Replication',
        definition:
          'Keeping multiple copies of data on different nodes for availability and read scale.',
        link: 'https://en.wikipedia.org/wiki/Replication_(computing)',
      },
      {
        term: 'Sharding',
        definition: 'Partitioning data across nodes so each node owns a subset.',
        link: 'https://en.wikipedia.org/wiki/Shard_(database_architecture)',
      },
      {
        term: 'Leader election',
        definition: 'A consensus protocol where nodes agree on which one is currently the primary.',
        link: 'https://en.wikipedia.org/wiki/Leader_election',
      },
      {
        term: 'Consensus',
        definition:
          'A distributed agreement on a single value across multiple nodes, despite failures.',
        link: 'https://en.wikipedia.org/wiki/Consensus_(computer_science)',
      },
      {
        term: 'Raft',
        definition:
          'A consensus algorithm designed to be more understandable than Paxos. Used by etcd, Consul.',
        link: 'https://raft.github.io/',
      },
      {
        term: 'Paxos',
        definition:
          'The classic distributed-consensus algorithm. Conceptually elegant, notoriously hard to implement.',
        link: 'https://en.wikipedia.org/wiki/Paxos_(computer_science)',
      },
      {
        term: 'Two-phase commit (2PC)',
        definition:
          'A protocol for distributed transactions. Coordinator asks all participants to prepare, then commit.',
        link: 'https://en.wikipedia.org/wiki/Two-phase_commit_protocol',
      },
      {
        term: 'Exactly-once delivery',
        definition:
          'Each message is delivered exactly once. In practice, you get at-least-once + idempotency instead.',
        link: 'https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/',
      },
      {
        term: 'At-least-once delivery',
        definition: 'Each message is delivered one or more times. Pair with idempotent consumers.',
        link: 'https://en.wikipedia.org/wiki/Message_delivery',
      },
      {
        term: 'Circuit breaker',
        definition:
          'A pattern that stops calling a failing dependency for a cooldown period after consecutive failures.',
        link: 'https://martinfowler.com/bliki/CircuitBreaker.html',
      },
      {
        term: 'Exponential backoff',
        definition:
          'A retry strategy where the wait between attempts grows exponentially, often with jitter.',
        link: 'https://en.wikipedia.org/wiki/Exponential_backoff',
      },
      {
        term: 'Backpressure',
        definition:
          'A signal from a slow consumer to a fast producer to slow down, preventing queue buildup.',
        link: 'https://en.wikipedia.org/wiki/Back_pressure',
      },
    ],
  },

  // ============================================================================
  // Observability
  // ============================================================================
  {
    id: 'observability',
    title: 'Observability and operations',
    intro: 'What you need after the code ships. The discipline of running production.',
    entries: [
      {
        term: 'Logging',
        definition:
          "Emitting structured records of events for later inspection. PreFlight's Security Logging probe scans for this.",
        link: 'https://opentelemetry.io/docs/concepts/signals/logs/',
        internal: '/learn/patterns/security-logging',
      },
      {
        term: 'Metrics',
        definition: 'Numerical measurements over time. Counters, gauges, histograms.',
        link: 'https://opentelemetry.io/docs/concepts/signals/metrics/',
      },
      {
        term: 'Tracing',
        definition:
          'Following a single request through every service it touches. Built on spans and trace IDs.',
        link: 'https://opentelemetry.io/docs/concepts/signals/traces/',
      },
      {
        term: 'OpenTelemetry',
        definition: 'The cross-vendor standard for observability data (traces, metrics, logs).',
        link: 'https://opentelemetry.io/',
      },
      {
        term: 'SLI (Service Level Indicator)',
        definition: 'A measurable signal about service health (latency, error rate, availability).',
        link: 'https://sre.google/sre-book/service-level-objectives/',
      },
      {
        term: 'SLO (Service Level Objective)',
        definition:
          'A target value for an SLI over a time window. "99.9% of requests under 200ms over 30 days."',
        link: 'https://sre.google/sre-book/service-level-objectives/',
      },
      {
        term: 'SLA (Service Level Agreement)',
        definition:
          'A contractual commitment about an SLO, with consequences (refunds, credits) for missing it.',
        link: 'https://sre.google/sre-book/service-level-objectives/',
      },
      {
        term: 'Error budget',
        definition: 'The amount of allowed unreliability remaining before you hit the SLO ceiling.',
        link: 'https://sre.google/workbook/error-budget-policy/',
      },
      {
        term: 'RED method',
        definition:
          'Service health summarized by Rate, Errors, and Duration. Three metrics per endpoint.',
        link: 'https://www.weave.works/blog/the-red-method-key-metrics-for-microservices-architecture/',
      },
      {
        term: 'USE method',
        definition: 'Resource health summarized by Utilization, Saturation, Errors.',
        link: 'https://www.brendangregg.com/usemethod.html',
      },
    ],
  },

  // ============================================================================
  // Networking + HTTP
  // ============================================================================
  {
    id: 'networking',
    title: 'Networking and HTTP',
    intro: 'The protocols underneath every API call.',
    entries: [
      {
        term: 'HTTP',
        definition:
          'The application-layer protocol for the web. Request/response. Stateless by default.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/HTTP',
      },
      {
        term: 'HTTPS',
        definition:
          'HTTP over TLS. Encrypted in transit, server identity verified via certificate.',
        link: 'https://developer.mozilla.org/en-US/docs/Glossary/HTTPS',
      },
      {
        term: 'TLS',
        definition:
          'Transport Layer Security. The successor to SSL. Provides encryption, integrity, identity.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security',
      },
      {
        term: 'TCP',
        definition: 'Transport Control Protocol. Connection-oriented, ordered, reliable delivery.',
        link: 'https://en.wikipedia.org/wiki/Transmission_Control_Protocol',
      },
      {
        term: 'UDP',
        definition:
          'User Datagram Protocol. Connectionless, unordered, no delivery guarantees. Lower overhead.',
        link: 'https://en.wikipedia.org/wiki/User_Datagram_Protocol',
      },
      {
        term: 'DNS',
        definition: 'Domain Name System. Translates human-readable names to IP addresses.',
        link: 'https://developer.mozilla.org/en-US/docs/Glossary/DNS',
      },
      {
        term: 'CDN (Content Delivery Network)',
        definition:
          'A network of edge servers that cache content close to users for lower latency.',
        link: 'https://en.wikipedia.org/wiki/Content_delivery_network',
      },
      {
        term: 'Reverse proxy',
        definition:
          'A server that sits in front of one or more origins, terminating TLS, routing, caching.',
        link: 'https://en.wikipedia.org/wiki/Reverse_proxy',
      },
      {
        term: 'WebSocket',
        definition:
          'A persistent bidirectional connection over HTTP-upgraded TCP. Real-time without polling.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API',
      },
      {
        term: 'Server-Sent Events (SSE)',
        definition:
          'A unidirectional streaming protocol. Server pushes events to the client over HTTP.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events',
      },
      {
        term: 'gRPC',
        definition:
          'A high-performance RPC framework over HTTP/2 with Protocol Buffers as the wire format.',
        link: 'https://grpc.io/',
      },
      {
        term: 'REST',
        definition:
          'An architectural style for web APIs based on resources, HTTP verbs, and statelessness.',
        link: 'https://en.wikipedia.org/wiki/Representational_state_transfer',
      },
      {
        term: 'GraphQL',
        definition:
          'A query language for APIs. Clients describe the shape of the response they want.',
        link: 'https://graphql.org/',
      },
    ],
  },

  // ============================================================================
  // Web platform
  // ============================================================================
  {
    id: 'web-platform',
    title: 'Web platform',
    intro: "The browser primitives PreFlight's probes scan against.",
    entries: [
      {
        term: 'DOM (Document Object Model)',
        definition: "The browser's in-memory tree representation of the HTML document.",
        link: 'https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model',
      },
      {
        term: 'Event loop',
        definition:
          "The browser's mechanism for running JavaScript, processing tasks, and rendering. Single-threaded.",
        link: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop',
      },
      {
        term: 'Service worker',
        definition:
          'A browser-managed background script that intercepts network requests. Enables offline and push.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API',
      },
      {
        term: 'Web component',
        definition:
          'A framework-agnostic standard for custom HTML elements with encapsulated DOM and styles.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_components',
      },
      {
        term: 'Shadow DOM',
        definition:
          'A scoped subtree attached to an element, isolated from the main document tree.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM',
      },
      {
        term: 'WebAssembly (Wasm)',
        definition:
          'A portable binary instruction format for running near-native-speed code in browsers and elsewhere.',
        link: 'https://webassembly.org/',
      },
      {
        term: 'Fetch API',
        definition: 'The browser API for making HTTP requests. Returns a promise.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
      },
    ],
  },

  // ============================================================================
  // Build + tooling
  // ============================================================================
  {
    id: 'tooling',
    title: 'Build and tooling',
    intro: 'The stack underneath modern JS / TS projects, including PreFlight itself.',
    entries: [
      {
        term: 'ESLint',
        definition:
          'A linter for JavaScript and TypeScript. Catches bugs and enforces style at write time.',
        link: 'https://eslint.org/',
      },
      {
        term: 'Prettier',
        definition:
          'An opinionated code formatter. Settles formatting arguments before they happen.',
        link: 'https://prettier.io/',
      },
      {
        term: 'Vite',
        definition:
          'A modern frontend build tool. Native ES modules in dev, Rollup-bundled in prod.',
        link: 'https://vitejs.dev/',
      },
      {
        term: 'Webpack',
        definition:
          'The long-standing module bundler. Powerful, configurable, often slow without tuning.',
        link: 'https://webpack.js.org/',
      },
      {
        term: 'TypeScript',
        definition:
          'A superset of JavaScript that adds a structural type system, compiled to plain JS.',
        link: 'https://www.typescriptlang.org/',
      },
      {
        term: 'Tree shaking',
        definition: 'A bundler optimization that removes unused exports from the final output.',
        link: 'https://developer.mozilla.org/en-US/docs/Glossary/Tree_shaking',
      },
      {
        term: 'Code splitting',
        definition:
          'Breaking the bundle into multiple chunks loaded on demand, reducing initial download.',
        link: 'https://developer.mozilla.org/en-US/docs/Glossary/Code_splitting',
      },
      {
        term: 'Source map',
        definition:
          'A file that maps minified bundle positions back to original source for debugging.',
        link: 'https://developer.mozilla.org/en-US/docs/Tools/Debugger/How_to/Use_a_source_map',
        internal: '/learn/patterns/source-map-exposure',
      },
      {
        term: 'AST (Abstract Syntax Tree)',
        definition:
          "A tree representation of source code's structure. Linters, formatters, and bundlers all build one.",
        link: 'https://en.wikipedia.org/wiki/Abstract_syntax_tree',
        internal: '/learn/patterns/code-correctness',
      },
    ],
  },

  // ============================================================================
  // Accessibility
  // ============================================================================
  {
    id: 'a11y',
    title: 'Accessibility (A11y)',
    intro:
      'How to make sure the 15-20% of users who need accessibility considerations can actually use the site.',
    entries: [
      {
        term: 'WCAG',
        definition:
          'Web Content Accessibility Guidelines. The authoritative accessibility standard.',
        link: 'https://www.w3.org/TR/WCAG22/',
        internal: '/learn/patterns/a11y-landmarks',
      },
      {
        term: 'ARIA',
        definition:
          'Accessible Rich Internet Applications. Attributes that expose UI semantics to assistive tech.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA',
      },
      {
        term: 'Screen reader',
        definition: 'Assistive technology that converts on-screen content into speech or braille.',
        link: 'https://www.afb.org/blindness-and-low-vision/using-technology/assistive-technology-products/screen-readers',
      },
      {
        term: 'Landmark element',
        definition:
          'A semantic HTML element (header, nav, main, footer, aside) screen readers use for navigation.',
        link: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles#landmark_roles',
      },
      {
        term: 'Focus management',
        definition:
          "Controlling which element receives keyboard input. Critical for users who can't use a mouse.",
        link: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/Keyboard-navigable_JavaScript_widgets',
      },
      {
        term: 'Skip link',
        definition:
          'A hidden-until-focused link that lets keyboard users skip past nav directly to main content.',
        link: 'https://webaim.org/techniques/skipnav/',
      },
      {
        term: 'Target size (WCAG 2.5.8)',
        definition: 'The minimum size of interactive targets. 24×24 CSS px minimum, 44×44 AAA.',
        link: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
      },
      {
        term: 'Color contrast',
        definition:
          'The luminance ratio between text and background. 4.5:1 minimum for normal text.',
        link: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
      },
    ],
  },

  // ============================================================================
  // PreFlight-specific
  // ============================================================================
  {
    id: 'pre-flight',
    title: 'PreFlight vocabulary',
    intro:
      'Terms that exist inside PreFlight: probes, personas, the manifesto, the safety contracts.',
    entries: [
      {
        term: 'Probe',
        definition:
          'A pure function that scans file content and returns findings. PreFlight has 43 of them.',
        link: '/learn',
        internal: '/learn/patterns/code-correctness',
      },
      {
        term: 'Finding',
        definition:
          'One detected issue: probe name, severity, category, CWE, file:line, evidence, remediation, OWASP code.',
        link: '/learn',
      },
      {
        term: 'Stable ID',
        definition:
          'An FNV-1a hash of probe + file + title + ±3-line context. Survives line shifts and reformats.',
        link: '/learn',
      },
      {
        term: 'Suppression',
        definition:
          'Marking a finding as false-positive, wont-fix, or accepted-risk. Keyed on stable ID.',
        link: '/learn',
      },
      {
        term: 'BYOK (Bring Your Own Key)',
        definition:
          "PreFlight's pattern for AI features: you supply the API key, requests go directly to your provider.",
        link: '/learn',
      },
      {
        term: 'BYOT (Bring Your Own Token)',
        definition: 'The same pattern for private GitHub repo scanning: you supply a PAT.',
        link: '/learn',
      },
      {
        term: 'Vibeware',
        definition:
          "Software built primarily through natural-language prompts to an AI tool. PreFlight's audience.",
        link: '/learn/manifesto',
        internal: '/learn',
      },
      {
        term: 'Vibe-Aware',
        definition:
          'The stance PreFlight takes: capable practitioners, mechanics-instructor register, no preaching.',
        link: '/learn',
        internal: '/learn',
      },
      {
        term: 'Sam',
        definition:
          'The Persona+ spec for security fix generation. Dual-mode: SAM_COMMAND_FULL + SAM_COMMAND_SNIPPET.',
        link: '/learn',
      },
      {
        term: 'Demi',
        definition:
          'The Persona+ spec for educational content authoring + grading. Dual-mode: AUTHOR + GRADE.',
        link: '/learn',
      },
      {
        term: 'Drew',
        definition: 'The Persona+ spec for design-rules enforcement (planned v1.1).',
        link: '/learn',
      },
      {
        term: 'Vera',
        definition: 'The Persona+ spec for engineering-rules enforcement (planned v1.1).',
        link: '/learn',
      },
      {
        term: 'Breakers',
        definition:
          'Per-finding adversarial inputs that demonstrate the attack. Static-only, no execution. v1 on feature/breakers-v1.',
        link: '/learn',
      },
      {
        term: 'Dogfood-as-CI-gate',
        definition:
          "PreFlight's founding principle: the tool has to pass its own audit on every build, or the build fails.",
        link: '/learn/manifesto',
      },
    ],
  },
];

// Helper: flatten to a single array for search.
export const ALL_GLOSSARY_ENTRIES = GLOSSARY_GROUPS.flatMap((g) =>
  g.entries.map((e) => ({ ...e, group: g.id, groupTitle: g.title }))
);

export function getGlossaryCount() {
  return ALL_GLOSSARY_ENTRIES.length;
}

export function getGlossaryGroupCount() {
  return GLOSSARY_GROUPS.length;
}

// Helper: substring search over term, definition, and aliases.
export function searchGlossary(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return ALL_GLOSSARY_ENTRIES;
  return ALL_GLOSSARY_ENTRIES.filter((e) => {
    if (e.term.toLowerCase().includes(q)) return true;
    if (e.definition.toLowerCase().includes(q)) return true;
    if (e.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
    return false;
  });
}
