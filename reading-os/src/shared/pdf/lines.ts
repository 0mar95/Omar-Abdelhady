// Stage 1: text runs → lines. Removes watermark-style noise and assembles runs
// on the same baseline into lines with inline styling (italic, bold, citations).

import type { Span } from "../model.ts";
import type { RawPage, Run } from "./load.ts";
import { normalizeText, parseCitation } from "./text.ts";

export interface Line {
  page: number;
  runs: Run[];
  spans: Span[];
  text: string;
  x0: number;
  x1: number;
  /** Baseline. */
  y: number;
  top: number;
  bottom: number;
  size: number;
  font: string;
  /** Every visible run is bold / italic. */
  bold: boolean;
  italic: boolean;
  /** Font of the first run (captions start with a bold label). */
  firstFont: string;
  firstBold: boolean;
  /** Indented only to make room for a drop cap; not a paragraph indent. */
  besideDropCap?: boolean;
}

const BULLET_GLYPH = /^[•·▪■◦●○‣⁃►▸✓✔]$/;

/** Font family without the style suffix: "WarnockPro-LightIt" → "WarnockPro". */
export function fontFamily(font: string): string {
  return font.split("-")[0];
}

export interface FontStats {
  bodyFont: string;
  bodySize: number;
}

export function fontStats(pages: RawPage[]): FontStats {
  const counts = new Map<string, number>();
  for (const p of pages)
    for (const r of p.runs) {
      if (r.rotated) continue;
      const key = `${r.font}|${(Math.round(r.size * 4) / 4).toFixed(2)}`;
      counts.set(key, (counts.get(key) ?? 0) + r.str.length);
    }
  let best = "";
  let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  const [bodyFont, size] = best.split("|");
  return { bodyFont: bodyFont ?? "", bodySize: Number(size) || 10 };
}

/**
 * Removes runs that are not part of the reading text: rotated text, tiny text,
 * and anything printed at the same spot with the same text on many pages
 * (footers, download watermarks, diagonal "copyright" letters).
 */
