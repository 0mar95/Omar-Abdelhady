// The last step for every book, whatever its format: the same structural
// rules, so a PDF textbook, an EPUB novel and a Word document all come out
// shaped alike — numbered chapters, headings that never skip a level, one
// style of heading text.

import { blockText, spansText, type Block, type HeadingBlock, type Span } from "./model.ts";

const CHAPTER_LABEL = /^(?:chapter|chap\.|part|book|unit|lesson|module)\s+([0-9]{1,3}|[ivxlc]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[.:—–-]?\s*(.*)$/i;
const NUMBERED = /^(\d{1,3})\.?\s+(\p{Lu}.{2,})$/u;
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "per", "the", "to", "vs", "via", "with"]);

/** "CHAPTER IV" → "Chapter IV"; "THE HYPOTHALAMUS AND PAIN" → "The Hypothalamus and Pain". */
export function tidyHeading(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  // Leftover dot leaders and page numbers ("Introduction ........ 12").
  t = t.replace(/\s*(?:[.·…]\s*){3,}\d{0,4}\s*$/, "").trim();
  const letters = t.replace(/[^\p{L}]/gu, "");
  const words = t.split(" ");
  if (letters.length >= 6 && words.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    t = words
      .map((w, i) => {
        if (/^[IVXLC]+[.:]?$/.test(w) || /\d/.test(w)) return w; // roman numerals, codes
        const lower = w.toLowerCase();
        if (i > 0 && SMALL_WORDS.has(lower.replace(/[^\p{L}]/gu, ""))) return lower;
        return lower.replace(/(^|[-‐(“"'’])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
      })
      .join(" ");
  }
  return t;
}

export function normalizeStructure(input: Block[], totalWords?: number): Block[] {
  let blocks = input.filter((b) => b.kind !== "heading" || b.text.trim());
  for (const b of blocks) if (b.kind === "heading") b.text = tidyHeading(b.text);

  // "Chapter 3" + the title just after it → one chapter heading, numbered 3.
  const merged: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "heading" || b.number) {
      merged.push(b);
      continue;
    }
    const m = CHAPTER_LABEL.exec(b.text);
    const next = blocks[i + 1];
    if (m && !m[2].trim() && next?.kind === "heading" && next.page <= b.page + 1) {
      merged.push({ ...b, level: Math.min(b.level, next.level) as HeadingBlock["level"], number: m[1], text: next.text });
      i++;
      continue;
    }
    if (m && m[2].trim() && b.level <= 2) {
      merged.push({ ...b, number: m[1], text: m[2].trim() });
      continue;
    }
    const n = b.level === 1 ? NUMBERED.exec(b.text) : null;
    merged.push(n ? { ...b, number: n[1], text: n[2].trim() } : b);
  }
  blocks = merged;

  blocks = inlineAddresses(blocks);
  blocks = tidyOpening(blocks);
  blocks = stitchSentences(blocks);

  // The same heading twice in a row (a running title repeated) shows once.
  blocks = blocks.filter((b, i) => {
    const prev = blocks[i - 1];
    return !(b.kind === "heading" && prev?.kind === "heading" && prev.text.toLowerCase() === b.text.toLowerCase());
  });

  // A long book needs chapters: if there's at most one top-level heading but
  // many at the next level, those become the chapters.
  const words = totalWords ?? blocks.reduce((a, b) => a + (blockText(b).match(/\S+/g) ?? []).length, 0);
  const headings = blocks.filter((b): b is HeadingBlock => b.kind === "heading");
  const top = headings.filter((h) => h.level === 1).length;
  const second = headings.filter((h) => h.level === 2).length;
  if (words > 15000 && top <= 1 && second >= 3) for (const h of headings) if (h.level > 1) h.level = (h.level - 1) as HeadingBlock["level"];

  // Levels never jump (a chapter's first heading is a section, not a
  // sub-sub-section), and headings that were siblings stay siblings.
  const stack: { from: number; to: number }[] = [];
  for (const b of blocks) {
    if (b.kind !== "heading") continue;
    while (stack.length && stack[stack.length - 1].from >= b.level) stack.pop();
    const parent = stack[stack.length - 1];
    const to = parent ? Math.min(b.level, parent.to + 1) : b.level;
    stack.push({ from: b.level, to });
    b.level = to as HeadingBlock["level"];
  }
  return blocks;
}

// Words only a copyright / cataloguing page uses.
const IMPRINT = [
  /\bISBN\b/i,
  /library of congress/i,
  /british library/i,
  /cataloging|cataloguing/i,
  /all rights reserved/i,
  /(?:©|\(c\)|copyright)\s*(?:©\s*)?(?:19|20)\d\d/i,
  /first published|this edition (?:first )?published|reprinted/i,
  /printed (?:and bound )?in\b/i,
  /no part of this (?:publication|book)/i,
  /\bpermission\b.*\bpublisher\b/i,
  /permission is granted to copy/i,
  /creative commons|gnu free documentation licen[cs]e/i,
  /typeset|set in \d/i,
];

/**
 * The opening pages read like a book's, whatever the source: the copyright
 * and cataloguing page folds into one "Publication details" block, and the
 * title pages keep a single title — the title repeated on the half-title
 * page and the names and degrees under it are text, not chapters.
 */
export function tidyOpening(blocks: Block[]): Block[] {
  if (!blocks.length) return blocks;
  const firstPage = blocks[0].page;
  const pages = new Map<number, Block[]>();
  for (const b of blocks) {
    if (b.page - firstPage > 30) break;
    pages.set(b.page, [...(pages.get(b.page) ?? []), b]);
  }
  // Imprint pages: early pages that hit several imprint markers.
  const imprint = new Set<number>();
  for (const [page, bs] of pages) {
    if (bs.some((b) => b.kind === "contents")) continue;
    const text = bs.map(blockText).join("\n");
    if (IMPRINT.filter((re) => re.test(text)).length >= 2) imprint.add(page);
  }
  // The title pages: everything before the imprint or contents page, if it comes early.
  const contentsAt = blocks.find((b) => b.kind === "contents" && b.page - firstPage <= 30)?.page;
  const firstImprint = imprint.size ? Math.min(...imprint) : undefined;
  // (A preface or foreword before a late contents page keeps its heading.)
  const openingEnd = firstImprint ?? (contentsAt !== undefined && contentsAt - firstPage <= 8 ? contentsAt : Infinity);
  if (!imprint.size && openingEnd === Infinity) return blocks;

  const out: Block[] = [];
  const seen = new Set<string>();
  let title: string | null = null;
  let folded: Block & { kind: "imprint" } | null = null;
  for (const b of blocks) {
    if (imprint.has(b.page) && b.kind !== "figure") {
      const lines = blockLines(b).filter((l) => /[\p{L}\p{N}]{2,}/u.test(l));
      if (!folded) {
        folded = { kind: "imprint", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, lines: [] };
        out.push(folded);
      }
      for (const l of lines) {
        const prev = folded.lines[folded.lines.length - 1];
        // Rejoin lines a narrow page broke apart ("The" / "LATEX" / "source").
        if (prev && !/[.:;)\]]$/.test(prev) && (/^\p{Ll}/u.test(l) || prev.split(" ").length <= 3 || /\/$/.test(prev)))
          folded.lines[folded.lines.length - 1] = prev + (/\/$/.test(prev) ? "" : " ") + l;
        else folded.lines.push(l);
      }
      continue;
    }
    // The half-title page repeats the title page: show its lines once.
    if (b.page < openingEnd && b.kind === "paragraph") {
      const key = spansText(b.spans).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (key && seen.has(key)) continue;
      seen.add(key);
    }
    if (b.page < openingEnd && b.kind === "heading") {
      const key = b.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (title === null) {
        title = key;
        seen.add(key);
        out.push({ ...b, level: 1 });
        continue;
      }
      if (key === title) continue; // the half-title page
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "paragraph", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, spans: [{ text: b.text, b: b.level <= 2 }] });
      continue;
    }
    out.push(b);
  }
  return out;
}

