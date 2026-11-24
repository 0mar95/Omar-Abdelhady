// Stage 2: page layout. Finds text columns, strips running headers, footers and
// page numbers (remembering the printed page number), and orders everything in
// reading order.

import type { Rect } from "../model.ts";
import type { FontStats, Line } from "./lines.ts";
import { percentile } from "./lines.ts";

export interface Column {
  x0: number;
  x1: number;
}

export interface PageLayout {
  columns: Column[];
  /** x position between two columns, if the page has two. */
  gutter?: number;
}

/** Ordinary text lines (body text, references, notes), not headings or labels. */
function isTextLike(l: Line, stats: FontStats): boolean {
  return l.size >= stats.bodySize * 0.7 && l.size <= stats.bodySize * 1.15 && l.text.length >= 15;
}

function isBodySize(l: Line, stats: FontStats): boolean {
  return Math.abs(l.size - stats.bodySize) <= stats.bodySize * 0.12 && l.text.length >= 12;
}

function twoColumns(lines: Line[]): PageLayout | null {
  if (lines.length < 6) return null;
  const left = percentile(
    lines.map((l) => l.x0),
    0.05,
  );
  const right = percentile(
    lines.map((l) => l.x1),
    0.95,
  );
  const mid = (left + right) / 2;
  const L = lines.filter((l) => l.x1 < mid + 3);
  const R = lines.filter((l) => l.x0 > mid - 3);
  const span = lines.length - L.length - R.length;
  if (L.length < 3 || R.length < 3 || span > 0.2 * (L.length + R.length)) return null;
  const gl = percentile(
    L.map((l) => l.x1),
    0.9,
  );
  const gr = percentile(
    R.map((l) => l.x0),
    0.1,
  );
  if (gr <= gl) return null;
  return {
    columns: [
      { x0: left, x1: gl },
      { x0: gr, x1: right },
    ],
    gutter: (gl + gr) / 2,
  };
}

/**
 * Columns are decided by body text when the page has enough of it (captions,
 * boxes and figure labels often span the page); otherwise by any text, which
 * covers pages of small print such as reference lists.
 */
export function detectLayout(lines: Line[], stats: FontStats, pageW: number): PageLayout | null {
  const body = lines.filter((l) => isBodySize(l, stats));
  const text = lines.filter((l) => isTextLike(l, stats));
  const two = (body.length >= 6 ? twoColumns(body) : null) ?? twoColumns(text);
  if (two) return two;
  const basis = body.length >= 6 ? body : text;
  if (basis.length < 6) return null;
  return {
    columns: [
      {
        x0: Math.min(
          percentile(
            basis.map((l) => l.x0),
            0.05,
          ),
          pageW,
        ),
        x1: percentile(
          basis.map((l) => l.x1),
          0.95,
        ),
      },
    ],
  };
}

/**
 * Pages that look single-column on their own may still follow the book's
 * two-column grid (for example a page of small-print references): adopt it
 * when almost no line crosses the gutter.
 */
export function fitLayout(lines: Line[], own: PageLayout | null, dominant: PageLayout, stats: FontStats): PageLayout {
  if (own && own.columns.length === 2) return own;
  if (dominant.gutter === undefined) return own ?? dominant;
  const g = dominant.gutter;
  const body = lines.filter((l) => isBodySize(l, stats));
  const text = body.length >= 4 ? body : lines.filter((l) => isTextLike(l, stats));
  if (text.length < 4) return own ?? dominant;
  // Lines that cross the gutter only because two columns' lines merged (with a
  // clear gap at the gutter) don't count: they will be split.
  const crosses = (l: Line) => l.x0 < g - 3 && l.x1 > g + 3 && !hasGapAt(l, g);
  const crossing = text.filter(crosses);
  const right = text.filter((l) => l.x0 >= g - 3).length;
  if (crossing.length <= text.length * 0.1 && right >= 2) return dominant;
  // Mixed pages: a full-width part on top (an article's title and abstract, a
  // chapter opener) or at the bottom, and the book's two columns elsewhere.
  // Reading order already reads full-width lines as bands of their own.
  if (mixedPage(text, crossing, crosses, g)) return dominant;
  return own ?? dominant;
}

