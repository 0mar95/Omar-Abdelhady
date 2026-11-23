// Plain text → book blocks. Paragraphs are separated by blank lines (or, in
// files without any, by indented lines); hard-wrapped lines are joined; lines
// like "CHAPTER IV" or "Chapter 3. The Return" become chapter headings.
// Project Gutenberg's license header and footer are left out.

import type { Block, Rect } from "../model.ts";

const NO_RECT: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

const CHAPTERISH = /^(chapter|part|book|volume|section|prologue|epilogue|preface|foreword|introduction|afterword|appendix|contents)\b/i;

export function textToBlocks(input: string): { blocks: Block[]; title?: string; author?: string } {
  let text = input.replace(/\r\n?/g, "\n");
  let title: string | undefined;
  let author: string | undefined;

  // Project Gutenberg: keep only the book between the START and END markers.
  const start = /^\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG.*$/im.exec(text);
  if (start) {
    const header = text.slice(0, start.index);
    title = /^Title:\s*(.+)$/m.exec(header)?.[1]?.trim();
    author = /^Author:\s*(.+)$/m.exec(header)?.[1]?.trim();
    text = text.slice(start.index + start[0].length);
    const end = /^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG.*$/im.exec(text);
    if (end) text = text.slice(0, end.index);
  }

  const lines = text.split("\n");
  const blankLines = lines.filter((l) => !l.trim()).length;
  let paras: string[][] = [];
  if (blankLines >= Math.max(2, lines.length / 40)) {
    let cur: string[] = [];
    for (const l of lines) {
      if (!l.trim()) {
        if (cur.length) paras.push(cur);
        cur = [];
      } else cur.push(l);
    }
    if (cur.length) paras.push(cur);
  } else {
    // No blank lines: an indented line starts a paragraph; otherwise each line is one.
    const indented = lines.filter((l) => /^\s{2,}\S/.test(l)).length > lines.length / 20;
    let cur: string[] = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      if (!indented || /^\s{2,}\S/.test(l)) {
        if (cur.length) paras.push(cur);
        cur = [];
      }
      cur.push(l);
    }
    if (cur.length) paras.push(cur);
  }
  paras = paras.filter((p) => !/^[\s*·•=_-]+$/.test(p.join("")));

  const blocks: Block[] = [];
  let n = 0;
  const id = () => `p0-${n++}`;
  for (const p of paras) {
    const joined = p
      .map((l) => l.trim())
      .reduce((a, b) => (!a ? b : /[a-z]-$/.test(a) && /^[a-z]/.test(b) ? a.slice(0, -1) + b : `${a} ${b}`), "");
    const heading = headingLevel(p, joined);
    if (heading) {
      // "CHAPTER I" followed by a one-line title: one heading.
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "heading" && prev.level === 1 && /^(chapter|part|book)\s+\S+\.?$/i.test(prev.text) && heading === 2) {
        prev.text = `${prev.text}: ${tidy(joined)}`;
        continue;
      }
      blocks.push({ kind: "heading", id: id(), page: 0, rect: NO_RECT, chapter: 0, level: heading, text: tidy(joined) });
      continue;
    }
    blocks.push({ kind: "paragraph", id: id(), page: 0, rect: NO_RECT, chapter: 0, spans: [{ text: joined.replace(/\s+/g, " ") }] });
  }
  return { blocks, title, author };
}

/** Title-cases lines set in capitals ("CHAPTER IV" → "Chapter IV"). */
function tidy(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  return t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, (r) => r.toUpperCase());
}

function headingLevel(p: string[], joined: string): 1 | 2 | null {
  if (p.length > 2 || joined.length > 80) return null;
  if (CHAPTERISH.test(joined.trim())) return 1;
  // Short lines in capitals, without sentence punctuation.
  const letters = joined.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase() && !/[.!?,;]$/.test(joined.trim())) return 2;
  return null;
}
