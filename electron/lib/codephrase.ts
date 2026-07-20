import { randomBytes } from 'node:crypto';

// Small curated wordlist for human-friendly, unambiguous code phrases.
// croc accepts any code >= 6 chars; we generate `NNNN-word-word-word`
// which is easy to read aloud and copy, mirroring croc's own style.
const WORDS = [
  'apple', 'amber', 'anchor', 'arrow', 'atlas', 'aurora',
  'basil', 'beacon', 'birch', 'bison', 'bloom', 'bridge',
  'cactus', 'canyon', 'cedar', 'cobalt', 'comet', 'coral',
  'delta', 'dune', 'dusk', 'ember', 'falcon', 'fern',
  'forest', 'garnet', 'glacier', 'harbor', 'hazel', 'heron',
  'indigo', 'ivory', 'jade', 'jasper', 'kelp', 'lagoon',
  'lark', 'lotus', 'lunar', 'maple', 'marble', 'meadow',
  'nebula', 'nectar', 'oak', 'onyx', 'opal', 'orbit',
  'otter', 'pebble', 'pine', 'plume', 'quartz', 'quill',
  'raven', 'reef', 'ridge', 'river', 'saffron', 'sage',
  'slate', 'solar', 'spruce', 'summit', 'tango', 'thicket',
  'tidal', 'topaz', 'tundra', 'umber', 'valley', 'vault',
  'verde', 'violet', 'walnut', 'willow', 'zenith', 'zephyr',
];

// Unbiased index in [0, maxExclusive) via rejection sampling on one crypto byte.
// NOTE: single-byte source, so maxExclusive MUST be <= 256 — otherwise `limit`
// would round down to 0 and the reject loop would never terminate.
function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  if (maxExclusive > 256) {
    throw new Error(`randomInt supports maxExclusive <= 256 (got ${maxExclusive})`);
  }
  const limit = Math.floor(256 / maxExclusive) * maxExclusive;
  let byte: number;
  do {
    byte = randomBytes(1)[0];
  } while (byte >= limit);
  return byte % maxExclusive;
}

const pickWord = () => WORDS[randomInt(WORDS.length)];

// Four digits, first in 1-9 (no leading zero), built from single-digit draws so
// every call stays within randomInt's single-byte range.
function fourDigits(): string {
  let out = String(randomInt(9) + 1);
  for (let i = 0; i < 3; i += 1) out += String(randomInt(10));
  return out;
}

export function generateCode(): string {
  return `${fourDigits()}-${pickWord()}-${pickWord()}-${pickWord()}`;
}