function mixedPage(text: Line[], crossing: Line[], crosses: (l: Line) => boolean, g: number): boolean {
  // Split the page at its full-width lines; any part in between whose lines
  // sit side by side on the same baselines is set in the two columns.
  const cuts = crossing.map((l) => l.top).sort((a, b) => a - b);
  const bands: Line[][] = Array.from({ length: cuts.length + 1 }, () => []);
  for (const l of text) {
    if (crosses(l)) continue;
    let k = 0;
    while (k < cuts.length && l.top >= cuts[k]) k++;
    bands[k].push(l);
  }
  return bands.some((ls) => {
    const left = ls.filter((l) => l.x1 <= g + 3);
    const right = ls.filter((l) => l.x0 >= g - 3);
    if (left.length < 2 || right.length < 2) return false;
    const paired = left.filter((a) => right.some((b) => Math.abs(a.y - b.y) < a.size * 0.4)).length;
    return paired >= 2 && paired >= Math.min(left.length, right.length) * 0.5;
  });
}

/** The most common layout, for pages with too little text to decide on their own. */
export function dominantLayout(layouts: (PageLayout | null)[], pageW: number): PageLayout {
  const two = layouts.filter((l): l is PageLayout => !!l && l.columns.length === 2);
  const one = layouts.filter((l): l is PageLayout => !!l && l.columns.length === 1);
  const pick = (ls: PageLayout[], n: number): PageLayout => {
    const cols: Column[] = [];
    for (let i = 0; i < n; i++)
      cols.push({
        x0: percentile(
          ls.map((l) => l.columns[i].x0),
          0.5,
        ),
        x1: percentile(
          ls.map((l) => l.columns[i].x1),
          0.5,
        ),
      });
    return n === 2 ? { columns: cols, gutter: (cols[0].x1 + cols[1].x0) / 2 } : { columns: cols };
  };
  if (two.length > one.length) return pick(two, 2);
  if (one.length) return pick(one, 1);
  return { columns: [{ x0: pageW * 0.1, x1: pageW * 0.9 }] };
}

/** True when the line has a gap between two runs right where the gutter is. */
export function hasGapAt(l: Line, g: number): boolean {
  const runs = [...l.runs].sort((a, b) => a.x - b.x);
  for (let i = 1; i < runs.length; i++) {
    const end = runs[i - 1].x + runs[i - 1].w;
    if (end <= g + 4 && runs[i].x >= g - 4 && runs[i].x - end > l.size * 0.4) return true;
  }
  return false;
}

/** Splits lines that cross the gutter at a gap (two columns that happened to merge). */
export function splitAtGutter(lines: Line[], layout: PageLayout, rebuild: (runs: Line["runs"], from: Line) => Line): Line[] {
  if (layout.gutter === undefined) return lines;
  const g = layout.gutter;
  const out: Line[] = [];
  for (const l of lines) {
    if (l.x0 < g && l.x1 > g && l.runs.length > 1 && hasGapAt(l, g)) {
      const leftRuns = l.runs.filter((r) => r.x + r.w <= g + 4);
      const rightRuns = l.runs.filter((r) => r.x + r.w > g + 4);
      if (leftRuns.length && rightRuns.length && leftRuns.length + rightRuns.length === l.runs.length) {
        out.push(rebuild(leftRuns, l), rebuild(rightRuns, l));
        continue;
      }
    }
    out.push(l);
  }
  return out;
}

export interface Furniture {
  /** Line keys (page:index) to drop. */
  drop: Set<Line>;
  /** Printed page labels found on pages. */
  labels: Map<number, string>;
}

const PAGE_NUM_RE = /^(?:page\s+)?(\d{1,4}|[ivxlcdm]{1,7})$/i;
/** Running headers that carry the page number: "xiv  Fundamentals of Oral Medicine", "Oral Cancer  197". */
const NUM_HEADER = /^(?:(\d{1,4}|[ivxlc]{1,7})\s+(\S.{2,})|(\S.{2,}?)\s+(\d{1,4}|[ivxlc]{1,7}))$/i;
const SLUG_RE = /\.(?:indd|qxd|qxp|fm|tex)\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\b/i;

/**
 * Running headers, footers and page numbers — the same rules for every PDF,
 * whatever its margins:
 *  - only a page's edge lines are candidates: its first and last two rows,
 *    plus anything in the outermost margin bands;
 *  - a lone number there is the page number;
 *  - a line whose shape repeats from page to page with only its number
 *    changing ("xiv Fundamentals of …", "Oral Cancer 197") is a running
 *    header or footer, and its number is the page number — provided the
 *    numbers climb in step with the pages;
 *  - lines repeating unchanged, or in the same style and place, are furniture;
 *  - tiny printer's type at the edge (a slug's job number and date) is dropped;
 *  - failing all that, a lone number standing in the outer margin, clear of
 *    the text, is the page number.
 */