const ADDRESS = /^(?:https?:\/\/|\/\/|www\.)\S+$|^[\w.-]+\.(?:com|org|net|edu|io|gov|ac\.uk|co\.uk)(?:\/\S*)?\.?$/i;

/**
 * A web address set on a line of its own in a typewriter font is part of the
 * sentence around it, not a program listing.
 */
function inlineAddresses(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const line = b.kind === "code" && b.lines.length === 1 ? b.lines[0].trim() : "";
    if (!line || !ADDRESS.test(line)) {
      out.push(b);
      continue;
    }
    const prev = out[out.length - 1];
    const prevText = prev?.kind === "paragraph" ? spansText(prev.spans).trimEnd() : "";
    if (prev?.kind === "paragraph" && prevText && !/[.!?]["”’)]*$/.test(prevText)) {
      const tight = /https?:$/.test(prevText); // "https:" + "//example.org" broken across lines
      const last = prev.spans[prev.spans.length - 1];
      if (tight) last.text = last.text.trimEnd();
      else if (!/\s$/.test(last.text)) prev.spans.push({ text: " " });
      if (tight && last.code) last.text += line;
      else prev.spans.push({ text: line, code: true });
      continue;
    }
    out.push({ kind: "paragraph", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, spans: [{ text: line, code: true }] });
  }
  return out;
}

