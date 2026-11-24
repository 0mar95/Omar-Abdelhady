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
const SLUG_RE = /\.(?:indd|qxd|qxp|fm|tex)\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\b/i;

/**
 * Running headers, footers and page numbers live in the top and bottom margins
 * and repeat their style and position on many pages.
 */
export function findFurniture(pages: { lines: Line[]; h: number }[], stats: FontStats): Furniture {
  // The page's outer lines, when set apart by a gap (a running header just
  // inside a deep top margin), count as margins too.
  const edges = new Map<Line, "top" | "bottom">();
  for (const p of pages) {
    // (A printer's slug below the page number doesn't make the number any less the page's edge.)
    // Nor does printer's type far smaller than the text (a slug's job number).
    const slugRows = new Set(p.lines.filter((l) => SLUG_RE.test(l.text) || l.size < stats.bodySize * 0.68).map((l) => Math.round(l.y)));
    const sorted = p.lines.filter((l) => !slugRows.has(Math.round(l.y))).sort((a, b) => a.top - b.top);
    const firstY = sorted[0]?.top;
    const top = sorted.filter((l) => Math.abs(l.top - firstY) < 2);
    const nextTop = sorted.find((l) => l.top > firstY + 2);
    const topSize = Math.min(...top.map((l) => l.size), stats.bodySize);
    if (top.length && nextTop && top[0].bottom < p.h * 0.15 && nextTop.top - Math.max(...top.map((l) => l.bottom)) > topSize * 1.2) for (const l of top) edges.set(l, "top");
    const lastY = sorted[sorted.length - 1]?.top;
    const bottom = sorted.filter((l) => Math.abs(l.top - lastY) < 2);
    const prev = [...sorted].reverse().find((l) => l.top < lastY - 2);
    if (bottom.length && prev && bottom[0].top > p.h * 0.85 && bottom[0].top - prev.bottom > bottom[0].size * 1.2) for (const l of bottom) edges.set(l, "bottom");
  }
  const band = (l: Line, h: number): "top" | "bottom" | null => (l.bottom < h * 0.085 ? "top" : l.top > h * 0.915 ? "bottom" : (edges.get(l) ?? null));
  const key = (l: Line, b: string) => `${b}|${l.font}|${Math.round(l.size)}|${Math.round(l.y / 4)}`;
  const counts = new Map<string, number>();
  pages.forEach((p) => {
    const keys = new Set<string>();
    for (const l of p.lines) {
      const b = band(l, p.h);
      if (b) keys.add(key(l, b));
    }
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const minPages = Math.max(3, Math.ceil(pages.length * 0.04));
  const drop = new Set<Line>();
  const labels = new Map<number, string>();
  pages.forEach((p, pi) => {
    // A printer's slug ("Book_FM.indd 7  8/29/19  11:21 AM") is furniture, and its number isn't the page's.
    const slugRows = new Set(p.lines.filter((l) => SLUG_RE.test(l.text)).map((l) => Math.round(l.y)));
    let best: { text: string; size: number } | null = null;
    for (const l of p.lines) {
      const b = band(l, p.h);
      if (!b) continue;
      const text = l.text.trim();
      const slug = slugRows.has(Math.round(l.y));
      const isNum = PAGE_NUM_RE.test(text) && l.size <= stats.bodySize * 1.3 && l.size >= stats.bodySize * 0.68;
      if (slug || isNum || (counts.get(key(l, b)) ?? 0) >= minPages) {
        drop.add(l);
        if (isNum && !slug && (!best || l.size > best.size)) best = { text: text.replace(/^page\s+/i, ""), size: l.size };
      }
    }
    // Some designs print the page number halfway down the outer margin, clear of the text.
    const body = p.lines.filter((l) => l.text.trim().length > 20);
    if (body.length >= 5) {
      const left = Math.min(...body.map((l) => l.x0));
      const right = Math.max(...body.map((l) => l.x1));
      // Exactly one such number, alone on its line (numbers ending contents lines don't count).
      const outer = p.lines.filter((l) => {
        const text = l.text.trim();
        if (!PAGE_NUM_RE.test(text) || l.size < stats.bodySize * 0.68 || l.size > stats.bodySize * 1.3) return false;
        if (!(l.x1 < left - 15 || l.x0 > right + 15)) return false;
        return !p.lines.some((o) => o !== l && Math.abs(o.y - l.y) < l.size && Math.max(o.x0 - l.x1, l.x0 - o.x1) < 20);
      });
      if (outer.length === 1) {
        drop.add(outer[0]);
        best ??= { text: outer[0].text.trim(), size: outer[0].size };
      }
    }
    if (best) labels.set(pi, best.text);
  });
  return { drop, labels };
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
