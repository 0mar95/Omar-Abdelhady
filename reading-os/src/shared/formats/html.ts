// HTML → book blocks. EPUB chapters, Word documents (via mammoth), web pages
// and Markdown (via marked) all arrive as HTML, so this one converter gives
// every format the same paragraphs, headings, lists, figures and tables the
// PDF extractor produces — and with them search, the glossary, margin notes
// and the AI helpers.

import type { Block, BoxBlock, FigureBlock, ListBlock, ParagraphBlock, Rect, Span, TableBlock } from "../model.ts";
import { spansText } from "../model.ts";
import { CAPTION_RE, xrefKey } from "../pdf/text.ts";

const NO_RECT: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

const INLINE = new Set([
  "a", "abbr", "acronym", "b", "bdi", "bdo", "big", "cite", "code", "data", "del", "dfn", "em", "font", "i", "ins", "kbd",
  "label", "mark", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp", "small", "span", "strike", "strong", "sub", "sup",
  "time", "tt", "u", "var", "wbr", "br",
]);
const SKIP = new Set(["script", "style", "head", "title", "meta", "link", "noscript", "template", "nav", "button", "input", "select", "textarea", "iframe", "object", "video", "audio", "math"]);
const FOOTNOTE_TYPES = /\b(footnote|endnote|rearnote|note)\b/;

export interface HtmlSource {
  /** Index of the document (EPUB spine item) these blocks come from. */
  page: number;
  /** Image src attribute → a reference the reader can load (archive path or URL). */
  resolveImage(src: string): string | undefined;
}

interface Style {
  i?: boolean;
  b?: boolean;
  sup?: boolean;
  sub?: boolean;
}

const tag = (n: Element) => (n.localName || n.nodeName).toLowerCase().replace(/^.*:/, "");
const attr = (n: Element, name: string) => n.getAttribute(name) ?? n.getAttribute(`epub:${name}`) ?? undefined;

/** Collapses HTML whitespace into single spaces. */
const squash = (s: string) => s.replace(/[\s ]+/g, " ");

function pushSpan(out: Span[], s: Span): void {
  if (!s.text) return;
  const last = out[out.length - 1];
  if (last && !!last.i === !!s.i && !!last.b === !!s.b && !!last.sup === !!s.sup && !!last.sub === !!s.sub) {
    last.text += s.text;
    return;
  }
  out.push({ ...s });
}

/** Trims outer whitespace and drops empty spans. */
function trimSpans(spans: Span[]): Span[] {
  const out = spans.map((s) => ({ ...s }));
  while (out.length && !out[0].text.trim()) out.shift();
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  for (const s of out) s.text = s.text.replace(/ {2,}/g, " ");
  // Inner runs of spaces across span boundaries.
  for (let i = 1; i < out.length; i++) if (/\s$/.test(out[i - 1].text)) out[i].text = out[i].text.replace(/^\s+/, "");
  return out.filter((s) => s.text);
}

function clean(s: Span): Span {
  const out: Span = { text: s.text };
  if (s.i) out.i = true;
  if (s.b) out.b = true;
  if (s.sup) out.sup = true;
  if (s.sub) out.sub = true;
  return out;
}

export class HtmlConverter {
  blocks: Block[] = [];
  /** Element id (for links like chapter.xhtml#sec2) → the block that starts there. */
  anchors = new Map<string, string>();
  private perPage = new Map<number, number>();
  private inline: Span[] = [];
  private pendingAnchors: string[] = [];
  private src: HtmlSource = { page: 0, resolveImage: () => undefined };
  private docKey = "";

  private id(page: number): string {
    const n = this.perPage.get(page) ?? 0;
    this.perPage.set(page, n + 1);
    return `p${page}-${n}`;
  }

  /** Converts one document's body. `docKey` names it for anchors ("OEBPS/ch1.xhtml"). */
  convert(body: Element, src: HtmlSource, docKey = ""): void {
    this.src = src;
    this.docKey = docKey;
    this.pendingAnchors.push(docKey);
    this.walk(body);
    this.flushInline();
    // Anchors at the very end point at the next document's first block.
  }

  private push(b: Block): void {
    for (const a of this.pendingAnchors) if (!this.anchors.has(a)) this.anchors.set(a, b.id);
    this.pendingAnchors = [];
    this.blocks.push(b);
  }

