// "Catch me up": what to tell a reader who comes back to a book. Built only
// from text before the reading position, so a recap never spoils what's ahead.
// Pure (no AI, no DOM) so it can be tested on its own.

import { blockText, type BookDoc } from "./model.ts";
import { countWords } from "./pdf/text.ts";
import { sectionPaths } from "./search/chunks.ts";

export type RecapScope = "recent" | "chapter" | "book";

export interface RecapOutlineItem {
  blockId: string;
  blockIndex: number;
  path: string;
  /** The margin note's one-line summary, when one has been written. */
  summary?: string;
  /** Opening words of the section, used when there is no note. */
  opening?: string;
}

export interface RecapMaterial {
  scope: RecapScope;
  /** Sections already read in this scope, oldest first. */
  outline: RecapOutlineItem[];
  /** Raw text read most recently, ending at the reading position. */
  passage: string;
  stoppedAt: { blockId: string; path: string; snippet: string };
  /** Too little has been read for a recap to say anything. */
  empty: boolean;
}

const READABLE = new Set(["paragraph", "list", "callout", "box"]);
const PASSAGE_WORDS: Record<RecapScope, number> = { recent: 1300, chapter: 900, book: 350 };
const OUTLINE_CHARS = 7000;

function firstWords(text: string, n: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
}

/**
 * Headings (levels 1–3) at or before `pos` with some text of their own, i.e.
 * before the next heading. A chapter title followed straight by its first
 * section is left out; the section stands for it.
 */
function readSections(book: BookDoc, pos: number, paths: string[]): { blockId: string; blockIndex: number; path: string; text: string }[] {
  const out: { blockId: string; blockIndex: number; path: string; text: string }[] = [];
  for (let i = 0; i <= pos && i < book.blocks.length; i++) {
    const b = book.blocks[i];
    if (b.kind !== "heading" || b.level > 3) continue;
    const parts: string[] = [];
    let words = 0;
    for (let k = i + 1; k < book.blocks.length && words < 80; k++) {
      const x = book.blocks[k];
      if (x.kind === "heading" || x.kind === "references" || x.kind === "index") break;
      if (!READABLE.has(x.kind) || (x.kind === "paragraph" && x.small)) continue;
      const t = blockText(x);
      parts.push(t);
      words += countWords(t);
    }
    if (words >= 40) out.push({ blockId: b.id, blockIndex: i, path: paths[i], text: parts.join(" ") });
  }
  return out;
}

/** Gathers what a recap of `scope` should be written from, for a reader at block `pos`. */
export function recapMaterial(book: BookDoc, pos: number, scope: RecapScope, notes: Map<string, { summary: string }>): RecapMaterial {
  pos = Math.max(0, Math.min(pos, book.blocks.length - 1));
  const paths = sectionPaths(book);
  const chapter = book.blocks[pos]?.chapter ?? 0;
  const chapterStart = book.chapters[chapter]?.start ?? 0;

  // Recent raw text, walking back from the position.
  const parts: string[] = [];
  let words = 0;
  let passageStart = pos + 1;
  for (let k = pos; k >= 0 && words < PASSAGE_WORDS[scope]; k--) {
    const b = book.blocks[k];
    if (scope === "chapter" && k < chapterStart) break;
    if (b.kind === "heading") {
      parts.unshift(`## ${b.text}`);
      passageStart = k;
      continue;
    }
    if (!READABLE.has(b.kind) || (b.kind === "paragraph" && b.small)) continue;
    const t = blockText(b);
    parts.unshift(t);
    words += countWords(t);
    passageStart = k;
  }
  const passage = parts.join("\n\n").trim();

  // Sections already read, before the recent passage (the passage covers the rest).
  const all = readSections(book, pos, paths);
  let sections = all;
  if (scope === "recent") sections = all.filter((s) => s.blockIndex < passageStart).slice(-4);
  else if (scope === "chapter") sections = all.filter((s) => s.blockIndex >= chapterStart);
  const outline: RecapOutlineItem[] = sections.map((s) => {
    const summary = notes.get(s.blockId)?.summary;
    return { blockId: s.blockId, blockIndex: s.blockIndex, path: s.path, summary, opening: summary ? undefined : firstWords(s.text, 45) };
  });

  // Keep the outline within budget: drop openings from the oldest sections first, then whole items.
  const size = () => outline.reduce((n, o) => n + o.path.length + (o.summary ?? o.opening ?? "").length + 8, 0);
  for (let i = 0; i < outline.length && size() > OUTLINE_CHARS; i++) if (outline[i].opening) outline[i] = { ...outline[i], opening: undefined };
  while (outline.length > 1 && size() > OUTLINE_CHARS) outline.splice(Math.floor(outline.length / 2), 1);

  // Where the reader stopped: the block at the position, or the next readable one after a heading.
  let at = pos;
  while (at < book.blocks.length - 1 && !READABLE.has(book.blocks[at].kind) && at - pos < 4) at++;
  const stoppedAt = { blockId: book.blocks[pos].id, path: paths[pos] ?? "", snippet: firstWords(blockText(book.blocks[at]), 22) };

  const readWords = countWords(passage);
  return { scope, outline, passage, stoppedAt, empty: readWords < 40 && outline.length === 0 };
}

const SYSTEM = `You help a reader pick a book back up. You write recaps of what they have ALREADY read.
Rules:
- Use only the book text and notes provided. Never mention or guess at what comes later.
- Be concrete: name the actual ideas, terms, findings and examples. No filler like "the author discusses".
- Plain Markdown only: "- " bullets, **bold** for key terms. No headings, no preamble, no closing offers.`;

const TASKS: Record<RecapScope, string> = {
  recent:
    "Write a short \"previously\" recap for a reader returning after a break: 3 to 5 bullets in reading order covering what they read most recently, the most recent last. End with one sentence, not a bullet, starting \"You stopped as\" that says what the text was in the middle of. 120 words at most.",
  chapter:
    "Recap this chapter up to where the reader is: one sentence on what the chapter is about, then 3 to 6 bullets with its key points so far, in order. 160 words at most.",
  book: "Recap the book so far: one bullet per chapter read, starting with the chapter name in bold, then its main points in one or two sentences. Finish with one sentence on where the reader is now. 240 words at most.",
};

export function recapMessages(bookTitle: string, chapterTitle: string, m: RecapMaterial): { role: "system" | "user"; content: string }[] {
  const outline = m.outline
    .map((o) => `- ${o.path}${o.summary ? `: ${o.summary}` : o.opening ? `: (opens with) ${o.opening}` : ""}`)
    .join("\n");
  const user = `Book: ${bookTitle}${chapterTitle ? `\nCurrent chapter: ${chapterTitle}` : ""}
${outline ? `\nSections read earlier, with notes:\n${outline}\n` : ""}
Most recently read text, ending where the reader stopped:
"""${m.passage || "(none)"}"""

The reader stopped at: ${m.stoppedAt.path || "(start)"} — "${m.stoppedAt.snippet}"

Task: ${TASKS[m.scope]}`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/** "2 hours", "3 days" — how long the reader has been away. */
export function awayFor(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"}`;
  const w = Math.round(d / 7);
  if (d < 60) return `${w} weeks`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo} months` : "over a year";
}

/** A returning reader gets an automatic recap after this long away. */
export const CATCH_UP_AFTER_MS = 4 * 60 * 60 * 1000;
