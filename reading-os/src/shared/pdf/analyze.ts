// Runs all extraction stages over loaded pages and produces a BookDoc.

import {
  EXTRACTOR_VERSION,
  blockText,
  type Block,
  type BookDoc,
  type Chapter,
  type PageInfo,
  type Span,
  type TocEntry,
} from "../model.ts";
import { applyOutline, organizeOpening, settleChapters, type OutlineItem } from "../structure.ts";
import { bookTitle, cleanTitle, normalizeStructure, placeFigures, recoverContents } from "../normalize.ts";
import { BlockBuilder, colFor, type HeadingStyles, type Item } from "./blocks.ts";
import { detectLayout, dominantLayout, findFurniture, fitLayout, lineRect, readingOrder, splitAtGutter, type PageLayout } from "./layout.ts";
import { buildLines, fontStats, lineFromRuns, removeNoise, type FontStats, type Line } from "./lines.ts";
import type { RawPage } from "./load.ts";
import { findRegions, isBodyText, regionLines, type Region } from "./regions.ts";
import { CAPTION_RE, WordBook, countWords, xrefKey, XREF_RE } from "./text.ts";

export interface BookMeta {
  id: string;
  fileName: string;
  title?: string;
  author?: string;
  /** The PDF's own bookmarks, when it has them. */
  outline?: OutlineItem[];
}

export function analyzeBook(raw: RawPage[], meta: BookMeta, startedAt = Date.now()): BookDoc {
  const stats = fontStats(raw);
  const { pages, removed } = removeNoise(raw, stats);

  let lines = pages.map((p) => buildLines(p, stats));
  const detected = lines.map((ls, i) => detectLayout(ls, stats, pages[i].w));
  const fallback = dominantLayout(detected, pages[0]?.w ?? 600);
  const layouts: PageLayout[] = detected.map((l, i) => fitLayout(lines[i], l, fallback, stats));
  lines = lines.map((ls, i) => splitAtGutter(ls, layouts[i], (runs, from) => lineFromRuns(from.page, runs, stats)));

  const furniture = findFurniture(
    lines.map((ls, i) => ({ lines: ls, h: pages[i].h })),
    stats,
  );
  lines = lines.map((ls) => ls.filter((l) => !furniture.drop.has(l)));

  const regions: Region[][] = pages.map((p, i) =>
    findRegions({ index: i, w: p.w, h: p.h, lines: lines[i], graphics: p.graphics }, layouts[i], stats),
  );

  const book = new WordBook();
  for (const ls of lines)
    for (const l of ls) {
      const t = l.text.replace(/[A-Za-z]+-\s*$/, "");
      book.addText(t);
      book.addHyphenated(t);
    }

  const inRegions = new Set<Line>();
  regions.forEach((rs) => regionLines(rs).forEach((l) => inRegions.add(l)));
  const bodyPages = new Set<number>();
  lines.forEach((ls, i) => {
    if (ls.filter((l) => isBodyText(l, stats)).length >= 8) bodyPages.add(i);
  });
  const headings = headingStyles(
    lines.flat().filter((l) => !inRegions.has(l)),
    stats,
    bodyPages,
  );

  const builder = new BlockBuilder(stats, book, headings);
  pages.forEach((_, i) => {
    const layout = layouts[i];
    type P = { rect: ReturnType<typeof lineRect>; item: Item };
    const placed: P[] = [];
    for (const l of lines[i]) {
      if (inRegions.has(l)) continue;
      placed.push({ rect: lineRect(l), item: { kind: "line", line: l, col: colFor(l, layout) ?? layout.columns[0] } });
    }
    for (const r of regions[i]) placed.push({ rect: r.rect, item: { kind: "region", region: r } });
    for (const p of readingOrder(placed, layout)) builder.process(p.item);
  });
  let blocks = builder.finish();

  const pageInfos = pageLabels(
    pages.map((p) => ({ w: p.w, h: p.h })),
    furniture.labels,
  );
  blocks = dropStrayNumbers(blocks, pageInfos);
  blocks = recoverContents(blocks);
  chaptersFromContents(blocks, pageInfos);
  blocks = normalizeStructure(blocks);
  blocks = applyOutline(blocks, meta.outline);
  blocks = organizeOpening(blocks);
  settleChapters(blocks);
  linkReferences(blocks, pageInfos);
  blocks = placeFigures(blocks);
  const chapters = assignChapters(blocks);
  const toc = buildToc(blocks);

  let words = 0;
  for (const b of blocks) words += countWords(blockText(b));

  return {
    version: EXTRACTOR_VERSION,
    format: "pdf",
    id: meta.id,
    title: bookTitle(blocks, meta.title) || cleanTitle(guessTitle(blocks, meta.fileName))!,
    author: meta.author,
    fileName: meta.fileName,
    pageCount: pages.length,
    pages: pageInfos,
    blocks,
    toc,
    chapters,
    stats: {
      bodySize: stats.bodySize,
      bodyFont: stats.bodyFont,
      words,
      figures: blocks.filter((b) => b.kind === "figure").length,
      tables: blocks.filter((b) => b.kind === "table").length,
      boxes: blocks.filter((b) => b.kind === "box").length,
      noiseRuns: removed,
      ms: Date.now() - startedAt,
    },
  };
}

