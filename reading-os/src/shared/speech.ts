// Text as it should be heard: what a narrator would say for a printed sentence,
// and long sentences split where a reader would breathe.

const REPLACE: [RegExp, string][] = [
  // Figure and table pointers are for the eye: "(Fig 1-2)", "(see Table 3)", "(Figs 4 and 5)".
  [/\s*\((?:see\s+(?:also\s+)?)?(?:figs?\.?|figures?|tables?|boxes?|plates?|charts?)\s*[\dA-Z][^()]{0,40}\)/gi, ""],
  [/\be\.\s?g\.,?/gi, "for example,"],
  [/\bi\.\s?e\.,?/gi, "that is,"],
  [/\bcf\.\s/gi, "compare "],
  [/\bapprox\.\s/gi, "approximately "],
  [/\bvs\.?(?=\s)/gi, "versus"],
  [/\bFigs\.?(?=\s*\d)/g, "Figures"],
  [/\bFig\.?(?=\s*\d)/g, "Figure"],
  [/\bet al\b\.?/g, "and colleagues"],
  [/(\d)\s?–\s?(\d)/g, "$1 to $2"],
  [/(\d)\s?×\s?(\d)/g, "$1 by $2"],
  [/(\d)\s?%/g, "$1 percent"],
  [/±\s?/g, " plus or minus "],
  [/≥\s?/g, " at least "],
  [/≤\s?/g, " at most "],
  [/°\s?C\b/g, " degrees Celsius"],
  [/°\s?F\b/g, " degrees Fahrenheit"],
  [/°/g, " degrees"],
  [/\s*&\s*/g, " and "],
  [/\s*\/\s*(?=[a-z])/g, " or "],
];

/** The words to speak for a printed sentence. */
export function spoken(text: string): string {
  let t = text;
  for (const [re, by] of REPLACE) t = t.replace(re, by);
  return t.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/**
 * Splits a long sentence at its clauses so the first words are heard sooner.
 * Pieces stay substrings of the sentence (they are highlighted as they're read).
 */
export function clauses(sentence: string, max = 220): string[] {
  if (sentence.length <= max) return [sentence];
  const mid = sentence.length / 2;
  let best = -1;
  for (const m of sentence.matchAll(/[;:,—]\s+/g)) {
    const at = m.index! + m[0].length;
    if (at < 60 || sentence.length - at < 60) continue;
    if (best < 0 || Math.abs(at - mid) < Math.abs(best - mid)) best = at;
  }
  if (best < 0) return [sentence];
  return [...clauses(sentence.slice(0, best).trim(), max), ...clauses(sentence.slice(best).trim(), max)];
}

/** Novelty and effect voices that no one should read a textbook with. */
const NOVELTY =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley|deranged|hysterical|pipe organ)\b/i;
const GOOD = /\b(ava|zoe|evan|nathan|noelle|samantha|allison|susan|tom|serena|daniel|kate|oliver|jamie|karen|moira|tessa|fiona|aaron|nicky|joelle|google (us|uk) english)\b/i;

/** How good a system voice is likely to sound; below zero means hide it. */
export function voiceScore(v: { name: string; lang: string; localService?: boolean }): number {
  if (NOVELTY.test(v.name)) return -1;
  let s = 0;
  if (/premium/i.test(v.name)) s += 6;
  else if (/enhanced|neural|natural/i.test(v.name)) s += 4;
  if (GOOD.test(v.name)) s += 2;
  if (/^en[-_](US|GB)/i.test(v.lang)) s += 1;
  return s;
}
