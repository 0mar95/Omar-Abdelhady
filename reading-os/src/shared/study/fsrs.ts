// FSRS (Free Spaced Repetition Scheduler, version 5): the scheduler modern
// Anki uses. Each card has a stability (days until recall falls to 90%) and a
// difficulty (1–10); every answer updates both, and the next review is set for
// when you'd be about to forget. Default parameters, trained on millions of
// reviews; desired retention 90%.

export type Grade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export interface Card {
  /** Next review (ms). */
  due: number;
  /** Days until recall probability falls to 90%. */
  s: number;
  /** 1 (easy) … 10 (hard). */
  d: number;
  reps: number;
  lapses: number;
  /** Last review (ms). */
  last: number;
  grade: Grade;
}

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const DAY = 86_400_000;
const MAX_DAYS = 365;
/** A missed card comes back in the same sitting. */
const RELEARN_MS = 10 * 60_000;
/** Hard while relearning: a little later than Again (Anki's relearning steps). */
const HARD_RELEARN_MS = 15 * 60_000;

const clampD = (d: number) => Math.min(10, Math.max(1, d));
const initD = (g: Grade) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);

/** Probability of recalling a card `days` after its last review. */
export function retrievability(days: number, s: number): number {
  return Math.pow(1 + (FACTOR * days) / s, DECAY);
}

/** Days until recall falls to the desired retention. */
function intervalDays(s: number): number {
  const days = (s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return Math.min(MAX_DAYS, Math.max(1, Math.round(days)));
}

/** The card after answering with `grade` at time `now`. */
export function review(card: Card | undefined, grade: Grade, now = Date.now()): Card {
  return outcomes(card, now)[grade];
}

/**
 * What each grade would do. The four always differ, as in Anki: Again soonest;
 * Hard never later than Good (and, while a missed card is being relearned,
 * back in 15 minutes); Good at least a day; Easy at least a day after Good.
 */
export function outcomes(card: Card | undefined, now = Date.now()): Record<Grade, Card> {
  const raw = {} as Record<Grade, { s: number; d: number }>;
  for (const g of [1, 2, 3, 4] as Grade[]) raw[g] = memory(card, g, now);
  const days = (g: Grade) => intervalDays(raw[g].s);
  const good = Math.max(1, days(3));
  const relearning = !!card && card.reps > 0 && card.grade === 1 && (now - card.last) / DAY < 1;
  const hardMs = relearning ? HARD_RELEARN_MS : Math.min(days(2), good) * DAY;
  const easy = Math.max(days(4), good + 1);
  const at: Record<Grade, number> = { 1: RELEARN_MS, 2: hardMs, 3: good * DAY, 4: easy * DAY };
  // A brand-new card answered Hard has been seen once: give it its first day like Anki's learning step.
  if (!card || card.reps === 0) at[2] = Math.max(1, days(2)) * DAY;
  const out = {} as Record<Grade, Card>;
  for (const g of [1, 2, 3, 4] as Grade[])
    out[g] = { due: now + at[g], s: raw[g].s, d: raw[g].d, reps: (card?.reps ?? 0) + 1, lapses: (card?.lapses ?? 0) + (g === 1 ? 1 : 0), last: now, grade: g };
  return out;
}

/** The memory model: stability and difficulty after a grade. */
function memory(card: Card | undefined, grade: Grade, now: number): { s: number; d: number } {
  if (!card || card.reps === 0) return { s: W[grade - 1], d: initD(grade) };
  const days = Math.max(0, (now - card.last) / DAY);
  const r = retrievability(days, card.s);
  // Difficulty: harder answers raise it, easier lower it, drifting back toward the default.
  const dNext = card.d - W[6] * (grade - 3);
  const d = clampD(W[7] * initD(4) + (1 - W[7]) * (card.d + (dNext - card.d) * ((10 - card.d) / 9)));
  let s: number;
  if (days < 1) {
    // Seen again the same day: a short-term adjustment.
    s = card.s * Math.exp(W[17] * (grade - 3 + W[18]));
  } else if (grade === 1) {
    s = Math.min(card.s, W[11] * Math.pow(d, -W[12]) * (Math.pow(card.s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
  } else {
    const hard = grade === 2 ? W[15] : 1;
    const easy = grade === 4 ? W[16] : 1;
    s = card.s * (Math.exp(W[8]) * (11 - d) * Math.pow(card.s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
  }
  return { s: Math.max(0.1, s), d };
}

/** "10 min", "1 day", "5 days", "2 mo": when a grade would bring the card back. */
export function nextLabel(card: Card | undefined, grade: Grade, now = Date.now()): string {
  const ms = review(card, grade, now).due - now;
  if (ms < DAY) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  const days = Math.round(ms / DAY);
  if (days < 30) return days === 1 ? "1 day" : `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return "1 yr";
}

/** A card from the old schedule (interval in days, right/wrong counts). */
export function fromLegacy(old: { due: number; interval: number; right: number; wrong: number; last?: "right" | "wrong" }): Card {
  return {
    due: old.due,
    s: Math.max(0.5, old.interval || 0.5),
    d: clampD(5 + old.wrong - old.right * 0.5),
    reps: old.right + old.wrong,
    lapses: old.wrong,
    last: old.due - Math.max(1, old.interval) * DAY,
    grade: old.last === "wrong" ? 1 : 3,
  };
}
