// Rebuilds a table grid from positioned lines: column starts are found by
// clustering left edges, rows by baselines, and wrapped cells are re-joined.

import type { Span } from "../model.ts";
import type { Line } from "./lines.ts";
import { median } from "./lines.ts";
import { joinLines, type WordBook } from "./text.ts";

const NOTE_RE = /^(\*|†|‡|§|¶|Adapted|Source|Reprinted|Data from|Modified|Abbreviations?\b|Note[s:])/;

export interface TableGrid {
  rows: string[][];
  headerRows: number;
  notes: Span[][];
}

export function buildTable(input: Line[], book: WordBook): TableGrid {
  const lines = [...input].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const notes: Span[][] = [];
  let cut = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (NOTE_RE.test(lines[i].text.trim()) && lines.slice(i).every((l) => l.size <= lines[0].size + 0.3)) {
      cut = i;
      break;
    }
  }
  for (const l of lines.slice(cut)) {
    if (notes.length && !NOTE_RE.test(l.text.trim())) {
      const last = notes[notes.length - 1];
      last.push({ text: " " }, ...l.spans);
    } else notes.push([...l.spans]);
  }
  const body = lines.slice(0, cut);
  if (!body.length) return { rows: [], headerRows: 0, notes };

  const size = median(body.map((l) => l.size));
  // Column starts: cluster left edges, then merge clusters that are too close.
  const xs = body.map((l) => l.x0).sort((a, b) => a - b);
  let clusters: { x: number; n: number }[] = [];
  for (const x of xs) {
    const c = clusters[clusters.length - 1];
    if (c && x - c.x <= 5) c.n++;
    else clusters.push({ x, n: 1 });
  }
  const minSupport = body.length < 6 ? 1 : 2;
  clusters = clusters.filter((c) => c.n >= minSupport);
  const starts: number[] = [];
  for (const c of clusters) {
    if (starts.length && c.x - starts[starts.length - 1] < size * 2.2) continue;
    starts.push(c.x);
  }
  if (!starts.length) starts.push(xs[0]);
  const colOf = (l: Line) => {
    let k = 0;
    for (let i = 0; i < starts.length; i++) if (l.x0 >= starts[i] - 5) k = i;
    return k;
  };

  // Physical rows share a baseline.
  const phys: { y: number; top: number; bottom: number; cells: Map<number, Line[]> }[] = [];
  for (const l of body) {
    const row = phys.find((r) => Math.abs(r.y - l.y) < size * 0.45);
    const c = colOf(l);
    if (row) {
      const cell = row.cells.get(c) ?? [];
      cell.push(l);
      row.cells.set(c, cell);
      row.bottom = Math.max(row.bottom, l.bottom);
    } else phys.push({ y: l.y, top: l.top, bottom: l.bottom, cells: new Map([[c, [l]]]) });
  }
  phys.sort((a, b) => a.y - b.y);
  const steps = phys.slice(1).map((r, i) => r.y - phys[i].y);
  const leading = steps.length ? Math.min(median(steps), size * 1.6) : size * 1.2;

  const ncols = starts.length;
  const logical: { lines: Line[][]; allBold: boolean }[] = [];
  let prevY = -Infinity;
  for (const r of phys) {
    const gap = r.y - prevY;
    prevY = r.y;
    const first = r.cells.get(0);
    const current = logical[logical.length - 1];
    let continues = !!current && gap <= leading * 1.35;
    if (continues && first && current) {
      // A new label in the first column starts a new row, unless it reads as a
      // continuation of the previous label (lowercase start, no closing punctuation).
      const prevFirst = current.lines[0].map((l) => l.text).join(" ").trim();
      const startsLower = /^[a-z(]/.test(first[0].text.trim());
      continues = !!prevFirst && startsLower && !/[.:;]$/.test(prevFirst);
    }
    const rowBold = [...r.cells.values()].flat().every((l) => l.bold);
    if (!continues || !current) {
      const cells: Line[][] = Array.from({ length: ncols }, () => []);
      for (const [c, ls] of r.cells) cells[c].push(...ls);
      logical.push({ lines: cells, allBold: rowBold });
    } else {
      for (const [c, ls] of r.cells) current.lines[c].push(...ls);
      current.allBold = current.allBold && rowBold;
    }
  }

  const joinCell = (cell: Line[]) =>
    cell
      .sort((a, b) => a.y - b.y || a.x0 - b.x0)
      .reduce((acc, l) => {
        const t = l.text.trim();
        if (!acc) return t;
        const prevLine = acc.slice(acc.lastIndexOf("\n") + 1);
        // Short capitalised lines are list entries inside a cell: keep the break.
        const listy = /^[A-Z(•–-]/.test(t) && !/[-,;:]$/.test(prevLine) && prevLine.length < 40 && t.length < 40;
        return listy ? `${acc}\n${t}` : joinLines(acc, t, book);
      }, "");
  let headerRows = 0;
  while (headerRows < Math.min(2, logical.length - 1) && logical[headerRows].allBold) headerRows++;
  // Several bold header rows are usually one header with wrapped text.
  if (headerRows > 1) {
    const merged: Line[][] = Array.from({ length: ncols }, () => []);
    for (let i = 0; i < headerRows; i++) logical[i].lines.forEach((c, k) => merged[k].push(...c));
    logical.splice(0, headerRows, { lines: merged, allBold: true });
    headerRows = 1;
  }
  const rows = logical.map((row) => row.lines.map(joinCell));
  return { rows: rows.filter((r) => r.some((c) => c.trim())), headerRows, notes };
}