  private note(el: Element): void {
    const id = el.getAttribute("id");
    if (id) this.pendingAnchors.push(`${this.docKey}#${id}`);
  }

  private flushInline(): void {
    const spans = trimSpans(this.inline);
    this.inline = [];
    if (spans.length) this.paragraph(spans);
  }

  private paragraph(spans: Span[], small = false): void {
    const t = spansText(spans).trim();
    if (!t) return;
    // A caption set as its own paragraph right after an image belongs to it.
    const last = this.blocks[this.blocks.length - 1];
    if (last?.kind === "figure" && !last.caption.length && CAPTION_RE.test(t)) {
      last.caption = spans;
      last.key = keyOf(t);
      return;
    }
    const p: ParagraphBlock = { kind: "paragraph", id: this.id(this.src.page), page: this.src.page, rect: NO_RECT, chapter: 0, spans };
    if (small) p.small = true;
    this.push(p);
  }

  private walk(el: Element): void {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        const t = squash(node.textContent ?? "");
        if (t.trim() || this.inline.length) pushSpan(this.inline, { text: t });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      const t = tag(child);
      if (SKIP.has(t)) continue;
      if (INLINE.has(t) && !hasBlockChild(child)) {
        this.note(child);
        this.spansOf(child, {}, this.inline);
        continue;
      }
      if (t === "img" || t === "svg" || t === "image") {
        // A small inline image inside text (an icon, a symbol) stays out of the way.
        if (this.inline.some((s) => s.text.trim()) && isSmall(child)) continue;
        this.flushInline();
        this.note(child);
        this.figure(child, null);
        continue;
      }
      this.flushInline();
      this.note(child);
      this.block(child, t);
    }
  }

  private block(el: Element, t: string): void {
    const page = this.src.page;
    if (/^h[1-6]$/.test(t)) {
      const text = squash(el.textContent ?? "").trim();
      if (text) this.push({ kind: "heading", id: this.id(page), page, rect: NO_RECT, chapter: 0, level: Number(t[1]) as 1, text });
      else this.walk(el); // headings that only hold an image
      return;
    }
    if (t === "p" || t === "pre" || t === "dt" || t === "dd" || t === "address" || t === "summary") {
      if (hasBlockChild(el)) return this.walk(el);
      const img = onlyImage(el);
      if (img) return this.figure(img, null);
      const spans = trimSpans(this.spansOf(el, t === "dt" ? { b: true } : {}));
      this.paragraph(spans, isSmallText(el));
      return;
    }
    if (t === "ul" || t === "ol") return this.list(el, t === "ol");
    if (t === "figure") {
      const img = firstImage(el);
      const cap = Array.from(el.getElementsByTagName("figcaption"))[0];
      if (img) this.figure(img, cap ?? null);
      else this.walk(el); // e.g. a figure holding a table or a quote
      return;
    }
    if (t === "table") return this.table(el);
    if (t === "aside" || /\b(sidebar|box|callout|feature)\b/i.test(el.getAttribute("class") ?? "")) {
      const type = `${attr(el, "type") ?? ""} ${el.getAttribute("role") ?? ""} ${el.getAttribute("class") ?? ""}`;
      if (FOOTNOTE_TYPES.test(type)) return this.footnotes(el);
      if (t === "aside") return this.box(el);
    }
    if (t === "hr" || t === "br") return;
    this.walk(el);
  }

  private spansOf(el: Element, style: Style, out: Span[] = []): Span[] {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        pushSpan(out, { ...style, text: squash(node.textContent ?? "") });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const c = node as Element;
      const t = tag(c);
      if (SKIP.has(t) || t === "img" || t === "svg") continue;
      if (t === "br") {
        pushSpan(out, { ...style, text: " " });
        continue;
      }
      const s: Style = { ...style };
      if (t === "em" || t === "i" || t === "cite" || t === "dfn" || t === "var") s.i = !style.i;
      if (t === "strong" || t === "b") s.b = true;
      if (t === "sup") s.sup = true;
      if (t === "sub") s.sub = true;
      const css = (c.getAttribute("style") ?? "").toLowerCase();
      if (/font-style:\s*italic/.test(css)) s.i = true;
      if (/font-weight:\s*(bold|[6-9]00)/.test(css)) s.b = true;
      // Note references ("¹" linking to a footnote) read as plain superscripts.
      this.spansOf(c, s, out);
    }
    return out;
  }

  private list(el: Element, ordered: boolean): void {
    const items: Span[][] = [];
    const collect = (list: Element) => {
      for (const li of Array.from(list.children)) {
        if (tag(li) !== "li") continue;
        this.note(li);
        const own: Span[] = [];
        const nested: Element[] = [];
        for (const n of Array.from(li.childNodes)) {
          if (n.nodeType === 1 && /^(ul|ol)$/.test(tag(n as Element))) nested.push(n as Element);
          else if (n.nodeType === 1) this.spansOf(n as Element, styleOf(n as Element), own);
          else if (n.nodeType === 3) pushSpan(own, { text: squash(n.textContent ?? "") });
        }
        const spans = trimSpans(own);
        if (spans.length) items.push(spans);
        for (const l of nested) collect(l);
      }
    };
    collect(el);
    if (!items.length) return;
    const page = this.src.page;
    const b: ListBlock = { kind: "list", id: this.id(page), page, rect: NO_RECT, chapter: 0, ordered, items };
    this.push(b);
  }

  private figure(img: Element, cap: Element | null): void {
    const t = tag(img);
    const raw =
      t === "img" ? img.getAttribute("src") : t === "image" ? (img.getAttribute("xlink:href") ?? img.getAttribute("href")) : firstSvgImage(img);
    const image = raw ? this.src.resolveImage(raw) : undefined;
    if (!image) return;
    const caption = cap ? trimSpans(this.spansOf(cap, {})) : [];
    const capText = spansText(caption).trim();
    const w = Number(img.getAttribute("width")) || 0;
    const h = Number(img.getAttribute("height")) || 0;
    const page = this.src.page;
    const fig: FigureBlock = {
      kind: "figure",
      id: this.id(page),
      page,
      rect: { x0: 0, y0: 0, x1: w, y1: h },
      chapter: 0,
      caption,
      image,
    };
    const key = keyOf(capText);
    if (key) fig.key = key;
    const alt = squash(img.getAttribute("alt") ?? "").trim();
    if (alt && alt.toLowerCase() !== capText.toLowerCase() && !/^(image|figure|img|cover)$/i.test(alt)) fig.labels = alt;
    this.push(fig);
  }

  private table(el: Element): void {
    const rows: string[][] = [];
    let headerRows = 0;
    let inHeader = true;
    for (const tr of Array.from(el.getElementsByTagName("tr"))) {
      // Rows of tables nested inside this one belong to those tables.
      if (closest(tr, "table") !== el) continue;
      const cells = Array.from(tr.children).filter((c) => /^(td|th)$/.test(tag(c)));
      if (!cells.length) continue;
      const row = cells.map((c) => squash(c.textContent ?? "").trim());
      const head = tag(tr.parentElement ?? tr) === "thead" || cells.every((c) => tag(c) === "th");
      if (inHeader && head) headerRows++;
      else inHeader = false;
      rows.push(row);
    }
    // Tables used for layout (one column, or a single row) are read as text.
    if (rows.length < 2 || rows.every((r) => r.length < 2)) return this.walk(el);
    const capEl = Array.from(el.children).find((c) => tag(c) === "caption");
    let caption = capEl ? trimSpans(this.spansOf(capEl, {})) : [];
    // A "Table 2.1 …" paragraph just before the table is its caption.
    const prev = this.blocks[this.blocks.length - 1];
    if (!caption.length && prev?.kind === "paragraph" && /^(Table|TABLE)\s*\d/.test(spansText(prev.spans).trim())) {
      caption = prev.spans;
      this.blocks.pop();
    }
    const page = this.src.page;
    const tb: TableBlock = {
      kind: "table",
      id: this.id(page),
      page,
      rect: NO_RECT,
      chapter: 0,
      key: keyOf(spansText(caption).trim()) ?? "Table",
      caption,
      rows,
      headerRows,
      parts: [],
      notes: [],
    };
    this.push(tb);
  }

  private box(el: Element): void {
    const inner = new HtmlConverter();
    inner.convert(el, this.src, "");
    let title: Span[] = [];
    const body: (ParagraphBlock | ListBlock)[] = [];
    for (const b of inner.blocks) {
      if (b.kind === "heading" && !title.length && !body.length) title = [{ text: b.text, b: true }];
      else if (b.kind === "paragraph" || b.kind === "list") body.push(b);
      else if (b.kind === "heading") body.push({ kind: "paragraph", id: b.id, page: b.page, rect: NO_RECT, chapter: 0, spans: [{ text: b.text, b: true }] });
    }
    if (!body.length && !title.length) return;
    const page = this.src.page;
    const id = this.id(page);
    body.forEach((b, i) => (b.id = `${id}.${i}`));
    const t = spansText(title);
    const box: BoxBlock = { kind: "box", id, page, rect: NO_RECT, chapter: 0, key: keyOf(t) ?? "Box", title, body, parts: [] };
    this.push(box);
  }

  private footnotes(el: Element): void {
    const inner = new HtmlConverter();
    inner.convert(el, this.src, "");
    for (const b of inner.blocks) {
      if (b.kind === "paragraph") this.paragraph(b.spans.map(clean), true);
      else if (b.kind === "list") for (const it of b.items) this.paragraph(it, true);
    }
  }
}

