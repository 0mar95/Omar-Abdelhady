// Kenning's own chapters ("reading units"), the same way for every book.
//
// The book's chapters are used when they can be trusted — enough of them,
// none swallowing the book — and are split when long (at their sections) or
// merged when tiny. When they can't be trusted, the book is cut into units of
// a comfortable reading time at its strongest breaks. Either way every unit
// takes 10–40 minutes or so to read.
//
// Front matter (title page, preface, foreword, the book's own introduction,
// contributors…) and back matter (references, index, glossary, appendices)
// are set apart: they're folded away, carry no quizzes, and aren't read aloud.

import type { Block, BookDoc } from "./model";

export interface ReadingUnit {
  /** Id of the unit's first block. */
  id: string;
  kind: "front" | "read" | "back";
  /** Blocks [start, end). */
  start: number;
  end: number;
  /** The book's chapter number, when the unit is (part of) a numbered chapter. */
  number?: string;
  title: string;
  /** For a part of a longer chapter: that chapter's title, and which part. */
  chapterTitle?: string;
  part?: { index: number; of: number };
  minutes: number;
}

export interface BookUnits {
  units: ReadingUnit[];
  /** Index into `units` for each block. */
  unitOf: Int32Array;
  /** Whether the book's own chapters were used (vs. cut by reading time). */
  trusted: boolean;
}

export const WPM = 230;
const TARGET = 20 * WPM; // words in a comfortable unit
const MAX = 40 * WPM; // longer chapters are split
const MIN_PART = 8 * WPM; // no part shorter than this when splitting
const TINY = 3 * WPM; // chapters this short join their neighbour

const FRONT = /^(?:preface|foreword|fore\s?word|introduction(?: to (?:this|the) (?:book|edition|volume))?|how to use (?:this|the) book|about (?:this|the) book|about the (?:authors?|editors?|contributors?)|contributors?|list of contributors|acknowledg(?:e)?ments?|dedication|series preface|preface to the .+ edition|notes? (?:on|for) (?:the )?(?:reader|contributors|edition)|abbreviations|list of (?:abbreviations|figures|tables|illustrations)|copyright|contents|table of contents|title page|half[- ]?title|front matter|epigraph|prologue)\b/i;
const BACK = /^(?:references|bibliography|further reading|suggested readings?|index|subject index|author index|glossary|appendix|appendices|answers?(?: to)?|notes|endnotes|credits|image credits|about the (?:authors?|editors?)|afterword|epilogue|colophon)\b/i;

