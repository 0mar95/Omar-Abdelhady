// Some PDFs draw ligatures and a few other characters with private glyphs
// (Unicode private-use codes like U+E01A) and give no table saying what they
// are — and each font numbers them differently. The text reads "e ects" for
// "effects" and "Fig 1 16" for "Fig 1.16". This works out what each private
// glyph stands for, per font, from the words around it: a glyph found in
// "e_ects", "o_er" and "di_erence" is "ff", because the book's own text has
// "effects", "offer" and "difference".

import { isLigatureWord } from "./ligature-words.ts";
import type { RawPage } from "./load.ts";

const PUA = /[-]/;
const PUA_G = /[-]/g;
const WORD = /[\p{L}-]+/gu;

/** Ligatures: when the book never spells a word out, letter patterns decide between these. */
const LIGATURES = ["ff", "fi", "fl", "ffi", "ffl", "ft"];

/**
 * One font is often embedded once per page ("ABCDEF+p22_Font", "p23_Font");
 * its private glyphs mean the same everywhere, so they are pooled.
 */
export function fontFamilyKey(font: string): string {
  return font.replace(/^[A-Z]{6}\+/, "").replace(/^p\d+_/, "");
}

/** Multi-letter glyphs first: they are what private glyphs most often are. */
const LETTER_CANDIDATES = [
  "ff", "fi", "fl", "ffi", "ffl", "ft", "fj", "Th", "th", "st", "ct",
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
];

interface Seen {
  /** Words containing the glyph, with every private glyph left in. */
  words: string[];
  /** The character before it, the one right after, and the next non-space one. */
  around: [string, string, string][];
}

/** Replaces private-use glyphs with the text they stand for, where it can be told. Returns how many kinds were resolved. */
export function repairPrivateGlyphs(pages: RawPage[]): number {
  // Vocabulary of the book's ordinary words.
  const vocab = new Map<string, number>();
  let hasPua = false;
  for (const p of pages)
    for (const r of p.runs) {
      if (PUA.test(r.str)) hasPua = true;
      for (const m of r.str.matchAll(WORD)) {
        const w = m[0];
        if (PUA.test(w) || w.length < 2) continue;
        const k = w.toLowerCase();
        vocab.set(k, (vocab.get(k) ?? 0) + 1);
      }
    }
  if (!hasPua) return 0;

  // Where each (font, glyph) appears.
  const seen = new Map<string, Seen>();
  for (const p of pages)
    for (const r of p.runs) {
      if (!PUA.test(r.str)) continue;
      for (const m of r.str.matchAll(WORD)) {
        if (!PUA.test(m[0])) continue;
        for (const g of new Set(m[0].match(PUA_G))) entry(seen, fontFamilyKey(r.font), g).words.push(m[0]);
      }
      for (const m of r.str.matchAll(PUA_G)) {
        const at = m.index ?? 0;
        entry(seen, fontFamilyKey(r.font), m[0]).around.push([r.str[at - 1] ?? " ", r.str[at + 1] ?? " ", r.str.slice(at + 1).trimStart()[0] ?? " "]);
      }
    }

  let model: Trigrams | null = null;
  const trigrams = () => (model ??= buildTrigrams(vocab));
  const resolved = new Map<string, string>();
  // Letters and ligatures, most frequent glyphs first so later guesses can use earlier answers.
  const order = [...seen.entries()].sort((a, b) => b[1].words.length - a[1].words.length);
  for (let pass = 0; pass < 2; pass++)
    for (const [key, s] of order) {
      if (resolved.has(key)) continue;
      const font = key.slice(0, key.lastIndexOf("\u0000"));
      const glyph = key.slice(-1);
      const words = s.words.map((w) => w.replace(PUA_G, (c) => (c === glyph ? c : resolved.get(`${font}\u0000${c}`) ?? c)));
      const usable = words.filter((w) => !PUA.test(w.replaceAll(glyph, "")));
      if (usable.length) {
        let best = "";
        let bestScore = 0;
        for (const c of LETTER_CANDIDATES) {
          let score = 0;
          for (const w of usable) {
            const x = w.replaceAll(glyph, c).toLowerCase();
            // Ligature words the book never spells out ("film") come from a built-in list.
            if (vocab.has(x) || (LIGATURES.includes(c) && isLigatureWord(x))) score++;
          }
          if (score > bestScore) {
            best = c;
            bestScore = score;
          }
        }
        // Clear evidence: most of its words become real words of this book.
        // (A single word settles it only for a ligature found in the word list.)
        const enough = bestScore >= 2 || (usable.length === 1 && bestScore === 1 && LIGATURES.includes(best));
        if (enough && bestScore >= usable.length * 0.6) {
          resolved.set(key, best);
          continue;
        }
      }
      if (pass === 0) continue;
      const p = punctuation(s.around);
      if (p) {
        resolved.set(key, p);
        continue;
      }
      // Words the book only ever prints with the ligature ("film", "filter"):
      // compare how English-like each ligature makes them. Ligatures sit
      // before letters ("_lm", "su_cient"), never at the end of a word.
      const inside = usable.filter((w) => /\p{L}/u.test(w[w.indexOf(glyph) + 1] ?? ""));
      if (inside.length && inside.length >= usable.length * 0.8) {
        const lig = bestLigature(inside, glyph, trigrams());
        if (lig) resolved.set(key, lig);
      }
    }

  if (!resolved.size) return 0;
  for (const p of pages)
    for (const r of p.runs) {
      if (!PUA.test(r.str)) continue;
      r.str = r.str.replace(PUA_G, (c) => resolved.get(`${fontFamilyKey(r.font)}\u0000${c}`) ?? c);
    }
  return resolved.size;
}