export function findFurniture(pages: { lines: Line[]; h: number }[], stats: FontStats): Furniture {
  const body = stats.bodySize;
  const tiny = (l: Line) => l.size < body * 0.68;
  const printers = (r: Line[]) => r.every((l) => tiny(l) || SLUG_RE.test(l.text));
  const shape = (t: string) =>
    t
      .toLowerCase()
      .replace(/\b(?:\d{1,4}|[ivxlc]{1,7})\b/g, "#")
      .replace(/[^\p{L}#]+/gu, " ")
      .trim();
  const inBand = (r: Line[], h: number) => r.every((l) => l.bottom < h * 0.085) || r.every((l) => l.top > h * 0.915);
  const rowText = (r: Line[]) =>
    [...r]
      .sort((a, b) => a.x0 - b.x0)
      .map((l) => l.text.trim())
      .join(" ");

  // 1. Each page's edge rows (lines sharing a baseline, read left to right).
  const apart = new Set<Line[]>();
  const edges = pages.map((p) => {
    const rows: Line[][] = [];
    for (const l of [...p.lines].sort((a, b) => a.y - b.y)) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row[0].y - l.y) < 0.35 * Math.min(row[0].size, l.size)) row.push(l);
      else rows.push([l]);
    }
    // Printer's type at the very edge isn't the page's edge: the real edge is just inside it.
    const real = rows.filter((r) => !printers(r));
    // A header or footer needs text to frame: a page of two lines has none.
    if (real.length < 3) return rows.filter((r) => printers(r));
    const set = new Set<Line[]>([...real.slice(0, 2), ...real.slice(-2)]);
    // The very first and last rows, when a gap sets them apart from the text, are margin rows.
    const gap = (a: Line[], b: Line[]) => Math.min(...b.map((l) => l.top)) - Math.max(...a.map((l) => l.bottom));
    const size = (r: Line[]) => Math.min(...r.map((l) => l.size), body);
    if (real.length > 2 && gap(real[0], real[1]) > size(real[0]) * 1.2) apart.add(real[0]);
    if (real.length > 2 && gap(real[real.length - 2], real[real.length - 1]) > size(real[real.length - 1]) * 1.2) apart.add(real[real.length - 1]);
    for (const r of rows) if (inBand(r, p.h) || (printers(r) && (r === rows[0] || r === rows[rows.length - 1]))) set.add(r);
    return [...set];
  });

  // 2. How often each shape (numbers blanked) and each style-and-place appears on page edges.
  const shapes = new Map<string, number>();
  const styles = new Map<string, number>();
  const styleKey = (r: Line[], h: number) => `${r[0].top < h / 2 ? "t" : "b"}|${r[0].font}|${Math.round(r[0].size)}|${Math.round(r[0].y / 4)}`;
  pages.forEach((p, pi) => {
    const sh = new Set<string>();
    const st = new Set<string>();
    for (const r of edges[pi]) {
      sh.add(shape(rowText(r)));
      if (inBand(r, p.h) || apart.has(r)) st.add(styleKey(r, p.h));
    }
    for (const k of sh) shapes.set(k, (shapes.get(k) ?? 0) + 1);
    for (const k of st) styles.set(k, (styles.get(k) ?? 0) + 1);
  });
  const repeated = Math.max(3, pages.length < 30 ? 3 : Math.ceil(pages.length * 0.04));

  // 3. Numbered headers count only if their numbers climb with the pages (the offset stays put).
  const offsets = new Map<string, Set<number>>();
  pages.forEach((_, pi) => {
    for (const r of edges[pi]) {
      const m = NUM_HEADER.exec(rowText(r));
      const n = m ? toNumber(m[1] ?? m[4]) : null;
      if (n === null || r.some((l) => l.size > body * 1.8)) continue;
      const k = shape(rowText(r));
      offsets.set(k, (offsets.get(k) ?? new Set()).add(n - pi));
    }
  });
  const steady = (k: string) => (shapes.get(k) ?? 0) >= 2 && (offsets.get(k)?.size ?? 99) <= 2;

  const drop = new Set<Line>();
  const labels = new Map<number, string>();
  pages.forEach((p, pi) => {
    let lone: { text: string; size: number } | null = null;
    let fromHeader: string | null = null;
    for (const r of edges[pi]) {
      const text = rowText(r);
      // (Headers and page numbers may be set larger than the text; chapter numbers are far larger.)
      const big = r.some((l) => l.size > body * 1.8);
      if (printers(r) || SLUG_RE.test(text)) {
        for (const l of r) drop.add(l);
        continue;
      }
      if (PAGE_NUM_RE.test(text) && !big) {
        for (const l of r) drop.add(l);
        if (!lone || r[0].size > lone.size) lone = { text: text.replace(/^page\s+/i, ""), size: r[0].size };
        continue;
      }
      const m = NUM_HEADER.exec(text);
      const k = shape(text);
      if (m && !big && steady(k)) {
        for (const l of r) drop.add(l);
        fromHeader ??= m[1] ?? m[4];
        continue;
      }
      if (((shapes.get(k) ?? 0) >= repeated && text.length < 100) || ((inBand(r, p.h) || apart.has(r)) && r.every((l) => l.size <= body * 1.15) && (styles.get(styleKey(r, p.h)) ?? 0) >= repeated)) for (const l of r) drop.add(l);
    }
    let label = lone?.text ?? fromHeader;
    // 4. Failing that: a lone number halfway down the outer margin, clear of the text.
    if (!label) {
      const text = p.lines.filter((l) => l.text.trim().length > 20);
      if (text.length >= 5) {
        const left = Math.min(...text.map((l) => l.x0));
        const right = Math.max(...text.map((l) => l.x1));
        const outer = p.lines.filter(
          (l) =>
            PAGE_NUM_RE.test(l.text.trim()) &&
            !tiny(l) &&
            l.size <= body * 1.3 &&
            (l.x1 < left - 15 || l.x0 > right + 15) &&
            !p.lines.some((o) => o !== l && Math.abs(o.y - l.y) < l.size && Math.max(o.x0 - l.x1, l.x0 - o.x1) < 20),
        );
        if (outer.length === 1) {
          drop.add(outer[0]);
          label = outer[0].text.trim();
        }
      }
    }
    if (label) labels.set(pi, label);
  });
  return { drop, labels };
}