function keyOf(caption: string): string | undefined {
  const m = CAPTION_RE.exec(caption);
  return m ? xrefKey(m[1], m[2]) : undefined;
}

function styleOf(el: Element): Style {
  const t = tag(el);
  if (t === "em" || t === "i") return { i: true };
  if (t === "strong" || t === "b") return { b: true };
  if (t === "sup") return { sup: true };
  if (t === "sub") return { sub: true };
  return {};
}

function hasBlockChild(el: Element): boolean {
  for (const c of Array.from(el.children)) {
    const t = tag(c);
    if (!INLINE.has(t) && !SKIP.has(t) && t !== "img") return true;
    if (INLINE.has(t) && hasBlockChild(c)) return true;
  }
  return false;
}

function onlyImage(el: Element): Element | null {
  if ((el.textContent ?? "").trim()) return null;
  return firstImage(el);
}

function firstImage(el: Element): Element | null {
  for (const name of ["img", "image", "svg"]) {
    const found = el.getElementsByTagName(name)[0];
    if (found) return found;
  }
  return null;
}

function firstSvgImage(svg: Element): string | null {
  const im = svg.getElementsByTagName("image")[0];
  return im ? (im.getAttribute("xlink:href") ?? im.getAttribute("href")) : null;
}

function isSmall(img: Element): boolean {
  const w = Number(img.getAttribute("width")) || 0;
  const h = Number(img.getAttribute("height")) || 0;
  return (w > 0 && w < 48) || (h > 0 && h < 48);
}

