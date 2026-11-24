// Stage 3: figures, tables and boxes. Captions ("Fig 1-1", "Table 2-3",
// "Box 5-1") anchor each region; drawings and images locate the figure itself,
// and fonts tell table and box contents apart from the body text around them.

import type { Rect } from "../model.ts";
import type { Graphic } from "./load.ts";
import { fontFamily, type FontStats, type Line } from "./lines.ts";
import { area, contains, lineRect, overlapX, overlapY, union, type PageLayout } from "./layout.ts";
import { CAPTION_RE } from "./text.ts";

export type RegionType = "figure" | "table" | "box";

export interface Region {
  type: RegionType;
  page: number;
  key?: string;
  /** "(cont)" caption: continues a table or box from an earlier page. */
  cont: boolean;
  /** Whole region including the caption; used for reading order. */
  rect: Rect;
  /** The part to crop when showing the original (the drawing for figures). */
  crop: Rect;
  captionLines: Line[];
  contentLines: Line[];
}

interface Caption {
  type: RegionType;
  key: string;
  cont: boolean;
  lines: Line[];
  rect: Rect;
}

export function isBodyText(l: Line, stats: FontStats): boolean {
  return fontFamily(l.font) === fontFamily(stats.bodyFont) && Math.abs(l.size - stats.bodySize) <= stats.bodySize * 0.08;
}

function findCaptions(lines: Line[], stats: FontStats): Caption[] {
  const out: Caption[] = [];
  const taken = new Set<Line>();
  for (const l of lines) {
    if (taken.has(l)) continue;
    // A caption may open with a decoration: "■ Figure 1.22".
    const m = CAPTION_RE.exec(l.text.trim().replace(/^[■□▪▫●○◆◇▶►•*]\s*/u, ""));
    if (!m) continue;
    const distinctive = l.firstFont !== stats.bodyFont || l.firstBold || l.size < stats.bodySize * 0.92;
    if (!distinctive) continue;
    const word = m[1].toLowerCase();
    const type: RegionType = word.startsWith("fig") ? "figure" : word.startsWith("tab") ? "table" : "box";
    const key = `${type === "figure" ? "Fig" : type === "table" ? "Table" : "Box"} ${m[2].replace(/\s/g, "").replace(/[–.]/g, "-")}`;
    const capLines = [l];
    taken.add(l);
    let rect = lineRect(l);
    // Caption text that wraps onto following lines in the same style.
    for (const n of lines) {
      if (taken.has(n) || n.top < rect.y1 - 1) continue;
      const last = capLines[capLines.length - 1];
      const gap = n.top - last.bottom;
      if (gap > last.size * 0.9) break;
      if (n.top > last.bottom + last.size * 0.9) break;
      // The caption's title and description may be set in other styles, aligned under its label.
      const sameStyle = Math.abs(n.size - l.size) <= 0.3 && n.font === l.font;
      // (Figures only: under a table's caption, such lines are the table itself.)
      const underLabel = type === "figure" && Math.abs(n.x0 - rect.x0) <= 4 && !isBodyText(n, stats) && n.size <= l.size * 1.2;
      if (!sameStyle && !underLabel) continue;
      if (overlapX(lineRect(n), rect) <= 0 || n.x0 < rect.x0 - 2) continue;
      if (CAPTION_RE.test(n.text.trim())) break;
      capLines.push(n);
      taken.add(n);
      rect = union(rect, lineRect(n));
    }
    out.push({ type, key, cont: !!m[3], lines: capLines, rect });
  }
  return out;
}

