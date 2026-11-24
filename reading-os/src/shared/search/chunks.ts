// Splits a book into search chunks and margin-note sections. Pure functions:
// the main process indexes these, tests check them directly.

import { blockText, spansText, type Block, type BookDoc } from "../model.ts";
import { countWords } from "../pdf/text.ts";

export type ChunkKind = "text" | "figure" | "table" | "box" | "refs";

export interface Chunk {
  seq: number;
  /** First block of the chunk (where a search result jumps to). */
  blockId: string;
  blockIndex: number;
  blockEnd: number;
  chapter: number;
  /** "Chapter title › Section › Subsection" */
  section: string;
  page: number;
  kind: ChunkKind;
  text: string;
}

const TARGET_WORDS = 220;
const MAX_WORDS = 340;

/** Heading path (chapter › section › subsection) at every block. */
export function sectionPaths(book: BookDoc): string[] {
  const path: string[] = [];
  return book.blocks.map((b) => {
    if (b.kind === "heading") {
      path.length = Math.min(path.length, b.level - 1);
      while (path.length < b.level - 1) path.push("");
      path[b.level - 1] = b.number ? `${b.number}. ${b.text}` : b.text;
    }
    return path.filter(Boolean).join(" › ");
  });
}

function splitWords(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["”’)\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && countWords(cur) + countWords(s) > max) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function buildChunks(book: BookDoc): Chunk[] {
  const paths = sectionPaths(book);
  const chunks: Chunk[] = [];
  let buf: { text: string[]; words: number; start: number; end: number } | null = null;

  const push = (kind: ChunkKind, text: string, start: number, end: number) => {
    const b = book.blocks[start];
    chunks.push({ seq: chunks.length, blockId: b.id, blockIndex: start, blockEnd: end, chapter: b.chapter, section: paths[start], page: b.page, kind, text });
  };
  const flush = () => {
    if (buf && buf.words > 0) push("text", buf.text.join("\n"), buf.start, buf.end);
    buf = null;
  };

  book.blocks.forEach((b: Block, i) => {
    switch (b.kind) {
      case "heading":
        flush();
        return;
      case "index":
      case "contents":
      case "imprint":
      case "titlepage":
        return;
      case "references": {
        flush();
        // References are searchable by exact words (author names), not by meaning.
        for (let k = 0; k < b.items.length; k += 12)
          push("refs", b.items.slice(k, k + 12).map((r) => `${r.n}. ${r.text}`).join("\n"), i, i);
        return;
      }
      case "code": {
        push("figure", b.lines.join("\n"), i, i);
        return;
      }
      case "figure": {
        const t = [b.key, spansText(b.caption), b.labels].filter(Boolean).join(" ");
        if (t.trim()) push("figure", t, i, i);
        return;
      }
      case "table":
      case "box": {
        flush();
        for (const part of splitWords(blockText(b), MAX_WORDS)) push(b.kind, part, i, i);
        return;
      }
      default: {
        const t = blockText(b);
        const words = countWords(t);
        if (!words) return;
        if (words > MAX_WORDS) {
          flush();
          for (const part of splitWords(t, TARGET_WORDS)) push("text", part, i, i);
          return;
        }
        if (buf && buf.words + words > MAX_WORDS) flush();
        if (!buf) buf = { text: [], words: 0, start: i, end: i };
        buf.text.push(t);
        buf.words += words;
        buf.end = i;
        if (buf.words >= TARGET_WORDS) flush();
      }
    }
  });
  flush();
  return chunks;
}

/** Text given to the embedding model: the section path adds useful context. */
export function embedText(c: Pick<Chunk, "section" | "text">): string {
  return `${c.section}\n${c.text}`.slice(0, 4000);
}

export interface NoteSection {
  /** The heading block the note sits beside. */
  blockId: string;
  blockIndex: number;
  endIndex: number;
  path: string;
  text: string;
  words: number;
}

/**
 * Sections that get a margin note: each level-2/3 heading up to the next
 * heading of the same or a higher level. Very short sections are skipped.
 */
export function noteSections(book: BookDoc, minWords = 90): NoteSection[] {
  const paths = sectionPaths(book);
  const out: NoteSection[] = [];
  // In books with numbered chapters, front matter (preface, contributors) gets no notes.
  // Most chapters must be numbered: one stray number shouldn't silence the rest.
  const numbered = book.chapters.filter((c) => c.number).length * 2 > book.chapters.length;
  book.blocks.forEach((b, i) => {
    if (b.kind !== "heading" || b.level < 2 || b.level > 3) return;
    if (numbered && !book.chapters[b.chapter]?.number) return;
    let end = i + 1;
    while (end < book.blocks.length) {
      const n = book.blocks[end];
      if (n.kind === "heading" && n.level <= b.level) break;
      if (n.kind === "references" || n.kind === "index") break;
      end++;
    }
    const parts: string[] = [];
    let words = 0;
    for (let k = i + 1; k < end && words < 1600; k++) {
      const x = book.blocks[k];
      if (x.kind === "paragraph" || x.kind === "list" || x.kind === "callout" || x.kind === "box" || (x.kind === "heading" && x.level > b.level)) {
        const t = blockText(x);
        parts.push(t);
        words += countWords(t);
      }
    }
    if (words < minWords) return;
    out.push({ blockId: b.id, blockIndex: i, endIndex: end - 1, path: paths[i], text: parts.join("\n"), words });
  });
  return out;
}

// ---------- ranking ----------

export interface Ranked {
  key: number;
  rank: number;
}

/** Reciprocal Rank Fusion of several ranked lists (keys are chunk row ids). */
export function fuse(lists: Ranked[][], k = 60): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of lists) for (const r of list) scores.set(r.key, (scores.get(r.key) ?? 0) + 1 / (k + r.rank));
  return scores;
}

const STOPWORDS = new Set(
  "a an and are as at be been but by can do does did for from had has have how i if in into is it its may me my of on or our should so than that the their them then there these they this those to was we were what when where which who why will with would you your about tell explain describe".split(
    " ",
  ),
);

/** Turns what the reader typed into a safe FTS5 query (implicit AND, prefix on the last word). */
export function ftsQuery(q: string, mode: "and" | "or" = "and"): string | null {
  const all = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 1 || /\d/.test(w));
  // Questions are full of filler words; search for the words that carry meaning.
  const content = all.filter((w) => !STOPWORDS.has(w));
  const words = content.length ? content : all;
  if (!words.length) return null;
  const terms = words.map((w, i) => `"${w.replace(/"/g, "")}"${i === words.length - 1 && w.length >= 3 ? "*" : ""}`);
  return terms.join(mode === "and" ? " " : " OR ");
}

/** Embedding models expect slightly different phrasing for queries and documents. */
export function embedPrefix(model: string, kind: "query" | "document"): string {
  if (/qwen3-embedding/i.test(model))
    return kind === "query" ? "Instruct: Given a question or topic, retrieve passages of a book that answer or discuss it\nQuery: " : "";
  if (/nomic-embed/i.test(model)) return kind === "query" ? "search_query: " : "search_document: ";
  if (/embeddinggemma/i.test(model)) return kind === "query" ? "task: search result | query: " : "title: none | text: ";
  return "";
}
