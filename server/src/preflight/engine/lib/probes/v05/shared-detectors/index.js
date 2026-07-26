// src/lib/probes/v05/shared-detectors/index.js
//
// Cross-cutting detection helpers imported by adapters that need them.
// Examples: test-fixture path detection, .example file detection,
// allowlist-comment scanning, the secret-pattern bank for XL-006.
//
// Per the composition decision in v05-architecture.md: families own no
// execution logic. Anything that multiple adapters need lives here and gets
// imported explicitly. No automatic inheritance, no base classes.
//
// Phase 0 is empty by design. Helpers land here when the first adapter
// pulls them out of its own module.

export {};
