// lib/ambient.js — time-of-day presence rules. NO DOM.
//
// These were `new Date()` calls buried inside DOM writers, which made them
// untestable without freezing the system clock. Taking the hour as a PARAMETER
// is the whole trick: the caller reads the clock, these decide.

/** Night water: 22:00 → 06:30. `h` is a float hour (13.5 === 13:30). */
export function isNight(h) {
  return h >= 22 || h < 6.5;
}

/** Atlan's opening line for a given whole hour (0–23). */
export function greetingFor(h) {
  if (h < 5) return 'Deep-night dive? I’m with you, boss.';
  if (h < 12) return 'Morning, boss. The water’s clear today.';
  if (h < 18) return 'Afternoon current’s steady. What are we building?';
  if (h < 22) return 'Evening, boss. Good depth for building.';
  return 'Late water. I’ll keep the lights on.';
}

/** Mood → halo RGB triplet. Unknown moods fall back to calm rather than throw. */
export const MOOD_HUE = {
  calm: '63,232,200',
  building: '107,212,216',
  alarmed: '255,103,35',
  proud: '137,235,239',
};

export function hueFor(mood) {
  return MOOD_HUE[mood] ?? MOOD_HUE.calm;
}
