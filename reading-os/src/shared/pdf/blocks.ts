// Stage 4: reading-ordered lines and regions → book blocks. Rebuilds
// paragraphs across line, column and page breaks, and recognises headings,
// lists, reference lists, author callouts ("Key Points") and the index.

import {
  spansText,
  type Block,
  type BoxBlock,
  type CalloutBlock,
  type ContentsBlock,
  type ContentsEntry,
  type FigureBlock,
  type ListBlock,
  type ParagraphBlock,
  type Rect,
  type ReferenceEntry,
  type Span,
  type TableBlock,
} from "../model.ts";
import type { Column, PageLayout } from "./layout.ts";
import { lineRect, readingOrder, union } from "./layout.ts";
import type { FontStats, Line } from "./lines.ts";
import { pushSpan } from "./lines.ts";
import { MONO_FONT } from "./load.ts";
import type { Region } from "./regions.ts";
import { isBodyText } from "./regions.ts";
import { buildTable } from "./tables.ts";
import { joinLines, normalizeText, type WordBook } from "./text.ts";

export type Item = { kind: "line"; line: Line; col: Column } | { kind: "region"; region: Region };

export interface HeadingStyles {
  levelOf(l: Line): 1 | 2 | 3 | 4 | null;
}

const BULLET_RE = /^\s*([•·▪■◦●○‣⁃►▸✓✔]|[-–](?=\s)|\(?\d{1,2}[.)](?=\s)|\(?[a-z][.)](?=\s))\s*/;
const REF_START_RE = /^\s*(\d{1,3})\.\s+(?=\S)/;
const SENTENCE_END_RE = /[.!?:]["”’)\]]*$/;

type Mode = "normal" | "references" | "index" | "callout" | "contents";

const MODE_HEADINGS: [RegExp, Mode][] = [
  [/^(references|bibliography|literature cited|works cited|suggested readings?|further reading)$/i, "references"],
  [/^index$/i, "index"],
  [/^(key points|learning objectives|objectives|key messages|highlights|clinical pearls|summary points|key takeaways)$/i, "callout"],
  [/^(contents|table of contents)$/i, "contents"],
];

interface OpenPara {
  spans: Span[];
  last: Line;
  lastCol: Column;
  page: number;
  rect: Rect;
  small: boolean;
}

interface OpenList {
  ordered: boolean;
  items: Span[][];
  markerX: number;
  lastLine: Line;
  page: number;
  rect: Rect;
}

export class BlockBuilder {
  blocks: Block[] = [];
  private para: OpenPara | null = null;
  private list: OpenList | null = null;
  private heading: { lines: Line[]; level: 1 | 2 | 3 | 4 } | null = null;
  private pending: Region[] = [];
  private chapterNumber: string | undefined;
  /** The page the pending chapter number was printed on: it only names a title on that page or the next. */
  private chapterNumberPage = -1;
  private mode: Mode = "normal";
  private refs: { title: string; items: ReferenceEntry[]; page: number; rect: Rect } | null = null;
  private index: { title: string; lines: string[]; page: number; rect: Rect } | null = null;
  private callout: { title: string; items: Span[][]; page: number; rect: Rect; lastLine?: Line } | null = null;
  private contents: ContentsBlock | null = null;
  private code: { lines: Line[]; page: number; rect: Rect } | null = null;
  /** Pieces of one contents line set apart on the same baseline ("1.1" | "Title . . ." | "3"). */
  private row: { lines: Line[]; col: Column } | null = null;
  private tables = new Map<string, TableBlock | BoxBlock>();
  private nextId = 0;
  private perPage = new Map<number, number>();
  private stats: FontStats;
  private book: WordBook;
  private headings: HeadingStyles;

  private idPrefix: string | undefined;

  /** Without an idPrefix, ids are "p<page>-<n>": stable when other pages change. */
  constructor(stats: FontStats, book: WordBook, headings: HeadingStyles, idPrefix?: string) {
    this.stats = stats;
    this.book = book;
    this.headings = headings;
    this.idPrefix = idPrefix;
  }

  private id(page: number): string {
    if (this.idPrefix !== undefined) return `${this.idPrefix}${this.nextId++}`;
    const n = this.perPage.get(page) ?? 0;
    this.perPage.set(page, n + 1);
    return `p${page}-${n}`;
  }

  process(item: Item): void {
    if (item.kind === "region") this.onRegion(item.region);
    else this.onLine(item.line, item.col);
  }

  finish(): Block[] {
    return this.closeAll();
  }

  // ---------- regions ----------

  private onRegion(r: Region): void {
    if (this.heading) this.flushHeading();
    // A figure that interrupts a sentence is shown after the paragraph ends.
    if (this.para && !SENTENCE_END_RE.test(this.para.last.text.trim())) {
      this.pending.push(r);
      return;
    }
    this.flushText();
    this.emitRegion(r);
  }

  private emitRegion(r: Region): void {
    const caption = captionSpans(r.captionLines, this.book);
    if (r.type === "figure") {
      const fig: FigureBlock = {
        kind: "figure",
        id: this.id(r.page),
        page: r.page,
        rect: r.crop,
        chapter: 0,
        key: r.key,
        caption,
        labels: r.contentLines.map((l) => l.text.trim()).join(" · ") || undefined,
      };
      this.blocks.push(fig);
      return;
    }
    const existing = r.key ? this.tables.get(r.key) : undefined;
    if (r.type === "table") {
      const grid = buildTable(r.contentLines, this.book);
      if (existing && existing.kind === "table" && (r.cont || existing.parts.every((p) => p.page !== r.page))) {
        const extra = grid.rows.slice(sameHeader(existing.rows, grid.rows, existing.headerRows) ? existing.headerRows : 0);
        existing.rows.push(...extra);
        existing.notes.push(...grid.notes);
        existing.parts.push({ page: r.page, rect: r.rect });
        return;
      }
      const t: TableBlock = {
        kind: "table",
        id: this.id(r.page),
        page: r.page,
        rect: r.rect,
        chapter: 0,
        key: r.key ?? "Table",
        caption: stripLabel(caption),
        rows: grid.rows,
        headerRows: grid.headerRows,
        parts: [{ page: r.page, rect: r.rect }],
        notes: grid.notes,
      };
      this.blocks.push(t);
      if (r.key) this.tables.set(r.key, t);
      return;
    }
    // Box: its contents are ordinary paragraphs and lists.
    // Inner blocks get ids under a fresh prefix so continued boxes never collide.
    const inner = new BlockBuilder(this.stats, this.book, { levelOf: () => null }, `${this.id(r.page)}.`);
    const xs = r.contentLines.map((l) => l.x0);
    const col: Column = { x0: xs.length ? Math.min(...xs) : r.rect.x0, x1: r.rect.x1 };
    const ordered = readingOrder(
      r.contentLines.map((l) => ({ rect: lineRect(l), line: l })),
      localLayout(r.contentLines, r.rect),
    );
    for (const o of ordered) inner.process({ kind: "line", line: o.line, col: colFor(o.line, localLayout(r.contentLines, r.rect)) ?? col });
    const body = inner.finish().filter((b): b is ParagraphBlock | ListBlock => b.kind === "paragraph" || b.kind === "list");
    if (existing && existing.kind === "box") {
      existing.body.push(...body);
      existing.parts.push({ page: r.page, rect: r.rect });
      return;
    }
    const box: BoxBlock = {
      kind: "box",
      id: this.id(r.page),
      page: r.page,
      rect: r.rect,
      chapter: 0,
      key: r.key ?? "Box",
      title: stripLabel(caption),
      body,
      parts: [{ page: r.page, rect: r.rect }],
    };
    this.blocks.push(box);
    if (r.key) this.tables.set(r.key, box);
  }

  // ---------- lines ----------

  private onLine(l: Line, col: Column): void {
    const text = l.text.trim();
    if (!text) return;

    const r = this.row;
    if (r) {
      const first = r.lines[0];
      if (this.mode === "contents" && l.page === first.page && Math.abs(l.y - first.y) < first.size * 0.35) {
        r.lines.push(l);
        return;
      }
      this.row = null;
      this.onContentsLine(joinRow(r.lines), r.col);
    }

    // Program code keeps its lines and indentation.
    if (isCodeLine(l)) return this.onCodeLine(l);
    if (this.code) this.flushCode();

    // Big lone number above a chapter title.
    if (/^\d{1,3}$/.test(text) && l.size >= this.stats.bodySize * 2) {
      this.flushAll();
      this.chapterNumber = text;
      this.chapterNumberPage = l.page;
      return;
    }

    // "Key Points", "References" and similar are recognised by name even when
    // their style is only used on a few pages.
    const named = MODE_HEADINGS.some(([re]) => re.test(text)) && (l.bold || l.size > this.stats.bodySize * 1.05);
    const level = this.headings.levelOf(l) ?? (named ? 3 : null);
    if (level) {
      const h = this.heading;
      if (h && h.level === level && l.page === h.lines[0].page && l.top - h.lines[h.lines.length - 1].bottom < l.size * 0.9) {
        h.lines.push(l);
        return;
      }
      this.flushAll();
      this.heading = { lines: [l], level };
      return;
    }
    if (this.heading) this.flushHeading();

    switch (this.mode) {
      case "references":
        return this.onReferenceLine(l);
      case "index":
        // "Index 309" on a contents page is an entry pointing at the index, not the index.
        if (this.index && !this.index.lines.length && /^\d{1,4}$/.test(text)) {
          this.index = null;
          this.mode = "normal";
          return;
        }
        this.index?.lines.push(text);
        if (this.index) this.index.rect = union(this.index.rect, lineRect(l));
        return;
      case "callout":
        return this.onCalloutLine(l, col);
      case "contents":
        this.row = { lines: [l], col };
        return;
      default:
        return this.onBodyLine(l, col);
    }
  }

  private onContentsLine(l: Line, col: Column): void {
    const text = normalizeText(l.text).trim();
    let entry = parseContentsEntry(text);
    // Edited books list each chapter's authors under its title.
    const last = this.contents?.entries[this.contents.entries.length - 1];
    if (!entry && last && (l.italic || isAuthorList(text))) {
      last.authors = last.authors ? `${last.authors} ${text}` : text;
      if (l.page === this.contents!.page) this.contents!.rect = union(this.contents!.rect, lineRect(l));
      return;
    }
    // Prose on a contents page ("The glossary is available online…") reads as ordinary text.
    if (!entry) return this.onBodyLine(l, col);
    // A long title wraps: its first line arrived as text just above, without a page number.
    const p = this.para;
    if (p && !p.small && p.last.page === l.page && l.top - p.last.bottom < l.size * 1.2) {
      const head = spansText(p.spans).trim();
      if (head.length < 120 && !SENTENCE_END_RE.test(head)) {
        this.para = null;
        entry = parseContentsEntry(`${head} ${normalizeText(l.text).trim()}`) ?? entry;
      }
    }
    this.flushText();
    if (!this.contents) {
      // Added to the book right away so prose after the list stays after it.
      this.contents = { kind: "contents", id: this.id(l.page), page: l.page, rect: lineRect(l), chapter: 0, entries: [] };
      this.blocks.push(this.contents);
    }
    this.contents.entries.push(entry);
    if (l.page === this.contents.page) this.contents.rect = union(this.contents.rect, lineRect(l));
  }

  private onReferenceLine(l: Line): void {
    const r = this.refs;
    if (!r) return;
    const m = REF_START_RE.exec(l.text);
    if (m) r.items.push({ n: Number(m[1]), text: normalizeText(l.text.slice(m[0].length)).trim() });
    else if (r.items.length) {
      const last = r.items[r.items.length - 1];
      last.text = joinLines(last.text, l.text, this.book);
    } else r.items.push({ n: 0, text: l.text.trim() });
    r.rect = union(r.rect, lineRect(l));
  }

  private onCalloutLine(l: Line, col: Column): void {
    const c = this.callout;
    if (!c) return;
    const m = BULLET_RE.exec(l.text);
    const prev = c.lastLine;
    if (!m && prev && (l.page !== prev.page || l.top - prev.bottom > l.size * 1.2)) {
      // Body text resumed after the callout.
      this.closeMode();
      this.onBodyLine(l, col);
      return;
    }
    if (m || !c.items.length) {
      c.items.push(m ? stripLeading(l.spans, m[0].length) : [...l.spans]);
    } else {
      const last = c.items[c.items.length - 1];
      appendSpans(last, l.spans, this.book);
    }
    c.lastLine = l;
    c.rect = union(c.rect, lineRect(l));
  }

  private footnotes: ParagraphBlock[] = [];

  private onBodyLine(l: Line, col: Column): void {
    const bullet = BULLET_RE.exec(l.text);
    const small = l.size < this.stats.bodySize * 0.9;

    // Footnotes at the foot of a page interrupt a running paragraph; set them
    // aside and show them after the paragraph instead of splitting it.
    const p0 = this.para;
    if (small && p0 && !p0.small && !SENTENCE_END_RE.test(p0.last.text.trim()) && l.top > p0.last.bottom && l.page === p0.last.page) {
      const last = this.footnotes[this.footnotes.length - 1];
      if (last && last.page === l.page && !/^[*†‡§¶]/.test(l.text.trim())) appendSpans(last.spans, l.spans, this.book);
      else this.footnotes.push({ kind: "paragraph", id: this.id(l.page), page: l.page, rect: lineRect(l), chapter: 0, spans: [...l.spans], small: true });
      return;
    }

    // Lists: a marker starts an item; indented lines continue it.
    // "2." at the start of a line is a list item, unless it is the middle of a
    // running sentence ("…shown in Fig\n2. …"): previous line full and unfinished.
    const midSentence =
      !!this.para &&
      /^\(?\d/.test(bullet?.[1] ?? "") &&
      !SENTENCE_END_RE.test(this.para.last.text.trim()) &&
      this.para.lastCol.x1 - this.para.last.x1 < this.para.last.size * 2;
    if (bullet && !midSentence) {
      this.flushPara();
      const ordered = /\d|[a-z]/.test(bullet[1]);
      if (!this.list || this.list.ordered !== ordered) {
        this.flushList();
        this.list = { ordered, items: [], markerX: l.x0, lastLine: l, page: l.page, rect: lineRect(l) };
      }
      this.list.items.push(stripLeading(l.spans, bullet[0].length));
      this.list.lastLine = l;
      this.list.rect = union(this.list.rect, lineRect(l));
      return;
    }
    if (this.list) {
      const prev = this.list.lastLine;
      const continues = l.x0 > this.list.markerX + l.size * 0.5 && Math.abs(l.size - prev.size) < 0.5 && l.top - prev.bottom < l.size * 0.9;
      if (continues || (l.page !== prev.page && !/^[A-Z]/.test(l.text.trim()))) {
        appendSpans(this.list.items[this.list.items.length - 1], l.spans, this.book);
        this.list.lastLine = l;
        this.list.rect = union(this.list.rect, lineRect(l));
        return;
      }
      this.flushList();
    }

    const p = this.para;
    if (p && !this.startsParagraph(p.last, p.lastCol, l, col)) {
      appendSpans(p.spans, l.spans, this.book);
      p.last = l;
      p.lastCol = col;
      if (l.page === p.page) p.rect = union(p.rect, lineRect(l));
      return;
    }
    this.flushPara();
    this.para = { spans: [...l.spans.map((s) => ({ ...s }))], last: l, lastCol: col, page: l.page, rect: lineRect(l), small };
  }

  private startsParagraph(prev: Line, prevCol: Column, cur: Line, curCol: Column): boolean {
    const size = cur.size;
    if (Math.abs(cur.size - prev.size) > prev.size * 0.1) return true;
    if (isBodyText(prev, this.stats) !== isBodyText(cur, this.stats) && !prev.italic && !cur.italic) return true;
    const width = curCol.x1 - curCol.x0;
    const indent = cur.x0 - curCol.x0;
    const indented = !cur.besideDropCap && indent > size * 0.6 && indent < width * 0.4;
    const shortBy = prevCol.x1 - prev.x1;
    const ended = SENTENCE_END_RE.test(prev.text.trim());
    // A line starting in lowercase finishes the sentence above it, even where
    // the page's column layout is unclear (notes set beside a QR code or image).
    if (
      !ended &&
      /^\p{Ll}/u.test(cur.text.trim()) &&
      !TERM_DEFINITION.test(cur.text.trim()) &&
      prev.page === cur.page &&
      cur.top >= prev.top &&
      cur.top - prev.bottom < size * 1.2 &&
      Math.abs(cur.x0 - prev.x0) < size * 3
    )
      return false;
    const sameFlow = prev.page === cur.page && prevCol.x0 === curCol.x0 && cur.top >= prev.top;
    if (sameFlow) {
      if (cur.top - prev.bottom > size * 0.75) return true;
      if (indented) return true;
      // "Short" is relative to the lines around it, so text wrapping beside a
      // figure (a narrower measure) is not mistaken for paragraph ends.
      const localRight = Math.min(prevCol.x1, Math.max(cur.x1, prev.x1));
      const shortLocal = localRight - prev.x1;
      if (shortLocal > Math.max(size * 4, width * 0.2)) return true;
      return ended && shortBy > size * 1.2 && (shortLocal > size * 1.2 || cur.x1 - prev.x1 > size);
    }
    // A column or page break: keep going unless the previous paragraph clearly ended.
    if (!ended) return false;
    return indented || shortBy > size * 1.2;
  }

  // ---------- flushing ----------

  private flushPara(): void {
    const p = this.para;
    if (!p) return;
    this.para = null;
    const spans = trimSpans(p.spans);
    if (spans.length)
      this.blocks.push({ kind: "paragraph", id: this.id(p.page), page: p.page, rect: p.rect, chapter: 0, spans, small: p.small || undefined });
    this.blocks.push(...this.footnotes);
    this.footnotes = [];
    const pending = this.pending;
    this.pending = [];
    for (const r of pending) this.emitRegion(r);
  }

  private flushList(): void {
    const l = this.list;
    if (!l) return;
    this.list = null;
    this.blocks.push({ kind: "list", id: this.id(l.page), page: l.page, rect: l.rect, chapter: 0, ordered: l.ordered, items: l.items.map(trimSpans) });
  }

  private onCodeLine(l: Line): void {
    const c = this.code;
    const last = c?.lines[c.lines.length - 1];
    const continues = c && last && ((l.page === last.page && l.top - last.bottom < l.size * 1.8) || l.page === last.page + 1);
    if (!continues) {
      this.flushText();
      this.flushHeading();
      this.code = { lines: [l], page: l.page, rect: lineRect(l) };
      return;
    }
    c!.lines.push(l);
    if (l.page === c!.page) c!.rect = union(c!.rect, lineRect(l));
  }

  private flushCode(): void {
    const c = this.code;
    if (!c) return;
    this.code = null;
    // Rows by baseline; columns from x positions (monospace: ~0.6em per character).
    const rows: Line[][] = [];
    for (const l of c.lines) {
      const row = rows.find((r) => r[0].page === l.page && Math.abs(r[0].y - l.y) < l.size * 0.3);
      if (row) row.push(l);
      else rows.push([l]);
    }
    const left = Math.min(...c.lines.map((l) => l.x0));
    const lines = rows.map((r) => {
      const parts = r.sort((a, b) => a.x0 - b.x0);
      const cw = parts[0].size * 0.6;
      let out = " ".repeat(Math.max(0, Math.round((parts[0].x0 - left) / cw)));
      let x = parts[0].x0;
      for (const p of parts) {
        if (out.trim()) out += " ".repeat(Math.max(1, Math.round((p.x0 - x) / cw)));
        out += p.text.replace(/\s+$/, "");
        x = p.x1;
      }
      return out;
    });
    this.blocks.push({ kind: "code", id: this.id(c.page), page: c.page, rect: c.rect, chapter: 0, lines });
  }

  private flushText(): void {
    this.flushCode();
    this.flushPara();
    this.flushList();
    const pending = this.pending;
    this.pending = [];
    for (const r of pending) this.emitRegion(r);
  }

  private flushHeading(): void {
    const h = this.heading;
    if (!h) return;
    this.heading = null;
    const text = h.lines
      .map((l) => normalizeText(l.text).trim())
      .reduce((a, b) => (a ? joinLines(a, b, this.book) : b), "");
    const first = h.lines[0];
    const rect = h.lines.map(lineRect).reduce(union);
    if (text.length > 160) {
      // Too long to be a heading (title-page blurbs, contributor lists).
      this.blocks.push({ kind: "paragraph", id: this.id(first.page), page: first.page, rect, chapter: 0, spans: [{ text, b: true }] });
      return;
    }
    const mode = MODE_HEADINGS.find(([re]) => re.test(text))?.[1] ?? "normal";
    this.closeMode();
    this.mode = mode;
    if (mode === "callout") {
      this.callout = { title: text, items: [], page: first.page, rect };
      return;
    }
    if (mode === "references") this.refs = { title: text, items: [], page: first.page, rect };
    if (mode === "index") this.index = { title: text, lines: [], page: first.page, rect };
    if (mode === "references" || mode === "index") return;
    this.blocks.push({
      kind: "heading",
      id: this.id(first.page),
      page: first.page,
      rect,
      chapter: 0,
      level: h.level,
      text,
      // The number belongs to a title on its own page, or to one opening the next page.
      number: h.level === 1 && (first.page === this.chapterNumberPage || (first.page === this.chapterNumberPage + 1 && !this.perPage.has(first.page))) ? this.chapterNumber : undefined,
    });
    if (h.level === 1) this.chapterNumber = undefined;
  }

  private closeMode(): void {
    if (this.refs) {
      const r = this.refs;
      this.blocks.push({ kind: "references", id: this.id(r.page), page: r.page, rect: r.rect, chapter: 0, title: r.title, items: r.items });
      this.refs = null;
    }
    if (this.index) {
      const x = this.index;
      // An index is terms and page numbers. Prose that ended up here is text, and stays readable.
      const withNumbers = x.lines.filter((t) => /\d/.test(t)).length;
      const avg = x.lines.reduce((a, t) => a + t.length, 0) / Math.max(1, x.lines.length);
      if (x.lines.length >= 4 && withNumbers < x.lines.length * 0.3 && avg > 18) {
        const text = x.lines.reduce((a, t) => (/\p{L}-$/u.test(a) ? a.slice(0, -1) + t : a ? `${a} ${t}` : t), "");
        this.blocks.push({ kind: "paragraph", id: this.id(x.page), page: x.page, rect: x.rect, chapter: 0, spans: [{ text }] });
      } else this.blocks.push({ kind: "index", id: this.id(x.page), page: x.page, rect: x.rect, chapter: 0, title: x.title, lines: x.lines });
      this.index = null;
    }
    this.contents = null;
    if (this.callout) {
      const c = this.callout;
      const block: CalloutBlock = { kind: "callout", id: this.id(c.page), page: c.page, rect: c.rect, chapter: 0, title: c.title, items: c.items.map(trimSpans) };
      this.blocks.push(block);
      this.callout = null;
    }
    this.mode = "normal";
  }

  private flushAll(): void {
    if (this.row) {
      const r = this.row;
      this.row = null;
      this.onContentsLine(joinRow(r.lines), r.col);
    }
    this.flushText();
    this.flushHeading();
    // A pending chapter number is kept until its title arrives.
  }

  /** Called at the very end. */
  closeAll(): Block[] {
    this.flushAll();
    this.closeMode();
    pullEntriesBeforeHeading(this.blocks);
    continueContents(this.blocks);
    return this.blocks;
  }
}

// ---------- helpers ----------

const ENTRY_RE = /^(.*?[^\s.·…!_⋯])(?:\s*(?:[.·…!_⋯•]\s*){2,}|\s+)(\d{1,4}|[ivxlcdm]{1,7})$/;

/**
 * One line of a book's contents page: "2 General Assessment 36", "Preface vi",
 * with dot leaders or spacer glyphs ("Pain!!1") between title and page.
 */
export function parseContentsEntry(text: string): ContentsEntry | null {
  // "Cysts of the Oral Regions ........ 159 Rawal Y, Bailoor DN": with dot
  // leaders, the page number can be followed by the chapter's authors.
  const lead = LEADER_AUTHORS_RE.exec(text);
  if (lead && isAuthorList(lead[3])) {
    const e = parseContentsEntry(`${lead[1]} ${lead[2]}`);
    return e && { ...e, authors: lead[3] };
  }
  const m = ENTRY_RE.exec(text);
  if (!m) return null;
  let title = m[1].trim();
  // Titles start with a capital or a chapter number; prose lines don't.
  if (!/^[\p{Lu}\d]/u.test(title)) return null;
  const num = /^(\d{1,3}(?:\.\d{1,3}){0,3})\.?\s+(?=\S)/.exec(title);
  if (num) title = title.slice(num[0].length);
  if (!/\p{L}/u.test(title)) return null;
  return { num: num?.[1], title, page: m[2] };
}

/** A glossary-style entry, "term: definition", starts its own paragraph. */
export const TERM_DEFINITION = /^\p{Ll}[\p{L}\p{N} '’-]{0,40}:\s/u;

/** One line from pieces on the same baseline, in reading order. */
function joinRow(lines: Line[]): Line {
  if (lines.length === 1) return lines[0];
  const parts = [...lines].sort((a, b) => a.x0 - b.x0);
  const spans: Span[] = [];
  parts.forEach((p, i) => {
    if (i) spans.push({ text: " " });
    spans.push(...p.spans);
  });
  return { ...parts[0], x1: Math.max(...parts.map((p) => p.x1)), runs: parts.flatMap((p) => p.runs), spans, text: parts.map((p) => p.text.trim()).join(" ") };
}

/** Lines set in a typewriter (monospace) font: program code, terminal sessions. */

export function isCodeLine(l: Line): boolean {
  return MONO_FONT.test(l.font.replace(/^[A-Z]{6}\+/, ""));
}

const LEADER_AUTHORS_RE = /^(.*?[^\s.])\s*(?:[.·…]\s*){3,}(\d{1,4}|[ivxlcdm]{1,7})\s+(\S.*)$/;

/** "Bailoor DN, Nagesh KS", "Rawal Y, Bailoor DN", "Mark Greenwood and Ian Corbett". */
export function isAuthorList(text: string): boolean {
  const parts = text.replace(/\s+and\s+/g, ", ").split(/\s*[,;]\s*/).filter(Boolean);
  if (!parts.length || parts.length > 12) return false;
  const name = /^(?:Dr\.?\s+)?[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}$/u;
  if (!parts.every((p) => name.test(p))) return false;
  // Each name has a surname with initials ("Bailoor DN") or a first and last name.
  if (!parts.every((p) => /\s/.test(p))) return false;
  const initials = (p: string) => /\s[\p{Lu}]{1,3}\.?$/u.test(p);
  return parts.some(initials) || parts.length >= 2;
}

/**
 * Contents that run onto the next page often lose their mode at that page's
 * running header ("xiv Fundamentals of…"), and the rest comes out as a list.
 * Entries that follow a contents block on the next pages join it.
 */
function continueContents(blocks: Block[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const c = blocks[i];
    if (c.kind !== "contents") continue;
    let j = i + 1;
    let lastPage = c.page;
    const absorbed: ContentsEntry[] = [];
    while (j < blocks.length && blocks[j].page <= lastPage + 1) {
      const b = blocks[j];
      const onNewPage = b.page > lastPage;
      if (b.kind === "heading" && onNewPage && b.text.length < 90 && /^[ivxlcdm]{1,7}\b|\b[ivxlcdm]{1,7}$/i.test(b.text)) {
        j++; // a running header with a roman page number
        continue;
      }
      const lines = b.kind === "list" ? b.items.map(spansText) : b.kind === "paragraph" ? [spansText(b.spans)] : null;
      if (!lines) break;
      const parsed = lines.map((t) => parseContentsEntry(t.trim()));
      if (parsed.some((e) => !e)) {
        // An author line under the last entry.
        if (b.kind === "paragraph" && (absorbed.length || c.entries.length) && isAuthorList(lines[0].trim())) {
          const last = absorbed[absorbed.length - 1] ?? c.entries[c.entries.length - 1];
          last.authors = last.authors ? `${last.authors} ${lines[0].trim()}` : lines[0].trim();
          j++;
          continue;
        }
        break;
      }
      absorbed.push(...(parsed as ContentsEntry[]));
      lastPage = b.page;
      j++;
    }
    if (!absorbed.length) continue;
    c.entries.push(...absorbed);
    blocks.splice(i + 1, j - i - 1);
  }
}

/**
 * Entries printed beside the "Contents" title can be read before it ("Preface vi"
 * set level with a big right-aligned title); move them into the list.
 */
function pullEntriesBeforeHeading(blocks: Block[]): void {
  for (let i = 2; i < blocks.length; i++) {
    const c = blocks[i];
    if (c.kind !== "contents" || blocks[i - 1].kind !== "heading") continue;
    const moved: ContentsEntry[] = [];
    let j = i - 2;
    for (; j >= 0; j--) {
      const b = blocks[j];
      if (b.kind !== "paragraph" || b.page !== c.page) break;
      const e = parseContentsEntry(spansText(b.spans).trim());
      if (!e) break;
      moved.unshift(e);
    }
    if (!moved.length) continue;
    c.entries.unshift(...moved);
    blocks.splice(j + 1, moved.length);
    i -= moved.length;
  }
}

function localLayout(lines: Line[], rect: Rect): PageLayout {
  const mid = (rect.x0 + rect.x1) / 2;
  const L = lines.filter((l) => l.x1 < mid + 2).length;
  const R = lines.filter((l) => l.x0 > mid - 2).length;
  const S = lines.length - L - R;
  if (L >= 3 && R >= 3 && S <= 0.35 * (L + R)) {
    return { columns: [{ x0: rect.x0, x1: mid }, { x0: mid, x1: rect.x1 }], gutter: mid };
  }
  return { columns: [{ x0: Math.min(...lines.map((l) => l.x0), rect.x1), x1: rect.x1 }] };
}

export function colFor(l: Line, layout: PageLayout): Column | undefined {
  if (layout.gutter === undefined) return layout.columns[0];
  if (l.x1 <= layout.gutter + 3) return layout.columns[0];
  if (l.x0 >= layout.gutter - 3) return layout.columns[1];
  return { x0: layout.columns[0].x0, x1: layout.columns[1].x1 };
}

function captionSpans(lines: Line[], book: WordBook): Span[] {
  const out: Span[] = [];
  for (const l of lines) appendSpans(out, l.spans, book);
  return trimSpans(out);
}

/** Removes the "Table 1-2" label from a caption (it is shown separately). */
function stripLabel(spans: Span[]): Span[] {
  const text = spans.map((s) => s.text).join("");
  const m = /^\s*(Fig(?:ure)?\.?|Table|Box)\s*\S+\s*(\(cont(?:inued|'d|\.)?\))?\s*/i.exec(text);
  return m ? stripLeading(spans, m[0].length) : spans;
}

function stripLeading(spans: Span[], n: number): Span[] {
  const out: Span[] = [];
  let skip = n;
  for (const s of spans) {
    if (skip >= s.text.length) {
      skip -= s.text.length;
      continue;
    }
    out.push({ ...s, text: s.text.slice(skip) });
    skip = 0;
  }
  return trimSpans(out);
}

function trimSpans(spans: Span[]): Span[] {
  const out = spans.filter((s) => s.text.length > 0).map((s) => ({ ...s }));
  while (out.length && !out[0].text.trim()) out.shift();
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out;
}

/** Appends a new line's spans, repairing the line break (hyphens, spaces). */
export function appendSpans(acc: Span[], next: Span[], book: WordBook): void {
  const incoming = next.map((s) => ({ ...s }));
  if (!incoming.length) return;
  if (!acc.length) {
    for (const s of incoming) pushSpan(acc, s);
    return;
  }
  const last = acc[acc.length - 1];
  const first = incoming[0];
  const prevText = last.text;
  const head = first.text.replace(/^\s+/, "");
  const joined = joinLines(prevText, head, book);
  // joinLines either removed a trailing hyphen, kept it, or added a space.
  const cutPrev = prevText.replace(/\s+$/, "");
  const special = !!(last.cite || last.sup || last.xref || last.pageRef !== undefined);
  if (joined === cutPrev.slice(0, -1) + head) last.text = cutPrev.slice(0, -1);
  else if (joined === cutPrev + head) last.text = cutPrev;
  else if (special) {
    last.text = cutPrev;
    pushSpan(acc, { text: " " });
  } else last.text = `${cutPrev} `;
  first.text = head;
  for (const s of incoming) pushSpan(acc, s);
}

function sameHeader(rows: string[][], next: string[][], headerRows: number): boolean {
  if (!headerRows || next.length < headerRows) return false;
  const norm = (r: string[]) => r.join("|").toLowerCase().replace(/\s+/g, " ");
  return norm(rows[0]) === norm(next[0]);
}