/**
 * Heading styles are font/size combinations that are bigger or bolder than
 * body text and are used for short standalone lines. Bigger styles get
 * higher (smaller-numbered) levels.
 */
function headingStyles(lines: Line[], stats: FontStats, bodyPages: Set<number>): HeadingStyles {
  const key = (l: Line) => `${l.font}|${(Math.round(l.size * 2) / 2).toFixed(1)}`;
  const isCandidate = (l: Line) => {
    const t = l.text.trim();
    if (t.length < 2 || t.length > 120) return false;
    if (/^\d+$/.test(t) || CAPTION_RE.test(t)) return false;
    if (/[.,;]$/.test(t) && t.length > 40) return false;
    if (/^[•·▪■◦●○‣⁃►▸✓✔\-–]/.test(t)) return false;
    if (l.size >= stats.bodySize * 1.12) return true;
    return l.bold && l.size >= stats.bodySize * 0.85 && !isBodyText(l, stats) && t.length < 90;
  };
  const groups = new Map<string, { size: number; n: number; onBody: number; len: number; bold: boolean; samples: string[] }>();
  for (const l of lines) {
    if (!isCandidate(l)) continue;
    const k = key(l);
    const g = groups.get(k) ?? { size: l.size, n: 0, onBody: 0, len: 0, bold: l.bold, samples: [] };
    g.n++;
    if (bodyPages.has(l.page)) g.onBody++;
    g.len += l.text.trim().length;
    if (g.samples.length < 4) g.samples.push(`p${l.page + 1}:${l.text.trim().slice(0, 30)}`);
    groups.set(k, g);
  }
  // Ignore styles that are mostly long lines: those are emphasised paragraphs.
  const styles = [...groups.entries()].filter(([, g]) => g.len / g.n <= 70 && (g.n >= 2 || g.size >= stats.bodySize * 1.5));
  if (typeof process !== "undefined" && process.env?.DEBUG_HEADINGS)
    console.error([...groups.entries()].map(([k, g]) => `${k} n=${g.n} body=${g.onBody} avgLen=${(g.len / g.n).toFixed(0)} ${g.samples.join(" | ")}`).join("\n"));
  // Chapter titles: the largest style that recurs. One-off bigger styles
  // (title pages) are treated as top level too.
  const recurring = styles.filter(([, g]) => g.n >= 3).sort((a, b) => b[1].size - a[1].size);
  const chapter = recurring.find(([, g]) => g.size >= stats.bodySize * 1.5);
  // Section levels come from styles used on pages with real body text, so
  // title-page and contents-page styles don't take up levels.
  const sectionStyles = styles
    .filter(([k, g]) => k !== chapter?.[0] && g.onBody >= 2 && (!chapter || g.size < chapter[1].size))
    .sort((a, b) => b[1].size - a[1].size);
  // The hierarchy is defined by frequent styles; rarer ones slot in by size.
  const maxOnBody = Math.max(0, ...sectionStyles.map(([, g]) => g.onBody));
  const primary = sectionStyles.filter(([, g]) => g.onBody >= Math.max(3, maxOnBody * 0.1));
  const sizes: number[] = [];
  for (const [, g] of primary) {
    const sz = Math.round(g.size * 2) / 2;
    if (!sizes.length || sizes[sizes.length - 1] - sz > 0.6) sizes.push(sz);
  }
  const allowed = new Map<string, 1 | 2 | 3 | 4>();
  const base = chapter ? 2 : 1;
  for (const [k, g] of sectionStyles) {
    const sz = Math.round(g.size * 2) / 2;
    let idx = sizes.findIndex((x) => sz >= x - 0.6);
    if (idx < 0) idx = sizes.length;
    allowed.set(k, Math.min(4, base + idx) as 1 | 2 | 3 | 4);
  }
  if (chapter) {
    allowed.set(chapter[0], 1);
    for (const [k, g] of styles) if (g.size > chapter[1].size && !allowed.has(k)) allowed.set(k, 1);
  }
  return {
    levelOf(l: Line) {
      if (!isCandidate(l)) return null;
      return allowed.get(key(l)) ?? null;
    },
  };
}

