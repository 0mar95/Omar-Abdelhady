// One structure for every book, whatever the source looked like:
//   1. the chapters and sections — from the PDF's own bookmarks when it has
//      them, otherwise from the book's headings (the printed contents page
//      only confirms numbers and authors);
//   2. the opening pages sorted by role — a composed title page, then one
//      folded "About this book" (copyright, adverts, dedication,
//      contributors, acknowledgements); blank pages go; the foreword and
//      preface stay to be read;
//   3. a chapter has to be one: a top-level heading with almost no text
//      under it is a section.

import { blockText, spansText, type AboutBlock, type Block, type HeadingBlock } from "./model.ts";

export interface OutlineItem {
  title: string;
  /** 1 = chapter (top level of the bookmarks), 2 = section, … */
  level: number;
  /** Zero-based page index the bookmark points to. */
  page: number;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const words = (b: Block) => (blockText(b).match(/\S+/g) ?? []).length;
const text = (b: Block) => (b.kind === "heading" ? b.text : b.kind === "paragraph" ? spansText(b.spans) : blockText(b)).replace(/\s+/g, " ").trim();

/** Parts of a book that are read like chapters but have no number. */
export const READ_PARTS = /^(?:preface|foreword|prologue|introduction|how to use this book|to the (?:reader|student)|epilogue|afterword|conclusion|appendix|appendices|glossary|index|references|bibliography)\b/i;
/** Opening-page parts that are kept but not read through. */
const ABOUT_PARTS = /^(?:(?:list of )?contributors?|contributing authors|acknowledg(?:e)?ments?|dedication|about the (?:authors?|editors?|book)|reviewers?|editorial board|disclaimer(?: notice)?|copyright|notice|also (?:by|available)|other books|abbreviations)\b/i;
const BLANK = /^this page (?:is )?intentionally (?:left )?blank\.?$/i;

/**
 * Bookmarks decide the levels: each one finds its heading (on its page or
 * the next), which takes the bookmark's level; a bookmark without a heading
 * in the text gets one. Headings the bookmarks don't list sit below the
 * deepest level they use.
 */
export function applyOutline(blocks: Block[], outline: OutlineItem[] | undefined): Block[] {
  if (!outline || outline.length < 3) return blocks;
  const top = outline.filter((o) => o.level === 1);
  if (top.length < 2) return blocks;
  const deepest = Math.min(3, Math.max(...outline.map((o) => o.level)));
  const matched = new Set<Block>();
  const inserts = new Map<number, HeadingBlock[]>();
  for (const o of outline) {
    if (o.level > 3) continue;
    const want = norm(o.title);
    if (!want) continue;
    let hit = blocks.find((b) => b.kind === "heading" && !matched.has(b) && b.page >= o.page && b.page <= o.page + 1 && sameTitle(norm(b.text), want));
    // A title the layout didn't mark as a heading (a styled paragraph).
    hit ??= blocks.find((b) => b.kind === "paragraph" && b.page >= o.page && b.page <= o.page + 1 && sameTitle(norm(text(b)), want) && words(b) <= 14);
    if (hit && hit.kind === "paragraph") {
      const i = blocks.indexOf(hit);
      const h: HeadingBlock = { kind: "heading", id: hit.id, page: hit.page, rect: hit.rect, chapter: 0, level: o.level as HeadingBlock["level"], text: text(hit) };
      blocks[i] = h;
      hit = h;
    }
    if (hit && hit.kind === "heading") {
      hit.level = o.level as HeadingBlock["level"];
      matched.add(hit);
      continue;
    }
    const at = blocks.findIndex((b) => b.page >= o.page);
    if (at < 0) continue;
    const h: HeadingBlock = { kind: "heading", id: `ol-${o.page}-${norm(o.title).slice(0, 24)}`, page: blocks[at].page, rect: blocks[at].rect, chapter: 0, level: o.level as HeadingBlock["level"], text: o.title.trim() };
    inserts.set(at, [...(inserts.get(at) ?? []), h]);
    matched.add(h);
  }
  const out: Block[] = [];
  blocks.forEach((b, i) => {
    out.push(...(inserts.get(i) ?? []));
    if (b.kind === "heading" && !matched.has(b) && b.level <= deepest) b.level = Math.min(4, deepest + 1) as HeadingBlock["level"];
    out.push(b);
  });
  return out;
}

function sameTitle(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Numbered in one place, not the other: "1.1 What is a program?" vs "What is a program?".
  const strip = (s: string) => s.replace(/^\d+/, "");
  return strip(a) === strip(b) || (a.length > 10 && b.length > 10 && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * Where the book proper starts: the first chapter, or the foreword / preface
 * if they come first. Everything before it is the opening.
 */
function bookStart(blocks: Block[]): number {
  const contents = blocks.findIndex((b) => b.kind === "contents");
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Only a top-level heading starts the book (not a quotation set as a heading inside the preface).
    if (b.kind !== "heading" || b.level > 1) continue;
    if (b.number) return i; // "1 Introduction" is chapter 1, whatever it's called
    if (ABOUT_PARTS.test(b.text) || READ_PARTS.test(b.text) || /^(?:table of )?contents$/i.test(b.text)) continue;
    if (i > contents) {
      // A real chapter (or a letter, a part) has text under it.
      let n = 0;
      for (let k = i + 1; k < blocks.length && !(blocks[k].kind === "heading" && (blocks[k] as HeadingBlock).level <= b.level); k++) n += words(blocks[k]);
      if (n >= 250) return i;
    }
  }
  // No chapter in sight (an extract of the opening pages): reading starts at the foreword or preface.
  const read = blocks.findIndex((b) => b.kind === "heading" && b.level <= 2 && READ_PARTS.test(b.text));
  return read > 0 ? read : 0;
}

/**
 * The opening pages, sorted by role. The title page stays first; copyright,
 * adverts, dedication, epigraphs, contributors and acknowledgements fold into
 * one "About this book"; the printed contents page is kept for its numbers and
 * authors but shown as Kenning's own contents; blank pages go.
 */
export function organizeOpening(input: Block[]): Block[] {
  let blocks = input.filter((b) => !(b.kind === "paragraph" && BLANK.test(text(b))));
  const start = bookStart(blocks);
  if (start <= 0) return blocks;
  const about: AboutBlock["sections"] = [];
  const kept: Block[] = [];
  const add = (title: string, lines: string[]) => {
    const clean = lines.map((l) => l.trim()).filter(Boolean);
    if (!clean.length) return;
    const same = about.find((s) => s.title === title);
    if (same) same.lines.push(...clean);
    else about.push({ title, lines: clean });
  };
  // Untitled text folds only from short pages (a dedication, an epigraph) — never from
  // a whole book on one "page" (plain text, an EPUB file).
  const pageWords = new Map<number, number>();
  for (const b of blocks) pageWords.set(b.page, (pageWords.get(b.page) ?? 0) + words(b));
  let current: { title: string; level: number } | null = null;
  let reading = false; // inside a foreword or preface: its text is read, not folded
  for (let i = 0; i < start; i++) {
    const b = blocks[i];
    if (b.kind === "titlepage" || b.kind === "contents") {
      kept.push(b);
      current = null;
      continue;
    }
    if (b.kind === "imprint") {
      add("Publication details", b.lines);
      continue;
    }
    if (b.kind === "heading") {
      if (/^(?:table of )?contents$/i.test(b.text)) continue; // Kenning shows its own
      if (ABOUT_PARTS.test(b.text)) {
        current = { title: titleCase(b.text), level: b.level };
        reading = false;
        continue;
      }
      if (current && b.level > current.level) {
        add(current.title, [b.text]);
        continue;
      }
      current = null;
      reading = READ_PARTS.test(b.text) || reading;
      kept.push(b);
      continue;
    }
    if (b.kind === "figure" && !current) {
      kept.push(b);
      continue;
    }
    if (current) {
      add(current.title, blockLines(b));
      continue;
    }
    // Untitled text in the opening: on a short page of its own, a dedication or an epigraph.
    const t = text(b);
    if (reading || (pageWords.get(b.page) ?? 0) > 150) kept.push(b);
    else if (/^(?:to|for|in (?:loving )?memory|dedicated)\b/i.test(t) && words(b) <= 60) add("Dedication", [t]);
    else add("From the opening pages", blockLines(b));
  }
  if (!about.length) return blocks;
  const first = blocks[0];
  const aboutBlock: AboutBlock = { kind: "about", id: `about-${first.id}`, page: first.page, rect: first.rect, chapter: 0, sections: order(about) };
  // Title page first, then About this book, then the rest of the opening that is read.
  const tp = kept.filter((b) => b.kind === "titlepage");
  const rest = kept.filter((b) => b.kind !== "titlepage");
  blocks = [...tp, aboutBlock, ...rest, ...blocks.slice(start)];
  return blocks;
}

function order(sections: AboutBlock["sections"]): AboutBlock["sections"] {
  const rank = (t: string) => ["Dedication", "From the opening pages", "Contributors", "Acknowledgments", "Acknowledgements", "Publication details"].indexOf(t);
  return [...sections].sort((a, b) => (rank(a.title) < 0 ? 2.5 : rank(a.title)) - (rank(b.title) < 0 ? 2.5 : rank(b.title)));
}

function titleCase(t: string): string {
  const s = t.trim().replace(/[:.]$/, "");
  return s === s.toUpperCase() ? s[0] + s.slice(1).toLowerCase() : s;
}

function blockLines(b: Block): string[] {
  if (b.kind === "list") return b.items.map((it) => spansText(it).trim());
  return blockText(b)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * A chapter has to be one: after the opening, a top-level heading with
 * almost no text before the next one is a section (a disease entry in an
 * atlas, a one-paragraph "Summary"). Named parts (Preface, Index…) stay.
 */
export function settleChapters(blocks: Block[]): void {
  const tops = blocks.map((b, i) => (b.kind === "heading" && b.level === 1 ? i : -1)).filter((i) => i >= 0);
  if (tops.length < 4) return;
  const size = tops.map((i, k) => {
    let n = 0;
    for (let j = i + 1; j < (tops[k + 1] ?? blocks.length); j++) n += words(blocks[j]);
    return n;
  });
  const typical = [...size].sort((a, b) => a - b)[Math.floor(size.length / 2)];
  tops.forEach((i, k) => {
    const h = blocks[i] as HeadingBlock;
    if (h.number || READ_PARTS.test(h.text)) return;
    if (size[k] < Math.min(150, typical * 0.1)) h.level = 2;
  });
}
