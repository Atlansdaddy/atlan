// Mechanical consistency, enforced by CI instead of by remembering.
//
// This is deliberately NOT Prettier. Prettier was measured on this codebase
// first: 106 files, +16,503 lines at printWidth 100, and still +10,714 at 160 —
// because the growth is not line width (median line here is 48 chars, p95 is
// 106). It is that Prettier unconditionally explodes a braced body onto its own
// lines, and this repo has 49 one-line function declarations and 264 one-line
// braced blocks. That is a deliberate density on a product whose primary screen
// is a phone, and it would have pushed web/public/app.js from 1981 lines to over
// 2700, through a ceiling that exists specifically to force new code into lib/
// modules. No Prettier option controls that rule.
//
// ESLint gets the same enforcement without the rewrite, because
// `brace-style: allowSingleLine` keeps the one-liners. Correctness rules come
// along for free, and they are worth more than the formatting: no-unused-vars is
// the check that would have found the dead exports by itself.
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default [
  {
    // Vendored third-party code and generated state. Linting the vendored copies
    // would make every future diff against upstream unreadable, which is the
    // whole reason they are kept byte-for-byte.
    ignores: [
      'node_modules/**',
      'web/public/vendor/**',
      'server/src/preflight/**',
      'server/src/vendor-html2canvas.js',
      '**/*.min.js',
      '.fleet/**',
      'apk/**',
      'web/public/apk/**',
    ],
  },
  js.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      // Style, matched to what this codebase already does rather than to a
      // default. Every one of these was chosen by reading the existing source.
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      '@stylistic/indent': ['error', 2, { SwitchCase: 1, ignoredNodes: ['TemplateLiteral *'] }],
      '@stylistic/comma-dangle': ['error', 'only-multiline'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/arrow-spacing': 'error',
      '@stylistic/comma-spacing': 'error',
      '@stylistic/space-before-blocks': 'error',
      // THE RULE THAT MAKES THIS VIABLE. allowSingleLine keeps
      // `export function isActive(id) { return active.has(id); }` on one line.
      // Without it this becomes Prettier with extra steps.
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],

      // Correctness. An unused variable is usually a rename that missed a spot.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none', // `catch (e) {}` with a deliberately unused binding is a pattern here
      }],
      'no-empty': ['error', { allowEmptyCatch: true }], // deliberately-empty catches carry a comment saying why
    },
  },
  {
    files: ['server/**/*.js', 'test/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['web/public/**/*.js', 'server/preview-shim.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
        // Loaded by <script> from web/public/vendor, so they are globals here
        // rather than imports. Declaring them is what makes no-undef mean
        // something: without this the rule fires 8 times on real, working code
        // and everyone learns to ignore it.
        CodeMirror: 'readonly',
        Terminal: 'readonly',
        FitAddon: 'readonly',
        html2canvas: 'readonly',
      },
    },
  },
  {
    // Playwright specs are Node files containing BROWSER code: everything inside
    // page.evaluate() runs in the page. That single fact accounted for 237 of the
    // 259 no-undef errors on the first run — `document` and `window` reported as
    // undefined in code that never executes in Node. A linter that cries wolf 237
    // times is a linter nobody reads, so both environments are declared here.
    files: ['test/**/*.spec.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