function pageLabels(pages: { w: number; h: number }[], found: Map<number, string>): PageInfo[] {
  // Fill pages without a printed number by following the numbering of their neighbours.
  const numeric = new Map<number, number>();
  for (const [i, s] of found) if (/^\d+$/.test(s)) numeric.set(i, Number(s));
  const offsets = new Map<number, number>();
  for (const [i, n] of numeric) offsets.set(n - i, (offsets.get(n - i) ?? 0) + 1);
  const offset = [...offsets.entries()].sort((a, b) => b[1] - a[1])[0];
  const firstNumbered = Math.min(...[...numeric.keys()].filter((i) => offset && numeric.get(i)! - i === offset[0]));
  // Front matter numbered in roman: fill its unnumbered pages the same way.
  const romanOffsets = new Map<number, number>();
  for (const [i, t] of found) {
    const n = romanValue(t);
    if (n !== null) romanOffsets.set(n - i, (romanOffsets.get(n - i) ?? 0) + 1);
  }
  const roman = [...romanOffsets.entries()].sort((a, b) => b[1] - a[1])[0];
  const arabicStart = offset ? firstNumbered : Infinity;
  return pages.map((p, i) => {
    let label = found.get(i);
    // (A chapter's opening page usually goes unnumbered: it takes the number before the first numbered page.)
    if (!label && offset && offset[1] >= 3 && (i >= firstNumbered || (i === firstNumbered - 1 && i + offset[0] >= 1))) label = String(i + offset[0]);
    if (!label && roman && roman[1] >= 2 && i < arabicStart && i + roman[0] >= 1) label = toRoman(i + roman[0]);
    return { w: p.w, h: p.h, label: label ?? String(i + 1) };
  });
}

function romanValue(t: string): number | null {
  if (!/^[ivxlc]+$/.test(t)) return null;
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let n = 0;
  for (let k = 0; k < t.length; k++) n += v[t[k]] < (v[t[k + 1]] ?? 0) ? -v[t[k]] : v[t[k]];
  return n;
}

function toRoman(n: number): string {
  const parts: [number, string][] = [[100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, r] of parts) while (n >= v) (out += r, (n -= v));
  return out;
}

