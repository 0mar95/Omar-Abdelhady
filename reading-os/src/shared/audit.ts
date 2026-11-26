// The book contract: what every book that comes out of the engine should look
// like, whatever its format. Used by `npm run audit` to find books that
// misbehave, and by tests to keep the engine consistent.

import { blockText, type Block, type BookDoc, type ContentsEntry } from "./model.ts";

export interface AuditIssue {
  check: string;
  severity: "error" | "warn";
  message: string;
  samples: string[];
}

export interface AuditReport {
  score: number;
  issues: AuditIssue[];
  metrics: Record<string, number>;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Where a contents entry leads: its printed page (and the heading there), else a heading with its title. */
export function resolveContentsEntry(book: BookDoc, fromIndex: number, e: ContentsEntry): number | null {
  const title = norm(e.title);
  const fromPage = book.blocks[fromIndex]?.page ?? 0;
  const pageIdx = book.pages.findIndex((p, i) => i > fromPage && p.label === e.page);
  if (pageIdx >= 0) {
    let first = -1;
    for (let i = fromIndex + 1; i < book.blocks.length; i++) {
      const b = book.blocks[i];
      if (b.page < pageIdx) continue;
      if (b.page > pageIdx + 1) break;
      if (first < 0) first = i;
      if (b.kind === "heading" && norm(b.text) === title) return i;
    }
    if (first >= 0) return first;
  }
  for (let i = fromIndex + 1; i < book.blocks.length; i++) {
    const b = book.blocks[i];
    if (b.kind === "heading" && norm(b.text) === title) return i;
  }
  return null;
}

// Scrambled text swaps letters for symbols and digits inside words ("radiati'3", "de3se$y");
// apostrophes, code and maths are not counted.
const GARBLED = /\p{L}[$"<>;3#%]\p{L}/u;

export function auditBook(book: BookDoc): AuditReport {
  const issues: AuditIssue[] = [];
  const add = (check: string, severity: AuditIssue["severity"], message: string, samples: string[] = []) =>
    issues.push({ check, severity, message, samples: samples.map((s) => clip(s)) });
  const blocks = book.blocks;
  const texts = blocks.map(blockText);
  const words = (t: string) => (t.match(/\S+/g) ?? []).length;
  const totalWords = texts.reduce((a, t) => a + words(t), 0) || 1;

  // --- identity ---
  const ids = new Set<string>();
  const dup: string[] = [];
  for (const b of blocks) (ids.has(b.id) ? dup.push(b.id) : ids.add(b.id));
  if (dup.length) add("ids", "error", `${dup.length} duplicate block ids`, dup);
  if (!book.title?.trim()) add("title", "error", "no title");
  if (!blocks.length) add("empty", "error", "no text was found");

  // --- chapters ---
  const chWords = book.chapters.map((c) => {
    let n = 0;
    for (let i = c.start; i < Math.min(c.end, blocks.length); i++) n += words(texts[i]);
    return n;
  });
  const realChapters = book.chapters.filter((c) => c.title !== "Front matter");
  if (totalWords > 15000 && realChapters.length < 2) add("chapters", "error", `a ${totalWords}-word book has ${realChapters.length} chapter(s)`);
  const biggest = Math.max(0, ...chWords);
  if (book.chapters.length > 2 && totalWords > 15000 && biggest / totalWords > 0.5)
    add("chapters", "warn", `one chapter holds ${Math.round((biggest / totalWords) * 100)}% of the book`, [book.chapters[chWords.indexOf(biggest)].title]);
  const front = book.chapters[0];
  if (front?.title === "Front matter" && totalWords > 15000 && chWords[0] / totalWords > 0.25)
    add("chapters", "warn", `front matter holds ${Math.round((chWords[0] / totalWords) * 100)}% of the book (chapters start too late)`);
  const emptyCh = book.chapters.filter((_, i) => chWords[i] < 20 && i > 0).map((c) => c.title);
  if (emptyCh.length > 1) add("chapters", "warn", `${emptyCh.length} chapters with almost no text`, emptyCh);
  if (realChapters.length > 200) add("chapters", "warn", `${realChapters.length} chapters (headings promoted too eagerly?)`, realChapters.slice(0, 5).map((c) => c.title));

  // --- contents page ---
  const contents = blocks.findIndex((b) => b.kind === "contents");
  if (contents >= 0) {
    const c = blocks[contents];
    if (c.kind === "contents") {
      const unresolved = c.entries.filter((e) => resolveContentsEntry(book, contents, e) === null);
      if (unresolved.length > c.entries.length * 0.2)
        add("contents", "warn", `${unresolved.length} of ${c.entries.length} contents entries lead nowhere`, unresolved.map((e) => `${e.title} (${e.page})`));
      const numbered = c.entries.filter((e) => e.num && /^\d+$/.test(e.num)).length;
      if (numbered >= 3 && realChapters.length < numbered * 0.6)
        add("contents", "warn", `contents lists ${numbered} numbered chapters, the book has ${realChapters.length}`);
      const glued = c.entries.filter((e) => /\b\d{1,2}\.\s+\p{Lu}/u.test(e.title) || /, [\p{Lu}]{1,3}\b/u.test(e.title));
      if (glued.length) add("contents", "warn", `${glued.length} entries look like two lines run together`, glued.map((e) => e.title));
    }
  }

  // --- headings ---
  let prevLevel = 0;
  const jumps: string[] = [];
  const longH: string[] = [];
  const pageNumH: string[] = [];
  const dupH: string[] = [];
  let prevHeading = "";
  blocks.forEach((b) => {
    if (b.kind !== "heading") {
      if (texts[blocks.indexOf(b)]?.trim()) prevHeading = "";
      return;
    }
    if (prevLevel && b.level > prevLevel + 1) jumps.push(`${"#".repeat(prevLevel)} → ${"#".repeat(b.level)} ${b.text}`);
    prevLevel = b.level;
    if (b.text.length > 120) longH.push(b.text);
    if (/(\.{3,}|\s)\d{1,4}$/.test(b.text) && !/\b(chapter|part|section|appendix|figure|table)\s+\d+$/i.test(b.text)) pageNumH.push(b.text);
    if (prevHeading && norm(prevHeading) === norm(b.text)) dupH.push(b.text);
    prevHeading = b.text;
  });
  if (jumps.length > 3) add("headings", "warn", `${jumps.length} headings skip a level`, jumps);
  if (longH.length) add("headings", "warn", `${longH.length} headings are paragraph-long`, longH);
  if (pageNumH.length > 2) add("headings", "warn", `${pageNumH.length} headings end with a page number`, pageNumH);
  if (dupH.length) add("headings", "warn", `${dupH.length} headings repeated back to back`, dupH);

  // --- paragraphs ---
  // Sentences are judged on the chapters you read, not title and copyright pages.
  const inBody = (b: Block) => realChapters.length < 2 || book.chapters[b.chapter]?.title !== "Front matter";
  const paras = blocks.map((b, i) => ({ b, t: texts[i] })).filter((x) => x.b.kind === "paragraph" && !(x.b as { small?: boolean }).small && inBody(x.b));
  // A paragraph may open with a program name ("int converts…") or a glossary term.
  const opensWithCode = (b: Block) => b.kind === "paragraph" && !!b.spans.find((s) => s.text.trim())?.code;
  const lower = paras.filter(
    (p) =>
      !opensWithCode(p.b) && /^[\p{Ll}]/u.test(p.t.trim()) && !/^\p{Ll}[\p{L}\p{N} '’-]{0,40}:\s/u.test(p.t.trim()) && !/^(e\.g\.|i\.e\.|et al|vs\.|www\.|http)/i.test(p.t.trim()),
  );
  const lowerShare = lower.length / Math.max(1, paras.length);
  if (paras.length > 20 && lowerShare > 0.03)
    add("sentences", lowerShare > 0.08 ? "error" : "warn", `${Math.round(lowerShare * 100)}% of paragraphs start mid-sentence`, lower.map((p) => p.t));
  const hyph = paras.filter((p) => /\p{Ll}-\s\p{Ll}/u.test(p.t) && /\b\p{Ll}{2,}- \p{Ll}{2,}\b/u.test(p.t)).map((p) => (p.t.match(/\S+- \S+/u) ?? [p.t])[0]);
  if (hyph.length > Math.max(3, paras.length * 0.01)) add("hyphens", "warn", `${hyph.length} paragraphs keep line-break hyphens`, hyph);
  const tiny = paras.filter((p) => words(p.t) <= 3 && !/[.!?:]$/.test(p.t.trim()));
  if (paras.length > 30 && tiny.length / paras.length > 0.08) add("fragments", "warn", `${tiny.length} paragraphs are stray fragments of 1–3 words`, tiny.map((p) => p.t));

  // --- text quality ---
  const all = texts.filter((_, i) => blocks[i].kind !== "code").join("\n");
  const pua = (all.match(/[-]/g) ?? []).length;
  if (pua > 20) add("text", "warn", `${pua} unreadable private glyphs left in the text`);
  const fffd = (all.match(/�/g) ?? []).length;
  if (fffd > 5) add("text", "warn", `${fffd} replacement characters (�)`);
  const tokens = all.split(/\s+/).filter((w) => w.length > 3 && !/[=()[\]{}_/\\]|^https?:/.test(w));
  const garbled = tokens.filter((w) => GARBLED.test(w));
  if (tokens.length > 500 && garbled.length / tokens.length > 0.01)
    add("text", "error", `${Math.round((garbled.length / tokens.length) * 1000) / 10}% of words look scrambled`, garbled.slice(0, 8));

  // --- figures and links ---
  const figs = blocks.filter((b) => b.kind === "figure");
  const keyed = new Set(blocks.flatMap((b) => ((b.kind === "figure" || b.kind === "table" || b.kind === "box") && b.key ? [b.key] : [])));
  const mentioned = new Set<string>();
  for (const b of blocks) {
    const spans = b.kind === "paragraph" ? b.spans : b.kind === "list" ? b.items.flat() : [];
    for (const s of spans) if (s.xref) mentioned.add(s.xref);
  }
  const unlinked = paras.filter((p) => /\b(Fig(?:ure)?\.?|Table)\s+\d+[-.]\d+/.test(p.t) && !(p.b.kind === "paragraph" && p.b.spans.some((s) => s.xref)));
  if (keyed.size && unlinked.length > paras.length * 0.02 && unlinked.length > 3)
    add("links", "warn", `${unlinked.length} paragraphs mention figures or tables that aren't linked`, unlinked.map((p) => (p.t.match(/\b(Fig(?:ure)?\.?|Table)\s+\d+[-.]\d+/) ?? [""])[0]));

  // --- pages ---
  if ((book.format ?? "pdf") === "pdf" && book.pageCount > 20) {
    const labelled = book.pages.filter((p) => p.label && /^\d+$/.test(p.label));
    if (labelled.length < book.pageCount * 0.5) add("pages", "warn", `only ${labelled.length} of ${book.pageCount} pages have printed page numbers`);
  }

  const metrics = {
    words: totalWords,
    chapters: realChapters.length,
    headings: blocks.filter((b) => b.kind === "heading").length,
    paragraphs: paras.length,
    figures: figs.length,
    tables: blocks.filter((b) => b.kind === "table").length,
    midSentencePct: Math.round(lowerShare * 1000) / 10,
  };
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + (i.severity === "error" ? 20 : 6), 0));
  return { score, issues, metrics };
}