/** Kenning's reading units for a book. `wordsBefore[i]` counts the words read before block i. */
export function readingUnits(book: BookDoc, wordsBefore: number[], totalWords: number): BookUnits {
  const blocks = book.blocks;
  const n = blocks.length;
  if (!n) return { units: [], unitOf: new Int32Array(0), trusted: false };
  const wordsIn = (a: number, z: number) => (z >= n ? totalWords : wordsBefore[z]) - (wordsBefore[a] ?? 0);
  const minutes = (a: number, z: number) => Math.max(1, Math.round(wordsIn(a, z) / WPM));

  // The book's top-level divisions, as headings.
  const tops = blocks.map((b, i) => (b.kind === "heading" && b.level === 1 ? i : -1)).filter((i) => i >= 0);
  const titleOf = (i: number) => (blocks[i].kind === "heading" ? (blocks[i] as { text: string }).text.trim() : "");
  const numbered = tops.filter((i) => (blocks[i] as { number?: string }).number);

  // Where the reading starts and ends.
  let firstCore = -1;
  if (numbered.length >= 2) firstCore = numbered[0];
  else firstCore = tops.find((i) => !FRONT.test(titleOf(i))) ?? -1;
  // A book with no usable divisions: everything after the opening pages is read.
  if (firstCore < 0) firstCore = blocks.findIndex((b) => b.kind === "paragraph" && !b.small) ?? 0;
  if (firstCore < 0) firstCore = 0;
  let endCore = n;
  for (let k = tops.length - 1; k >= 0; k--) {
    const i = tops[k];
    if (i <= firstCore || !BACK.test(titleOf(i))) break;
    endCore = i;
  }
  // Back matter set as sections of the last chapter ("Appendix 1", "References").
  const lastTop = tops.filter((i) => i < endCore).pop() ?? firstCore;
  for (let i = Math.max(lastTop, firstCore) + 1; i < endCore; i++) {
    const b = blocks[i];
    if (b.kind === "heading" && b.level <= 2 && /^(?:appendix|appendices|glossary|index|bibliography)\b/i.test(b.text)) {
      endCore = i;
      break;
    }
  }
  // A reference list or index left at the very end, outside any heading.
  while (endCore > firstCore && (blocks[endCore - 1].kind === "references" || blocks[endCore - 1].kind === "index")) endCore--;

  // The book's chapters inside the reading part.
  const coreTops = tops.filter((i) => i >= firstCore && i < endCore);
  if (!coreTops.length || coreTops[0] !== firstCore) coreTops.unshift(firstCore);
  const bases = coreTops.map((a, k) => ({ start: a, end: coreTops[k + 1] ?? endCore }));
  const coreWords = wordsIn(firstCore, endCore) || 1;
  const sizes = bases.map((b) => wordsIn(b.start, b.end)).sort((a, b) => a - b);
  const trusted =
    bases.length >= 3 && sizes[sizes.length - 1] <= coreWords * 0.66 && sizes[Math.floor(sizes.length / 2)] >= 2 * WPM;

  const units: ReadingUnit[] = [];
  if (firstCore > 0) units.push(frontUnit(0, firstCore));

  const reads: ReadingUnit[] = [];
  if (trusted) {
    // Tiny chapters join the next one (or the previous, at the end).
    const merged: { start: number; end: number }[] = [];
    for (const b of bases) {
      const last = merged[merged.length - 1];
      if (last && wordsIn(last.start, last.end) < TINY && !numberOf(last.start)) last.end = b.end;
      else if (last && wordsIn(b.start, b.end) < TINY && !numberOf(b.start)) last.end = b.end;
      else merged.push({ ...b });
    }
    for (const b of merged) reads.push(...split(b.start, b.end));
  } else {
    // No chapters to go by: units of a comfortable length at the strongest breaks.
    reads.push(...split(firstCore, endCore, true));
  }
  // A short piece read as one unit (an article) is named for itself.
  if (reads.length === 1 && !trusted && book.title) reads[0].title = book.title;
  for (const r of reads) r.title = r.title.charAt(0).toUpperCase() + r.title.slice(1);
  units.push(...reads);
  if (endCore < n) units.push({ id: blocks[endCore].id, kind: "back", start: endCore, end: n, title: "After the book", minutes: minutes(endCore, n) });

  const unitOf = new Int32Array(n);
  units.forEach((u, k) => unitOf.fill(k, u.start, u.end));
  return { units, unitOf, trusted };

  function numberOf(i: number): string | undefined {
    const b = blocks[i];
    return b.kind === "heading" && b.level === 1 ? b.number : undefined;
  }

  function frontUnit(a: number, z: number): ReadingUnit {
    return { id: blocks[a].id, kind: "front", start: a, end: z, title: "Before the book", minutes: minutes(a, z) };
  }

  /** One chapter as one unit, or as parts cut at its best breaks when it's long. */
  function split(a: number, z: number, free = false): ReadingUnit[] {
    const head = blocks[a];
    const chapterTitle = head.kind === "heading" ? head.text : "";
    const number = free ? undefined : numberOf(a);
    const total = wordsIn(a, z);
    if (!free && total <= MAX) return [{ id: head.id, kind: "read", start: a, end: z, number, title: chapterTitle || firstTitle(a, z) || "Reading", minutes: minutes(a, z) }];
    // Cut points: a section heading is best, then a sub-section, then a new page.
    const cuts: { at: number; score: number }[] = [];
    for (let i = a + 1; i < z; i++) {
      const b = blocks[i];
      if (b.kind === "heading") cuts.push({ at: i, score: b.level <= 2 ? 3 : 2 });
      else if (b.kind === "paragraph" && blocks[i - 1] && b.page > blocks[i - 1].page) cuts.push({ at: i, score: 1 });
    }
    const parts: { start: number; end: number }[] = [];
    let from = a;
    while (wordsIn(from, z) > (free ? TARGET * 1.5 : MAX)) {
      const lo = wordsBefore[from] + TARGET * 0.6;
      const hi = wordsBefore[from] + (free ? TARGET * 1.5 : MAX * 0.8);
      const window = cuts.filter((c) => c.at > from && wordsBefore[c.at] >= lo && wordsBefore[c.at] <= hi && wordsIn(c.at, z) >= MIN_PART);
      if (!window.length) break;
      const best = Math.max(...window.map((c) => c.score));
      const at = window.filter((c) => c.score === best).sort((p, q) => Math.abs(wordsBefore[p.at] - wordsBefore[from] - TARGET) - Math.abs(wordsBefore[q.at] - wordsBefore[from] - TARGET))[0].at;
      parts.push({ start: from, end: at });
      from = at;
    }
    parts.push({ start: from, end: z });
    return parts.map((p, k) => {
      const title = k === 0 && chapterTitle ? chapterTitle : firstTitle(p.start, p.end) ?? (chapterTitle ? `${chapterTitle} (continued)` : `Part ${k + 1}`);
      return {
        id: blocks[p.start].id,
        kind: "read" as const,
        start: p.start,
        end: p.end,
        number,
        title,
        chapterTitle: parts.length > 1 && chapterTitle ? chapterTitle : undefined,
        part: parts.length > 1 && !free ? { index: k + 1, of: parts.length } : undefined,
        minutes: minutes(p.start, p.end),
      };
    });
  }

  /** The first section title in a stretch of the book. */
  function firstTitle(a: number, z: number): string | undefined {
    for (let i = a; i < Math.min(z, a + 40); i++) {
      const b: Block = blocks[i];
      if (b.kind === "heading") return b.text;
    }
    return undefined;
  }
}

/** The units a quiz, Listen and progress cover: the reading ones. */
export const readUnits = (u: BookUnits) => u.units.filter((x) => x.kind === "read");