export function assignChapters(blocks: Block[]): Chapter[] {
  const chapters: Chapter[] = [];
  let current: Chapter = { title: "Front matter", start: 0, end: 0, refs: {} };
  blocks.forEach((b, i) => {
    if (b.kind === "heading" && b.level === 1) {
      if (i > current.start || chapters.length) {
        current.end = i;
        chapters.push(current);
      }
      current = { title: b.text, number: b.number, start: i, end: i, refs: {} };
    }
    b.chapter = chapters.length;
    if (b.kind === "references") for (const r of b.items) if (r.n) current.refs[r.n] = r.text;
  });
  current.end = blocks.length;
  chapters.push(current);
  return chapters;
}

/**
 * A paragraph that is only a number is debris when it is the page's own
 * number (left on a page that is just a photo) or sits right beside a figure
 * or table on the same page (a label from inside the picture).
 */
export function dropStrayNumbers(blocks: Block[], pages: PageInfo[]): Block[] {
  const lone = (b: Block | undefined) => {
    if (b?.kind !== "paragraph") return null;
    const t = b.spans.map((s) => s.text).join("").trim();
    return /^(?:\d{1,4}|[ivxlc]{1,7})$/i.test(t) ? t : null;
  };
  const picture = (b: Block | undefined, page: number) => !!b && (b.kind === "figure" || b.kind === "table") && b.page === page;
  return blocks.filter((b, i) => {
    const t = lone(b);
    if (t === null) return true;
    if (pages[b.page]?.label?.toLowerCase() === t.toLowerCase()) return false;
    // Look past neighbouring numbers: a diagram can leave several ("1", "2", "2", "1").
    let k = i - 1;
    while (k >= 0 && lone(blocks[k]) !== null && blocks[k].page === b.page) k--;
    let j = i + 1;
    while (j < blocks.length && lone(blocks[j]) !== null && blocks[j].page === b.page) j++;
    return !(picture(blocks[k], b.page) || picture(blocks[j], b.page));
  });
}

/** Turns "Fig 1-1", "Table 2-3" and "pages 138–139" in paragraphs into links. */
export function linkReferences(blocks: Block[], pages: PageInfo[]): void {
  const keys = new Set<string>();
  for (const b of blocks) if ((b.kind === "figure" || b.kind === "table" || b.kind === "box") && b.key) keys.add(b.key);
  const labelToPage = new Map<string, number>();
  pages.forEach((p, i) => {
    if (!labelToPage.has(p.label)) labelToPage.set(p.label, i);
  });
  const link = (spans: Span[]): Span[] => {
    const out: Span[] = [];
    for (const s of spans) {
      if (s.cite || s.sup) {
        out.push(s);
        continue;
      }
      const re = new RegExp(`${XREF_RE.source}|\\b(pages?|pp?\\.)\\s+(\\d{1,4})(?:\\s*[-\\u2013]\\s*(\\d{1,4}))?`, "g");
      let last = 0;
      for (const m of s.text.matchAll(re)) {
        const at = m.index ?? 0;
        let piece: Span | null = null;
        if (m[1]) {
          // The whole figure ("Fig 1-32"); a figure keyed by its panel ("Fig 5a") when the book numbers them so.
          const whole = xrefKey(m[1], m[2]);
          const panel = m[3] && /^[a-z]$/i.test(m[3]) ? xrefKey(m[1], m[2] + m[3].toLowerCase()) : null;
          const key = keys.has(whole) ? whole : panel && keys.has(panel) ? panel : null;
          if (key) piece = { ...s, text: m[0], xref: key };
        } else if (m[5]) {
          const page = labelToPage.get(m[5]);
          if (page !== undefined) piece = { ...s, text: m[0], pageRef: page };
        }
        if (!piece) continue;
        if (at > last) out.push({ ...s, text: s.text.slice(last, at) });
        out.push(piece);
        last = at + m[0].length;
      }
      if (last < s.text.length) out.push(last === 0 ? s : { ...s, text: s.text.slice(last) });
    }
    return out;
  };
  for (const b of blocks) {
    if (b.kind === "paragraph") b.spans = link(b.spans);
    else if (b.kind === "list" || b.kind === "callout") b.items = b.items.map(link);
    else if (b.kind === "box") for (const inner of b.body) if (inner.kind === "paragraph") inner.spans = link(inner.spans);
  }
}