function entry(map: Map<string, Seen>, font: string, glyph: string): Seen {
  const k = `${font}\u0000${glyph}`;
  let s = map.get(k);
  if (!s) map.set(k, (s = { words: [], around: [] }));
  return s;
}

/**
 * A glyph that sits after words and numbers and is followed by a capital or
 * sits between digits ("Fig 1_16", "radiation_ Thus") is a full stop; one
 * followed by lower-case words is a comma.
 */
function punctuation(around: [string, string, string][]): string | null {
  if (around.length < 3) return null;
  // Punctuation is never followed directly by a letter (a ligature is).
  if (around.filter(([, next]) => /\p{L}/u.test(next)).length > around.length * 0.2) return null;
  let stop = 0;
  let comma = 0;
  let total = 0;
  for (const [before, , after] of around) {
    if (!/[\p{L}\p{N})]/u.test(before)) continue;
    total++;
    if (/[\p{Lu}\p{N}(]/u.test(after) || after === " ") stop++;
    else if (/\p{Ll}/u.test(after)) comma++;
  }
  if (total < 3) return null;
  if (stop >= total * 0.7) return ".";
  if (comma >= total * 0.7) return ",";
  return null;
}

// ---------- letter patterns ----------

interface Trigrams {
  counts: Map<string, number>;
  bigrams: Map<string, number>;
}

function buildTrigrams(vocab: Map<string, number>): Trigrams {
  const counts = new Map<string, number>();
  const bigrams = new Map<string, number>();
  for (const [w, n] of vocab) {
    const s = `^${w}$`;
    for (let i = 0; i + 2 < s.length; i++) {
      counts.set(s.slice(i, i + 3), (counts.get(s.slice(i, i + 3)) ?? 0) + n);
      bigrams.set(s.slice(i, i + 2), (bigrams.get(s.slice(i, i + 2)) ?? 0) + n);
    }
  }
  return { counts, bigrams };
}

/** Average log-probability of the letter triples that touch the replaced glyph. */
function fit(word: string, at: number, len: number, t: Trigrams): number {
  const s = `^${word.toLowerCase()}$`;
  const from = Math.max(0, at + 1 - 2);
  const to = Math.min(s.length - 3, at + len);
  let sum = 0;
  let n = 0;
  for (let i = from; i <= to; i++) {
    const tri = s.slice(i, i + 3);
    sum += Math.log(((t.counts.get(tri) ?? 0) + 0.1) / ((t.bigrams.get(tri.slice(0, 2)) ?? 0) + 3));
    n++;
  }
  return n ? sum / n : -Infinity;
}

function bestLigature(words: string[], glyph: string, t: Trigrams): string | null {
  const scores = LIGATURES.map((lig) => {
    let total = 0;
    for (const w of words) {
      const at = w.indexOf(glyph);
      total += fit(w.replaceAll(glyph, lig), at, lig.length, t);
    }
    return { lig, score: total / words.length };
  }).sort((a, b) => b.score - a.score);
  // Only when one ligature is clearly the most English-like (more so from one word).
  return scores[0].score - scores[1].score > (words.length > 1 ? 0.6 : 1) ? scores[0].lig : null;
}
