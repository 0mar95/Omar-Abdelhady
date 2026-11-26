// What each chapter opener shows: reading time, the chapter's own key points
// or objectives (pulled up from inside the chapter), its sections, and the
// chapter authors listed on the book's contents page.

import type { BookDoc, CalloutBlock } from "../../../shared/model";
import type { BookIndex } from "../state/reader";

export interface ChapterOutline {
  number?: string;
  minutes: number;
  authors?: string;
  keyPoints?: CalloutBlock;
  sections: { id: string; text: string }[];
}

export interface BookOutline {
  /** Keyed by the id of the heading that opens each chapter. */
  byHeading: Map<string, ChapterOutline>;
  /** Callouts shown in a chapter opener instead of where they were printed. */
  pulled: Set<string>;
}

const WPM = 230;
const cache = new WeakMap<BookDoc, BookOutline>();
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function outlineOf(book: BookDoc, ix: BookIndex): BookOutline {
  const hit = cache.get(book);
  if (hit) return hit;
  const authors = new Map<string, string>();
  for (const b of book.blocks) if (b.kind === "contents") for (const e of b.entries) if (e.authors) authors.set(norm(e.title), e.authors);
  const byHeading = new Map<string, ChapterOutline>();
  const pulled = new Set<string>();
  for (const c of book.chapters) {
    const head = book.blocks[c.start];
    if (head?.kind !== "heading" || head.level !== 1) continue;
    const end = Math.min(c.end, book.blocks.length);
    const words = (ix.wordsBefore[end] ?? ix.totalWords) - (ix.wordsBefore[c.start] ?? 0);
    const sections: ChapterOutline["sections"] = [];
    let keyPoints: CalloutBlock | undefined;
    let reference = false;
    for (let i = c.start + 1; i < end; i++) {
      const b = book.blocks[i];
      if (b.kind === "contents" || b.kind === "index") reference = true;
      if (b.kind === "heading" && b.level === 2) sections.push({ id: b.id, text: b.text });
      // Objectives and key points belong up front, before the reading starts.
      if (!keyPoints && b.kind === "callout" && b.items.length) keyPoints = b;
    }
    if (keyPoints) pulled.add(keyPoints.id);
    // A contents page or an index isn't read through: no reading time.
    if (reference && !keyPoints) continue;
    byHeading.set(head.id, {
      number: head.number,
      minutes: Math.max(1, Math.round(words / WPM)),
      authors: authors.get(norm(head.text)) ?? (head.kind === "heading" ? head.byline : undefined),
      keyPoints,
      sections: sections.length >= 3 && sections.length <= 14 ? sections : [],
    });
  }
  const out = { byHeading, pulled };
  cache.set(book, out);
  return out;
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min read`;
  const h = Math.floor(m / 60);
  const r = Math.round((m % 60) / 5) * 5;
  return r ? `${h} h ${r} min read` : `${h} h read`;
}