export function removeNoise(pages: RawPage[], stats: FontStats): { pages: RawPage[]; removed: number } {
  const sig = (r: Run) => `${Math.round(r.x)}|${Math.round(r.y)}|${r.str.trim()}`;
  const seen = new Map<string, number>();
  for (const p of pages) {
    const onPage = new Set(p.runs.map(sig));
    for (const s of onPage) seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  const threshold = Math.max(4, Math.ceil(pages.length * 0.25));
  // Drawings repeated on many pages are page frames, header rules or stamped
  // banners, never figures.
  const gsig = (g: RawPage["graphics"][number]) => `${g.kind}|${Math.round(g.x0)}|${Math.round(g.y0)}|${Math.round(g.x1)}|${Math.round(g.y1)}`;
  const gseen = new Map<string, number>();
  for (const p of pages) for (const k of new Set(p.graphics.map(gsig))) gseen.set(k, (gseen.get(k) ?? 0) + 1);
  let removed = 0;
  const out = pages.map((p) => {
    const runs = p.runs.filter((r) => {
      const noisy = r.rotated || r.size < stats.bodySize * 0.4 || (seen.get(sig(r)) ?? 0) >= threshold;
      if (noisy) removed++;
      return !noisy;
    });
    const graphics = p.graphics.filter((g) => (gseen.get(gsig(g)) ?? 0) < threshold);
    return { ...p, runs, graphics };
  });
  return { pages: out, removed };
}

interface Row {
  y: number;
  size: number;
  runs: Run[];
}

const SPLIT_GAP_EM = 1.0;

/** Groups the runs of a page into lines (one line per column per baseline). */
export function buildLines(page: RawPage, stats: FontStats): Line[] {
  const runs = [...page.runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Row[] = [];
  const small: Run[] = [];
  const bullets: Run[] = [];
  const dropCaps: Run[] = [];
  for (const r of runs) {
    const t = r.str.trim();
    // Bullets are often set on their own baseline; attach them to their item later.
    if (BULLET_GLYPH.test(t)) {
      bullets.push(r);
      continue;
    }
    // A large single letter opening a paragraph (drop cap).
    if (/^[A-Z“"]$/.test(t) && r.size >= stats.bodySize * 1.8 && r.size <= stats.bodySize * 6) {
      dropCaps.push(r);
      continue;
    }
    // Runs much smaller than body text may be superscripts; attach them later.
    if (r.size < stats.bodySize * 0.8) {
      small.push(r);
      continue;
    }
    let target: Row | undefined;
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 6; i--) {
      const row = rows[i];
      if (Math.abs(row.y - r.y) <= 0.3 * Math.min(row.size, r.size)) {
        target = row;
        break;
      }
    }
    if (target) {
      target.runs.push(r);
      target.size = Math.max(target.size, r.size);
    } else rows.push({ y: r.y, size: r.size, runs: [r] });
  }

  // Small runs: superscripts sit slightly above a normal row and touch a run in it.
  for (const r of small) {
    let best: Row | undefined;
    let bestScore = Infinity;
    for (const row of rows) {
      const dy = row.y - r.y; // positive when the run is above the baseline
      if (dy < -0.35 * row.size || dy > 0.75 * row.size) continue;
      const near = row.runs.some((o) => r.x >= o.x - row.size && r.x <= o.x + o.w + row.size * 0.6);
      if (!near) continue;
      const score = Math.abs(dy);
      if (score < bestScore) [best, bestScore] = [row, score];
    }
    if (best) best.runs.push(r);
    else {
      const row = rows.find((o) => Math.abs(o.y - r.y) <= 0.3 * r.size);
      if (row) row.runs.push(r);
      else rows.push({ y: r.y, size: r.size, runs: [r] });
    }
  }

  for (const b of bullets) {
    // The item text starts just right of the bullet, on the nearest baseline.
    let best: Row | undefined;
    let bestDy = Infinity;
    for (const row of rows) {
      const dy = Math.abs(row.y - b.y);
      if (dy > row.size * 0.9) continue;
      const right = row.runs.some((o) => o.x >= b.x + b.w - 1 && o.x - (b.x + b.w) < row.size * 3);
      if (right && dy < bestDy) [best, bestDy] = [row, dy];
    }
    const bullet = { ...b, y: best ? best.y : b.y, size: best ? best.size : b.size };
    if (best) best.runs.push(bullet);
    else rows.push({ y: b.y, size: b.size, runs: [bullet] });
  }

  const lines: Line[] = [];
  for (const row of rows) {
    const sorted = row.runs.sort((a, b) => a.x - b.x);
    let current: Run[] = [];
    let end = -Infinity;
    for (const r of sorted) {
      // Skip duplicated runs (fake bold drawn twice).
      if (current.some((o) => o.str === r.str && Math.abs(o.x - r.x) < 0.6 && Math.abs(o.y - r.y) < 0.6)) continue;
      const gap = r.x - end;
      const afterBullet = current.length === 1 && BULLET_GLYPH.test(current[0].str.trim()) && gap < row.size * 3;
      if (current.length && !afterBullet && gap > SPLIT_GAP_EM * Math.max(row.size, r.size)) {
        lines.push(makeLine(page.index, current, row));
        current = [];
      }
      current.push(r);
      end = Math.max(end, r.x + r.w);
    }
    if (current.length) lines.push(makeLine(page.index, current, row));
  }
  const out = lines.filter((l) => l.text.trim().length > 0).sort((a, b) => a.top - b.top || a.x0 - b.x0);
  for (const dc of dropCaps) attachDropCap(dc, out, page.index);
  return out;
}

function attachDropCap(dc: Run, lines: Line[], page: number): void {
  const capTop = dc.y - dc.size * 0.75;
  const beside = lines.filter((l) => l.x0 >= dc.x + dc.w - 2 && l.x0 - (dc.x + dc.w) < dc.size && l.y >= capTop && l.top <= dc.y + 1);
  if (!beside.length) {
    lines.push(lineFromRuns(page, [{ ...dc, size: Math.min(dc.size, 12) }]));
    return;
  }
  beside.sort((a, b) => a.y - b.y);
  const first = beside[0];
  first.spans.unshift({ text: dc.str.trim() });
  first.text = dc.str.trim() + first.text;
  first.x0 = dc.x;
  for (const l of beside) l.besideDropCap = true;
}

function makeLine(page: number, runs: Run[], row: Row): Line {
  // The main size is the size carrying most characters.
  const bySize = new Map<number, number>();
  const byFont = new Map<string, number>();
  for (const r of runs) {
    const s = Math.round(r.size * 4) / 4;
    bySize.set(s, (bySize.get(s) ?? 0) + r.str.length);
    byFont.set(r.font, (byFont.get(r.font) ?? 0) + r.str.length);
  }
  const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const font = [...byFont.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const baseRuns = runs.filter((r) => r.size >= size * 0.8);
  const baseline = baseRuns.length ? median(baseRuns.map((r) => r.y)) : row.y;

  const spans: Span[] = [];
  let prevEnd = -Infinity;
  let prevSize = size;
  for (const r of runs) {
    const isSmall = r.size < size * 0.82;
    const raised = baseline - r.y > 0.12 * size;
    let text = normalizeText(r.str);
    const gap = r.x - prevEnd;
    const needsSpace = spans.length > 0 && gap > 0.12 * Math.min(prevSize, r.size);
    const last = spans[spans.length - 1];
    if (needsSpace && last && !/\s$/.test(last.text) && !/^\s/.test(text)) {
      // A citation directly after a word should not get a space before it.
      if (!(isSmall && raised)) text = ` ${text}`;
    }
    const span: Span = { text };
    if (isSmall && raised) {
      const cites = parseCitation(r.str.trim());
      if (cites) span.cite = cites;
      else span.sup = true;
    } else {
      if (r.italic) span.i = true;
      if (r.bold) span.b = true;
    }
    if (span.cite || span.sup) {
      const lead = /^\s*/.exec(span.text)![0];
      const trail = /\s*$/.exec(span.text)![0];
      if (lead) pushSpan(spans, { text: lead });
      span.text = span.text.trim();
      pushSpan(spans, span);
      if (trail) pushSpan(spans, { text: trail });
    } else if ((span.i || span.b) && /^\s/.test(span.text)) {
      // Keep the word space outside italic/bold so styling hugs the words.
      pushSpan(spans, { text: " " });
      span.text = span.text.replace(/^\s+/, "");
      pushSpan(spans, span);
    } else pushSpan(spans, span);
    prevEnd = r.x + r.w;
    prevSize = r.size;
  }
  const visible = runs.filter((r) => r.str.trim());
  const x0 = Math.min(...runs.map((r) => r.x));
  const x1 = Math.max(...runs.map((r) => r.x + r.w));
  return {
    page,
    runs,
    spans,
    text: spans.map((s) => s.text).join(""),
    x0,
    x1,
    y: baseline,
    top: baseline - size * 0.78,
    bottom: baseline + size * 0.22,
    size,
    font,
    bold: visible.every((r) => r.bold || r.size < size * 0.82),
    italic: visible.every((r) => r.italic || r.size < size * 0.82),
    firstFont: visible[0]?.font ?? font,
    firstBold: visible[0]?.bold ?? false,
  };
}

/** Appends a span, merging it into the previous one when the styling matches. */
export function pushSpan(spans: Span[], span: Span): void {
  const last = spans[spans.length - 1];
  if (
    last &&
    !last.cite &&
    !span.cite &&
    !last.xref &&
    !span.xref &&
    last.pageRef === undefined &&
    span.pageRef === undefined &&
    !!last.i === !!span.i &&
    !!last.b === !!span.b &&
    !!last.sup === !!span.sup
  ) {
    last.text += span.text;
    return;
  }
  spans.push(span);
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/** Builds a line from an arbitrary set of runs (used when splitting lines). */
export function lineFromRuns(page: number, runs: Run[], _stats?: FontStats): Line {
  const sorted = [...runs].sort((a, b) => a.x - b.x);
  return makeLine(page, sorted, { y: median(sorted.map((r) => r.y)), size: Math.max(...sorted.map((r) => r.size)), runs: sorted });
}