function isSmallText(el: Element): boolean {
  return /\b(footnote|endnote|note|small|caption|credit|source)\b/i.test(el.getAttribute("class") ?? "");
}

function closest(el: Element, name: string): Element | null {
  let p = el.parentElement;
  while (p && tag(p) !== name) p = p.parentElement;
  return p;
}

// ---------- book-level structure ----------

/**
 * Heading tags are used differently from book to book (one uses h1 for
 * chapters, another h2): rank the tags actually used and map them to the
 * reader's levels 1–4.
 */
export function normalizeHeadings(blocks: Block[]): void {
  const used = [...new Set(blocks.filter((b) => b.kind === "heading").map((b) => (b as { level: number }).level))].sort();
  const rank = new Map(used.map((l, i) => [l, Math.min(4, i + 1) as 1 | 2 | 3 | 4]));
  for (const b of blocks) if (b.kind === "heading") b.level = rank.get(b.level) ?? 4;
}

const CHAPTER_RE = /^(?:chapter|chap\.|part|book)\s+([0-9]{1,3}|[ivxlc]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[.:—–-]?\s*(.*)$/i;
const NUMBERED_RE = /^(\d{1,3})\.?\s+(\p{Lu}.{2,})$/u;

/**
 * "Chapter 3" headings give their number to the chapter: "Chapter 3: Pain" →
 * number 3, title "Pain"; a bare "Chapter 3" takes the title from the heading
 * right after it.
 */
export function chapterNumbers(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "heading" || b.level !== 1 || b.number) {
      out.push(b);
      continue;
    }
    const m = CHAPTER_RE.exec(b.text) ?? NUMBERED_RE.exec(b.text);
    if (!m) {
      out.push(b);
      continue;
    }
    const next = blocks[i + 1];
    if (!m[2].trim() && next?.kind === "heading" && next.page === b.page) {
      out.push({ ...b, number: m[1], text: next.text });
      i++;
      continue;
    }
    out.push(m[2].trim() ? { ...b, number: m[1], text: m[2].trim() } : b);
  }
  return out;
}
