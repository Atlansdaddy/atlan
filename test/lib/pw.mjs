// Portable Playwright resolution for the browser-driving specs.
//
// Every spec used to do:
//     import pw from '/usr/lib/node_modules/playwright/index.js';
// which is one machine's global npm prefix baked into shared code — the same
// class of bug as a hardcoded hostname or `HOME ?? '/root'`. It works on the box
// it was written on and nowhere else, so the suite could never run in CI, on a
// contributor's checkout, or on the phone.
//
// Resolution order: the project's own node_modules first (what `npm ci` installs
// and what CI will have), then the common global prefixes as a fallback so the
// existing dev box keeps working without reinstalling anything.
//
// If none resolve we throw with the install command rather than a module-not-
// found stack, because "cannot find /usr/lib/node_modules/..." tells a new
// contributor nothing about what to do next.

const CANDIDATES = [
  'playwright', // node_modules — normal resolution, walks up from here
  '/usr/lib/node_modules/playwright/index.js',
  '/usr/local/lib/node_modules/playwright/index.js',
];

let mod = null;
const tried = [];
for (const c of CANDIDATES) {
  try {
    mod = await import(c);
    break;
  } catch {
    tried.push(c);
  }
}

if (!mod) {
  throw new Error(
    'Playwright is not installed.\n'
    + `  tried: ${tried.join(', ')}\n`
    + '  fix:   npm ci && npx playwright install --with-deps chromium',
  );
}

// playwright is CJS, so a namespace import puts module.exports on .default.
export default mod.default ?? mod;