/** "17" → 17, "xiv" → 14. */
function toNumber(t: string): number | null {
  if (/^\d+$/.test(t)) return Number(t);
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  const s = t.toLowerCase();
  if (!/^[ivxlc]+$/.test(s)) return null;
  let n = 0;
  for (let i = 0; i < s.length; i++) n += v[s[i]] < (v[s[i + 1]] ?? 0) ? -v[s[i]] : v[s[i]];
  return n;
}

/** Anything that takes part in reading order: a line, or a figure/table/box region. */
export interface Placed {
  rect: Rect;
}

/**
 * Orders items in reading order: full-width items split the page into bands;
 * inside a band the left column is read before the right one.
 */
export function readingOrder<T extends Placed>(items: T[], layout: PageLayout): T[] {
  if (layout.gutter === undefined) return [...items].sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);
  const g = layout.gutter;
  const colOf = (it: T): 0 | 1 | -1 => (it.rect.x1 <= g + 3 ? 0 : it.rect.x0 >= g - 3 ? 1 : -1);
  // Whatever sits above everything else (a title set over one column) is read first.
  const lowestTop = (except: T) => Math.min(...items.filter((x) => x !== except).map((x) => x.rect.y0));
  const leading = new Set(items.filter((it) => colOf(it) !== -1 && it.rect.y1 <= lowestTop(it) + 1));
  const spans = items.filter((it) => colOf(it) === -1 || leading.has(it)).sort((a, b) => a.rect.y0 - b.rect.y0);
  const out: T[] = [];
  let remaining = items.filter((it) => colOf(it) !== -1 && !leading.has(it));
  const flushBand = (limitY: number) => {
    const band = remaining.filter((it) => it.rect.y0 < limitY);
    remaining = remaining.filter((it) => it.rect.y0 >= limitY);
    const byY = (a: T, b: T) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0;
    out.push(...band.filter((it) => colOf(it) === 0).sort(byY), ...band.filter((it) => colOf(it) === 1).sort(byY));
  };
  for (const s of spans) {
    flushBand(s.rect.y0);
    out.push(s);
  }
  flushBand(Infinity);
  return out;
}

export function lineRect(l: Line): Rect {
  return { x0: l.x0, y0: l.top, x1: l.x1, y1: l.bottom };
}

export function union(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function overlapX(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
}

export function overlapY(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

export function area(r: Rect): number {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

export function contains(outer: Rect, inner: Rect, pad = 0): boolean {
  return inner.x0 >= outer.x0 - pad && inner.x1 <= outer.x1 + pad && inner.y0 >= outer.y0 - pad && inner.y1 <= outer.y1 + pad;
}