function cluster(graphics: Rect[], pad: number): Rect[] {
  const rects = graphics.map((g) => ({ ...g }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1) {
          rects[i] = union(a, b);
          rects.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return rects;
}

export interface PageForRegions {
  index: number;
  w: number;
  h: number;
  lines: Line[];
  graphics: Graphic[];
}

export function findRegions(page: PageForRegions, layout: PageLayout, stats: FontStats): Region[] {
  const { lines } = page;
  const captions = findCaptions(lines, stats);
  const pageArea = page.w * page.h;
  const used = new Set<Line>();
  for (const c of captions) c.lines.forEach((l) => used.add(l));
  const regions: Region[] = [];
  const captionLineSet = new Set(captions.flatMap((c) => c.lines));

  // Tables and boxes: the caption sits on top; contents follow in a non-body font.
  for (const c of captions.filter((c) => c.type !== "figure")) {
    let rect = c.rect;
    const content: Line[] = [];
    const background = findBackground(page, c.rect);
    const last = () => (content.length ? content[content.length - 1] : c.lines[c.lines.length - 1]);
    if (background) {
      // Shaded box or table: its contents are what's inside the shading, plus
      // small-print notes directly beneath it.
      rect = union(rect, background);
      for (const l of lines) {
        if (used.has(l) || captionLineSet.has(l)) continue;
        const lr = lineRect(l);
        const cy = (lr.y0 + lr.y1) / 2;
        if (contains(background, { ...lr, y0: cy, y1: cy }, 2)) {
          content.push(l);
          continue;
        }
        const below = lr.y0 >= background.y1 - 2 && lr.y0 - Math.max(background.y1, last().bottom) < l.size * 2.5;
        if (below && !isBodyText(l, stats) && overlapX(lr, background) > (lr.x1 - lr.x0) * 0.5) {
          content.push(l);
          rect = union(rect, lr);
        }
      }
    } else {
      for (const l of lines) {
        if (used.has(l) || l.top < c.rect.y1 - 1) continue;
        const lr = lineRect(l);
        if (captionLineSet.has(l)) break;
        if (isBodyText(l, stats)) {
          if (overlapX(lr, rect) <= 0) continue; // text in the other column
          if (l.text.length > 25) break; // body text resumes below the table
        }
        if (l.top - last().bottom > Math.max(3 * l.size, 26) && overlapX(lr, rect) > 0) break;
        content.push(l);
        rect = union(rect, lr);
      }
    }
    content.sort((a, b) => a.top - b.top || a.x0 - b.x0);
    content.forEach((l) => used.add(l));
    regions.push({ type: c.type, page: page.index, key: c.key, cont: c.cont, rect, crop: rect, captionLines: c.lines, contentLines: content });
  }

  // Figures: find the drawing or image nearest to each caption.
  const inTables = (g: Rect) => regions.some((r) => contains(r.rect, g, 2));
  const candidates = page.graphics.filter(
    (g) => area(g) < pageArea * 0.85 && !inTables(g),
  );
  // A flat coloured bar (a section banner) is decoration, not a figure.
  const hasImage = (r: Rect) => candidates.some((g) => g.kind === "image" && contains(r, g, 1));
  const banner = (r: Rect) => !hasImage(r) && r.y1 - r.y0 < 40 && (r.x1 - r.x0) / Math.max(1, r.y1 - r.y0) > 6;
  const clusters = cluster(candidates, 6).filter((r) => r.x1 - r.x0 > 12 && r.y1 - r.y0 > 12 && !banner(r));
  const takenClusters = new Set<Rect>();
  for (const c of captions.filter((c) => c.type === "figure")) {
    let best: Rect | undefined;
    let bestD = Infinity;
    for (const cl of clusters) {
      if (takenClusters.has(cl)) continue;
      let d: number;
      if (cl.y1 <= c.rect.y0 + 4 && overlapX(cl, c.rect) > 0) d = c.rect.y0 - cl.y1;
      else if (cl.y0 >= c.rect.y1 - 4 && overlapX(cl, c.rect) > 0) d = cl.y0 - c.rect.y1 + 12;
      else if (overlapY(cl, c.rect) > 0) d = Math.max(c.rect.x0 - cl.x1, cl.x0 - c.rect.x1) + 20;
      else continue;
      if (d < bestD) [best, bestD] = [cl, d];
    }
    // "Fig. 1.22" alone in the margin of the text points to a figure printed elsewhere:
    // without a description it's only a figure if a picture is right beside it.
    const labelOnly = c.lines.map((l) => l.text).join(" ").replace(/^[^\p{L}]*/u, "").replace(CAPTION_RE, "").trim().length < 3;
    if (labelOnly && !(best && bestD < 40 && hasImage(best))) {
      for (const l of c.lines) used.delete(l);
      continue;
    }
    let crop: Rect;
    if (best && bestD < page.h * 0.35) {
      takenClusters.add(best);
      crop = best;
    } else {
      // No drawing found: use the space above the caption up to the text before it.
      const col = layout.columns.find((k) => c.rect.x0 >= k.x0 - 4 && c.rect.x0 <= k.x1) ?? layout.columns[0];
      const above = lines.filter(
        (l) => !used.has(l) && l.bottom <= c.rect.y0 && isBodyText(l, stats) && overlapX(lineRect(l), { ...c.rect, x0: col.x0, x1: col.x1 }) > 0,
      );
      const top = above.length ? Math.max(...above.map((l) => l.bottom)) + 2 : page.h * 0.06;
      crop = { x0: col.x0, y0: top, x1: Math.max(col.x1, c.rect.x1), y1: c.rect.y0 - 2 };
    }
    // Labels inside the drawing belong to the figure, not to the reading text.
    const labels: Line[] = [];
    for (const l of lines) {
      if (used.has(l)) continue;
      const lr = lineRect(l);
      const cx = (lr.x0 + lr.x1) / 2;
      const cy = (lr.y0 + lr.y1) / 2;
      const inside = cx >= crop.x0 - 2 && cx <= crop.x1 + 2 && cy >= crop.y0 - 2 && cy <= crop.y1 + 2;
      const touching = !isBodyText(l, stats) && overlapX(lr, crop) > 0.5 * (lr.x1 - lr.x0) && lr.y0 < crop.y1 + 8 && lr.y1 > crop.y0 - 8;
      if (inside || touching) labels.push(l);
    }
    for (const l of labels) {
      used.add(l);
      crop = union(crop, lineRect(l));
    }
    crop = pad(crop, 3, page);
    regions.push({
      type: "figure",
      page: page.index,
      key: c.key,
      cont: c.cont,
      rect: union(crop, c.rect),
      crop,
      captionLines: c.lines,
      contentLines: labels,
    });
  }

  // Large images without a caption, unless text is printed over them (backgrounds).
  // Chapter-opener pages (very large type) only carry decoration.
  const opener = lines.some((l) => l.size >= stats.bodySize * 2.2);
  for (const cl of opener ? [] : clusters) {
    if (takenClusters.has(cl) || area(cl) < pageArea * 0.06) continue;
    // Artwork bleeding off the page edge is decoration (chapter openers, banners).
    const edges = [cl.x0 <= 2, cl.y0 <= 2, cl.x1 >= page.w - 2, cl.y1 >= page.h - 2].filter(Boolean).length;
    if (edges >= 1) continue;
    const hasImage = candidates.some((g) => g.kind === "image" && contains(cl, g, 1));
    if (!hasImage) continue;
    const over = lines.filter((l) => !used.has(l) && overlapX(lineRect(l), cl) > 0 && overlapY(lineRect(l), cl) > 0);
    if (over.length > 2) continue;
    over.forEach((l) => used.add(l));
    const crop = pad(cl, 2, page);
    regions.push({ type: "figure", page: page.index, cont: false, rect: crop, crop, captionLines: [], contentLines: over });
  }
  return regions;
}

function pad(r: Rect, p: number, page: { w: number; h: number }): Rect {
  return { x0: Math.max(0, r.x0 - p), y0: Math.max(0, r.y0 - p), x1: Math.min(page.w, r.x1 + p), y1: Math.min(page.h, r.y1 + p) };
}

/** Lines belonging to a region, so the flow can skip them. */
export function regionLines(regions: Region[]): Set<Line> {
  const s = new Set<Line>();
  for (const r of regions) {
    r.captionLines.forEach((l) => s.add(l));
    r.contentLines.forEach((l) => s.add(l));
  }
  return s;
}

/**
 * The shaded rectangle behind a caption, extended by shapes stacked directly
 * under it (a coloured title bar on top of a lighter body, for example).
 */
function findBackground(page: PageForRegions, caption: Rect): Rect | undefined {
  const pageArea = page.w * page.h;
  const fills = page.graphics.filter((g) => g.kind === "path" && area(g) < pageArea * 0.85 && g.x1 - g.x0 > 20 && g.y1 - g.y0 > 4);
  const holder = fills.filter((g) => contains(g, caption, 2)).sort((a, b) => area(a) - area(b))[0];
  if (!holder) return undefined;
  let bg: Rect = holder;
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of fills) {
      // Shapes directly below (touching or overlapping) with the same width.
      const stacked = g.y0 <= bg.y1 + 3 && g.y0 >= bg.y0 - 1 && Math.abs(g.x0 - bg.x0) < 4 && Math.abs(g.x1 - bg.x1) < 4 && g.y1 > bg.y1 + 1;
      if (stacked) {
        bg = union(bg, g);
        grew = true;
      }
    }
  }
  return bg;
}