export function buildToc(blocks: Block[]): TocEntry[] {
  const toc: TocEntry[] = [];
  for (const b of blocks) {
    if (b.kind === "heading" && b.level <= 3) {
      toc.push({ id: `toc-${b.id}`, title: b.number ? `${b.number}. ${b.text}` : b.text, level: b.level, blockId: b.id, page: b.page });
    } else if ((b.kind === "references" || b.kind === "index") && b.title) {
      toc.push({ id: `toc-${b.id}`, title: b.title, level: 3, blockId: b.id, page: b.page });
    }
  }
  return toc;
}

function guessTitle(blocks: Block[], fileName: string): string {
  // The biggest heading on the title page, with its subtitle when there is one.
  const firstChapter = blocks.findIndex((b) => b.kind === "heading" && b.level === 1 && b.number);
  const front = blocks.slice(0, firstChapter < 0 ? 40 : firstChapter).filter((b) => b.page < 12);
  const h1 = front.findIndex((b) => b.kind === "heading" && b.level === 1);
  if (h1 >= 0) {
    const t = (front[h1] as { text: string }).text;
    const next = front[h1 + 1];
    const sub = next && next.kind === "heading" && next.level === 2 && next.page === front[h1].page ? next.text : "";
    if (t.length <= 80) return sub && `${t}: ${sub}`.length <= 110 ? `${t}: ${sub}` : t;
  }
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^[0-9a-f]{6,}[-_]/i, "")
    .replace(/[_]+/g, " ")
    .trim();
  return base || (blocks.find((b) => b.kind === "heading")?.kind === "heading" ? (blocks.find((b) => b.kind === "heading") as { text: string }).text : "Untitled");
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The book's own contents page says where each chapter starts. When the
 * printed styles didn't reveal the chapters, the heading at each numbered
 * entry's page becomes a chapter heading (level 1, with its number).
 */
export function chaptersFromContents(blocks: Block[], pages: PageInfo[]): void {
  const contents = blocks.find((b) => b.kind === "contents");
  if (!contents || contents.kind !== "contents") return;
  const numbered = contents.entries.filter((e) => e.num && /^\d+$/.test(e.num));
  if (numbered.length < 3) return;
  const existing = blocks.filter((b) => b.kind === "heading" && b.level === 1 && b.page > contents.page).length;
  // Styles already found most chapters: trust them.
  if (existing >= numbered.length * 0.6) return;
  const firstOnPage = new Map<number, number>();
  blocks.forEach((b, i) => {
    if (!firstOnPage.has(b.page)) firstOnPage.set(b.page, i);
  });
  let promoted = 0;
  for (const e of numbered) {
    const page = pages.findIndex((p, i) => i > contents.page && p.label === e.page);
    if (page < 0) continue;
    const start = firstOnPage.get(page);
    if (start === undefined) continue;
    const want = normTitle(e.title);
    // The heading on that page (or the next) whose text matches the entry, else its first heading.
    let pick = -1;
    for (let i = start; i < blocks.length && blocks[i].page <= page + 1; i++) {
      const b = blocks[i];
      if (b.kind !== "heading") continue;
      const t = normTitle(b.text);
      if (t && (t === want || want.startsWith(t) || t.startsWith(want))) {
        pick = i;
        break;
      }
      if (pick < 0 && b.page === page) pick = i;
    }
    if (pick < 0) continue;
    const h = blocks[pick];
    if (h.kind !== "heading") continue;
    h.level = 1;
    h.number ??= e.num;
    promoted++;
  }
  if (promoted < 3) return;
  // Other top-level headings inside chapters step down a level.
  const starts = new Set(blocks.filter((b) => b.kind === "heading" && b.level === 1 && b.number).map((b) => b.id));
  for (const b of blocks) if (b.kind === "heading" && b.level === 1 && !starts.has(b.id) && b.page > contents.page) b.level = 2;
}