function blockLines(b: Block): string[] {
  if (b.kind === "list") return b.items.map((it, i) => `${i + 1}. ${spansText(it).trim()}`);
  return blockText(b)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const ENDED = /[.!?:;]["”’)\]]*$/;
/** "term: definition" entries (glossaries) begin in lower case on purpose. */
const TERM = /^\p{Ll}[\p{L}\p{N} '’-]{0,40}:\s/u;
const INTERRUPTIONS = new Set(["figure", "table", "box", "code", "callout"]);

/**
 * A paragraph that starts in lower case continues a sentence: join it to the
 * nearest unfinished paragraph (or list item) before it, past any figure,
 * table or box set in between. Covers sentences broken by a box, a column
 * or page break, or a sidebar with loose lines.
 */
function stitchSentences(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const text = b.kind === "paragraph" ? spansText(b.spans).trim() : "";
    if (b.kind === "paragraph" && !b.small && /^[\p{Ll}]/u.test(text) && !TERM.test(text) && !/^(e\.g\.|i\.e\.|et al|vs\.|www\.|http)/i.test(text)) {
      let j = out.length - 1;
      let skipped = 0;
      while (j >= 0 && INTERRUPTIONS.has(out[j].kind) && skipped < 4) {
        j--;
        skipped++;
      }
      const q = out[j];
      if (q && q.kind === "paragraph" && !q.small && !ENDED.test(spansText(q.spans).trim())) {
        joinSpans(q.spans, b.spans);
        continue;
      }
      if (q && q.kind === "list" && q.items.length && !ENDED.test(spansText(q.items[q.items.length - 1]).trim())) {
        joinSpans(q.items[q.items.length - 1], b.spans);
        continue;
      }
    }
    out.push(b);
  }
  return out;
}

function joinSpans(into: Span[], more: Span[]): void {
  const last = into[into.length - 1];
  if (last && /\p{Ll}-$/u.test(last.text)) last.text = last.text.slice(0, -1); // a line-break hyphen
  else if (last && !/\s$/.test(last.text)) into.push({ text: " " });
  for (const s of more) into.push({ ...s, text: into.length && s === more[0] ? s.text.replace(/^\s+/, "") : s.text });
}
