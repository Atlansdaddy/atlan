// src/lib/seo.js
//
// Per-route metadata resolver. Single source of truth for the <head> the
// prerender script bakes into each route's static HTML so crawlers get a
// correct title / description / canonical / Open Graph per URL instead of
// the homepage's for all 85 pages.
//
// Pure and SSR-safe: the only data dependency is the eager Learn registry
// (learn-content.js, import.meta.glob eager), so this resolves synchronously
// under Vite's ssrLoadModule. No browser globals.

import { getBySlug } from './learn-content.js';

const BASE = 'https://preflight.midatlantic.ai';

// Brand-voice rule (CLAUDE.md): no em-dash. Sub-pages use " | PreFlight".
// The homepage keeps its existing canonical title verbatim.
const HOME_TITLE = 'PreFlight — Educational Audit for Vibers Building Vibeware';
const HOME_DESC =
  'Free in-browser static security audit for apps built with AI coding tools. ' +
  'Runs in your browser, your code never leaves your machine. No signup.';

// Static content routes. Description stays under ~160 chars, no marketing
// lexicon, no fear marketing (voice rules).
const STATIC = {
  '/': { title: HOME_TITLE, description: HOME_DESC },
  '/learn': {
    title: 'Learn | PreFlight',
    description:
      'A library for vibers building vibeware: the security patterns PreFlight checks, the incidents behind them, and the architecture shapes that shape your posture.',
  },
  '/learn/patterns': {
    title: 'Security Patterns | PreFlight',
    description:
      'Every security pattern PreFlight detects, explained in plain language with the attack input and the specific fix.',
  },
  '/learn/incidents': {
    title: 'Field Reports | PreFlight',
    description:
      'Real supply-chain and AI-tooling incidents from 2025 to 2026, written up so you can see how the attack actually ran.',
  },
  '/learn/shapes': {
    title: 'Architecture Shapes | PreFlight',
    description:
      'The architecture shapes PreFlight recognizes and what each one means for your security posture.',
  },
  '/learn/resources': {
    title: 'Resources | PreFlight',
    description:
      'Primary sources PreFlight cites: OWASP, MITRE CWE, CISA, W3C, and vendor security documentation.',
  },
  '/learn/owasp': {
    title: 'OWASP Coverage | PreFlight',
    description:
      'Which OWASP Top 10 2025 and OWASP LLM Top 10 categories PreFlight covers, mapped probe by probe.',
  },
  '/learn/how-it-works': {
    title: 'How It Works | PreFlight',
    description:
      'How PreFlight scans in your browser tab: pure-function probes over text, findings built locally, nothing uploaded.',
  },
  '/learn/the-climb': {
    title: 'The Climb | PreFlight',
    description:
      'A roadmap from the floor of vibe coding to the ceiling of agentic engineering. Six tiers of judgment, what each can ship, and how to climb.',
  },
  '/learn/flight-school': {
    title: 'FlightSchool | PreFlight',
    description:
      'A curated role-by-tier index of the best free resources for shipping software safely. Six roles, mapped to The Climb, with a safety note at every step.',
  },
  '/learn/tools': {
    title: 'Tools | PreFlight',
    description:
      'A neutral catalog of the AI coding and build tools, strengths and weaknesses both, sourced and dated. No affiliate, no sponsored placement.',
  },
  '/learn/glossary': {
    title: 'Security Glossary | PreFlight',
    description:
      'Plain-language definitions for the security terms PreFlight uses, each linked to a primary source.',
  },
  '/learn/breakers': {
    title: 'Breakers | PreFlight',
    description:
      'For each finding class, the concrete adversarial input an attacker would type, so you can reproduce the failure and confirm the fix.',
  },
  '/learn/social': {
    title: 'Social | PreFlight',
    description:
      'Social learning for vibe coders, shippers, and builders. The communities where people get better together, including Vibe Coding is Life.',
  },
  '/privacy': {
    title: 'Privacy | PreFlight',
    description:
      'Privacy by architecture, not by promise. PreFlight runs in your browser tab and collects nothing. There is no backend.',
  },
  '/terms': {
    title: 'Terms | PreFlight',
    description:
      'Terms of use for PreFlight, the free in-browser static security audit by Mid-Atlantic AI.',
  },
};

// /learn/<type>/<slug> -> the type segment maps to the Learn entry kind.
const SLUG_ROUTE = /^\/learn\/(patterns|incidents|shapes)\/([a-z0-9-]+)\/?$/;

/**
 * @param {string} pathname e.g. "/learn/patterns/secret-scanner"
 * @returns {{title:string, description:string, canonical:string,
 *           ogTitle:string, ogDescription:string}}
 */
export function getRouteMeta(pathname) {
  const path = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const canonical = `${BASE}${path === '/' ? '/' : path}`;

  let title;
  let description;

  const m = path.match(SLUG_ROUTE);
  if (m) {
    const entry = getBySlug(m[2]);
    if (entry) {
      title = `${entry.title} | PreFlight`;
      // Many Learn pages have no `summary` frontmatter (or a short derived
      // one). A bare or missing description is an SEO defect and makes every
      // such page share the homepage blurb. Fall back to a page-unique,
      // substantive sentence built from the title so each URL gets its own
      // meaningful description above the probe's minimum.
      const summary = (entry.summary || '').trim();
      description =
        summary.length >= 50 ? summary.slice(0, 200) : `${entry.title}. ${HOME_DESC}`.slice(0, 200);
    }
  }

  if (!title) {
    const s = STATIC[path];
    title = s ? s.title : HOME_TITLE;
    description = s ? s.description : HOME_DESC;
  }

  return {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
  };
}
