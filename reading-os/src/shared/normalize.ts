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
