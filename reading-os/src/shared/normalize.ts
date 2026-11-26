// The last step for every book, whatever its format: the same structural
// rules, so a PDF textbook, an EPUB novel and a Word document all come out
// shaped alike — numbered chapters, headings that never skip a level, one
// style of heading text.

import { BACK, FRONT } from "./units.ts";
import { blockText, spansText, type Block, type ContentsEntry, type HeadingBlock, type Span, type TitlePageBlock } from "./model.ts";

const CHAPTER_LABEL = /^(?:chapter|chap\.|part|book|unit|lesson|module)\s*([0-9]{1,3}|[ivxlc]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[.:—–-]?\s*(.*)$/i;
const NUMBERED = /^(\d{1,3})\.?\s+(\p{Lu}.{2,})$/u;
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "per", "the", "to", "vs", "via", "with"]);

/** "CHAPTER IV" → "Chapter IV"; "THE HYPOTHALAMUS AND PAIN" → "The Hypothalamus and Pain". */
export function tidyHeading(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  // Leftover dot leaders and page numbers ("Introduction ........ 12").
  t = t.replace(/\s*(?:[.·…]\s*){3,}\d{0,4}\s*$/, "").trim();
  // A footnote mark on a title ("Calcium Metabolism*", "Introduction†").
  t = t.replace(/(?<=\p{L})\s?[*†‡]+$/u, "");
  // A heading doesn't end in a full stop ("Loomings." → "Loomings"); abbreviations
  // and initials keep theirs ("etc.", "U.S.", "J. P.").
  if (/[^.]\.$/.test(t) && !/(?:\b\p{L}\.|\b(?:etc|al|Inc|Ltd|Co|vs|St|Dr|Mr|Mrs|Ms|No|Vol|ed|eds)\.)$/u.test(t)) t = t.slice(0, -1).trimEnd();
  const letters = t.replace(/[^\p{L}]/gu, "");
  const words = t.split(" ");
  if (letters.length >= 6 && words.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    t = words
      .map((w, i) => {
        if (/^[IVXLC]+[.:]?$/.test(w) || /\d/.test(w)) return w; // roman numerals, codes
        const lower = w.toLowerCase();
        if (i > 0 && SMALL_WORDS.has(lower.replace(/[^\p{L}]/gu, ""))) return lower;
        return lower.replace(/(^|[-‐(“"'’])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
      })
      .join(" ");
  }
  return t;
}

export function normalizeStructure(input: Block[], totalWords?: number): Block[] {
  let blocks = input.filter((b) => b.kind !== "heading" || b.text.trim());
  // A quotation set in display type (an epigraph) is not a heading.
  blocks = blocks.map((b) =>
    b.kind === "heading" && /^[“"‘«]/.test(b.text.trim()) && b.text.length > 25 && !/\b(?:chapter|part|book)\s*(?:\d{1,3}|[ivxlc]{1,7})\b/i.test(b.text)
      ? { kind: "paragraph", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, spans: [{ text: b.text, i: true }] }
      : b,
  );
  for (const b of blocks) if (b.kind === "heading") b.text = tidyHeading(b.text);
  blocks = splitGluedHeadings(blocks);
  // A piece of an equation set large ("(D1)2", "x = 2") is not a heading.
  blocks = blocks.map((b) =>
    b.kind === "heading" && (b.text.match(/\p{L}/gu) ?? []).length < 3 && /[()=+^/×÷√∑]/.test(b.text)
      ? { kind: "paragraph", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, spans: [{ text: b.text }] }
      : b,
  );

  // "Chapter 3" + the title just after it → one chapter heading, numbered 3.
  const merged: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "heading" || b.number) {
      merged.push(b);
      continue;
    }
    // A picture caption glued in front of the label: "He rode a black horse. CHAPTER III."
    const glued = /^.+[.!?]["”’]?\s+((?:chapter|part|book)\s*(?:\d{1,3}|[ivxlc]{1,7})\.?)$/i.exec(b.text);
    if (glued) b.text = tidyHeading(glued[1].replace(/\.$/, "").replace(/^(chapter|part|book)(?=[\divxlc])/i, "$1 "));
    const m = CHAPTER_LABEL.exec(b.text);
    const next = blocks[i + 1];
    if (m && !m[2].trim() && next?.kind === "heading" && next.page <= b.page + 1) {
      merged.push({ ...b, level: Math.min(b.level, next.level) as HeadingBlock["level"], number: m[1], text: next.text });
      i++;
      continue;
    }
    if (m && m[2].trim() && b.level <= 2) {
      merged.push({ ...b, number: m[1], text: m[2].trim() });
      continue;
    }
    // "Chapter 3" with its title set as an ordinary line just after it.
    if (m && !m[2].trim() && next?.kind === "paragraph" && next.page <= b.page + 1) {
      const title = next.spans.map((x) => x.text).join("").replace(/\s+/g, " ").trim();
      // (A line of names in capitals, "FRANK CELENZA", is the byline, not the title.)
      const shouting = title === title.toUpperCase() && /\p{Lu}{2}/u.test(title);
      if (titleLike(title) && !(shouting && isByline(nameCase(title)))) {
        merged.push({ ...b, number: m[1], text: tidyHeading(title) });
        i++;
        continue;
      }
    }
    const n = b.level === 1 ? NUMBERED.exec(b.text) : null;
    merged.push(n ? { ...b, number: n[1], text: n[2].trim() } : b);
  }
  blocks = merged;
  // The big number printed above a chapter title, left as a heading of its own once
  // the chapter has taken it ("1" then "1 · Brand, Retail and Competitor Research").
  blocks = blocks.filter((b, i) => {
    if (b.kind !== "heading" || !/^\d{1,3}$/.test(b.text.trim())) return true;
    const next = blocks.slice(i + 1, i + 3).find((n) => n.kind === "heading");
    return !(next && next.kind === "heading" && next.number === b.text.trim());
  });
  blocks = chapterBylines(blocks);
  // Before anything else reads headings: the chapter's own contents list would
  // otherwise pass for a page of headings, or for the first copy of each.
  blocks = dropChapterContents(blocks);

  blocks = recoverContents(blocks);
  tidyContents(blocks);
  chaptersFollowContents(blocks);
  blocks = headingOnlyPages(blocks);
  blocks = inlineAddresses(blocks);
  blocks = tidyOpening(blocks);
  // Running headers set as "1 / Introduction" (or "/" then the section's name) repeat a heading.
  {
    const n = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const headingNames = new Set(blocks.flatMap((b) => (b.kind === "heading" ? [n(b.text)] : [])));
    blocks = blocks.filter((b, i) => {
      if (b.kind !== "paragraph") return true;
      const t = spansText(b.spans).trim();
      if (t === "/") return false;
      const header = /^\d{0,3}\s*\/\s*(.{2,90})$/.exec(t);
      if (header && headingNames.has(n(header[1]))) return false;
      const prev = blocks[i - 1];
      return !(prev?.kind === "paragraph" && spansText(prev.spans).trim() === "/" && headingNames.has(n(t)));
    });
  }
  // "/ Arndt Happe, Gerd Körner" under a chapter title: the opener already names them (from the contents).
  {
    const n = (t: string) => t.toLowerCase().replace(/[^\p{L}]+/gu, "");
    const known = new Set(blocks.flatMap((b) => (b.kind === "contents" ? b.entries.flatMap((e) => (e.authors ? [n(e.authors)] : [])) : [])));
    if (known.size)
      blocks = blocks.filter((b, i) => {
        if (b.kind !== "paragraph") return true;
        const m = CHAPTER_BY.exec(spansText(b.spans).trim());
        const near = blocks.slice(Math.max(0, i - 2), i).some((x) => x.kind === "heading" && x.level === 1);
        return !(m && near && known.has(n(m[2])));
      });
  }
  // Panel letters from inside a figure ("a b", "a b c d") aren't text.
  blocks = blocks.filter((b) => !(b.kind === "paragraph" && /^(?:[a-h]\s+){0,7}[a-h]$|^(?:[A-H]\s+){0,7}[A-H]$/.test(spansText(b.spans).trim())));
  blocks = stitchSentences(blocks);

  // The same heading twice in a row (a running title repeated) shows once.
  blocks = blocks.filter((b, i) => {
    const prev = blocks[i - 1];
    return !(b.kind === "heading" && prev?.kind === "heading" && prev.text.toLowerCase() === b.text.toLowerCase());
  });

  // Before the contents page, a top-level heading with almost no text under it
  // (an advert, a dedication) isn't a chapter.
  {
    const contentsAt = blocks.findIndex((b) => b.kind === "contents");
    if (contentsAt > 0)
      blocks.forEach((b, i) => {
        if (i >= contentsAt || b.kind !== "heading" || b.level !== 1) return;
        let words = 0;
        for (let k = i + 1; k < blocks.length && !(blocks[k].kind === "heading" && (blocks[k] as HeadingBlock).level === 1); k++) words += (blockText(blocks[k]).match(/\S+/g) ?? []).length;
        if (words < 120) b.level = 2;
      });
  }

  // A long book needs chapters: if there's at most one top-level heading but
  // many at the next level, those become the chapters.
  const words = totalWords ?? blocks.reduce((a, b) => a + (blockText(b).match(/\S+/g) ?? []).length, 0);
  const headings = blocks.filter((b): b is HeadingBlock => b.kind === "heading");
  const top = headings.filter((h) => h.level === 1).length;
  const second = headings.filter((h) => h.level === 2).length;
  if (words > 15000 && top <= 1 && second >= 3) for (const h of headings) if (h.level > 1) h.level = (h.level - 1) as HeadingBlock["level"];

  // Levels never jump (a chapter's first heading is a section, not a
  // sub-sub-section), and headings that were siblings stay siblings.
  const stack: { from: number; to: number }[] = [];
  for (const b of blocks) {
    if (b.kind !== "heading") continue;
    while (stack.length && stack[stack.length - 1].from >= b.level) stack.pop();
    const parent = stack[stack.length - 1];
    const to = parent ? Math.min(b.level, parent.to + 1) : b.level;
    stack.push({ from: b.level, to });
    b.level = to as HeadingBlock["level"];
  }
  return blocks;
}

/** "JEFFREY McCLENDON" → "Jeffrey McClendon": names in capitals, written normally. */
export function nameCase(line: string): string {
  // "B ." from letter-spaced type is an initial: "B."
  const fixed = line.replace(/\b(\p{Lu}) \.(?=\s|,|$)/gu, "$1.");
  // Only a line set in capitals is re-cased: "Bailoor DN" keeps its initials.
  const lower = (fixed.match(/\p{Ll}/gu) ?? []).length;
  const upper = (fixed.match(/\p{Lu}/gu) ?? []).length;
  if (lower > upper * 0.3) return fixed;
  return fixed.replace(/(\p{L}[\p{L}'’-]*)/gu, (w) => {
    if (w.length <= 1 || /\p{Ll}/u.test(w.replace(/^(Mc|Mac)/, ""))) return w;
    const mc = /^(Mc|Mac)(?=\p{Lu})/u.exec(w)?.[1] ?? "";
    const rest = w.slice(mc.length).toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
    return mc + rest;
  });
}

/**
 * The authors printed under a chapter's title ("JEFFREY McCLENDON, JONATHAN B.
 * LEVINE") become the chapter's byline, shown with the title, not as text.
 */
export function chapterBylines(blocks: Block[]): Block[] {
  const drop = new Set<number>();
  blocks.forEach((b, i) => {
    // Numbered chapters only: a book's own title page keeps its editors.
    if (b.kind !== "heading" || b.level !== 1 || !b.number || b.byline) return;
    for (let k = i + 1; k <= i + 2 && k < blocks.length; k++) {
      const n = blocks[k];
      const isLine = n.kind === "paragraph" || (n.kind === "heading" && n.level > 1);
      if (!isLine || n.page > b.page + 1) break;
      const lineText = (x: Block) => (x.kind === "heading" ? x.text : x.kind === "paragraph" ? x.spans.map((y) => y.text).join("") : "").replace(/\s+/g, " ").trim();
      let text = lineText(n);
      if (text.split(" ").length > 16) break;
      let last = k;
      // "Bailoor DN, Nagesh KS," / "Chatra LK, Pai Keerthilatha": one byline over two lines.
      while (/,\s*$/.test(text) && blocks[last + 1] && (blocks[last + 1].kind === "paragraph" || blocks[last + 1].kind === "heading")) {
        const more = lineText(blocks[last + 1]);
        if (!isByline(nameCase(more.replace(/,\s*$/, "")))) break;
        text = `${text} ${more}`;
        last++;
      }
      const named = nameCase(text.replace(/,\s*$/, ""));
      // Clearly names: several people, initials, "by", capitals, or "Surname AB" — not just two capitalised words.
      const plain = text.replace(/,\s*$/, "");
      const clearly = /,|\b\p{Lu}\.(?:\s|$)|^by\s/u.test(plain) || (plain === plain.toUpperCase() && /\p{Lu}{2}/u.test(plain)) || SURNAME_INITIALS.test(plain);
      if (clearly && isByline(named)) {
        b.byline = named.replace(/^by\s+/i, "");
        for (let d = k; d <= last; d++) drop.add(d);
        break;
      }
    }
    if (b.byline) return;
    // Authors set above the title on the opening page ("Bailoor DN, Nagesh KS," / "Chatra LK, …").
    const above: number[] = [];
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
      const n = blocks[k];
      if (n.page !== b.page || !(n.kind === "paragraph" || (n.kind === "heading" && n.level > 1)) || drop.has(k)) break;
      above.unshift(k);
    }
    for (let from = 0; from < above.length; from++) {
      const text = above
        .slice(from)
        .map((k) => {
          const n = blocks[k];
          return (n.kind === "heading" ? n.text : n.kind === "paragraph" ? n.spans.map((y) => y.text).join("") : "").replace(/\s+/g, " ").trim();
        })
        .join(" ")
        .replace(/,\s*$/, "");
      if (text.split(" ").length > 16) continue;
      const clearly = /,|\b\p{Lu}\.(?:\s|$)|^by\s/u.test(text) || (text === text.toUpperCase() && /\p{Lu}{2}/u.test(text));
      if (clearly && isByline(nameCase(text))) {
        b.byline = nameCase(text).replace(/^by\s+/i, "");
        for (const k of above.slice(from)) drop.add(k);
        break;
      }
    }
  });
  return drop.size ? blocks.filter((_, i) => !drop.has(i)) : blocks;
}

/**
 * Two numbered headings set on consecutive lines and read as one
 * ("2.4.2 Condylar pattern 2.4.2.1 Condyle of the bolus side") become two,
 * the second a level deeper.
 */
export function splitGluedHeadings(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    let cur: Block = b;
    for (;;) {
      if (cur.kind !== "heading") break;
      const m = /^(\d+(?:\.\d+){0,5}\s+.*?\S)\s+(\d+(?:\.\d+){1,5})\s+(\p{Lu}.*)$/u.exec(cur.text);
      const first = m && /^(\d+(?:\.\d+)*)/.exec(m[1])![1];
      // The second number must continue the first ("2.4.2" → "2.4.2.1" or "2.4.3").
      if (!m || !first || !m[2].startsWith(first.split(".").slice(0, -1).join(".")) || m[2] === first) break;
      out.push({ ...cur, text: m[1] });
      const deeper = m[2].split(".").length > first.split(".").length;
      cur = { ...cur, id: `${cur.id}-2`, text: `${m[2]} ${m[3]}`, level: Math.min(4, cur.level + (deeper ? 1 : 0)) as HeadingBlock["level"] };
    }
    out.push(cur);
  }
  return out;
}

/**
 * "Chapter 1 Introductory Explanation" → number 1, title "Introductory Explanation"
 * (after bookmarks are applied). When the page's own heading with the same title
 * follows straight after, the two are one heading.
 */
export function numberChapterHeadings(blocks: Block[]): Block[] {
  const drop = new Set<number>();
  blocks.forEach((b, i) => {
    if (b.kind !== "heading" || b.level !== 1 || b.number) return;
    const m = CHAPTER_LABEL.exec(b.text);
    if (!m || !m[2].trim()) return;
    b.number = m[1];
    b.text = m[2].trim();
    for (let k = i + 1; k < blocks.length && k <= i + 3; k++) {
      const n = blocks[k];
      if (n.kind === "heading" && key(n.text) === key(b.text)) {
        drop.add(k);
        break;
      }
      if (n.kind !== "figure") break;
    }
  });
  const out = drop.size ? blocks.filter((_, i) => !drop.has(i)) : blocks;
  sectionsUnderNumberedChapters(out);
  return out;
}

/**
 * A chapter printed with an earlier chapter's title (a publisher's slip, repeated
 * on its opener, running heads and contents) is named from its own opening:
 * "This chapter reviews vascular and nonvascular intracranial sources of
 * orofacial pain, …" → "Vascular and Nonvascular Intracranial Sources of
 * Orofacial Pain". The printed title is kept in `printed`.
 */
export function retitleRepeatedChapters(blocks: Block[]): void {
  const seen = new Set<string>();
  blocks.forEach((b, i) => {
    if (b.kind !== "heading" || b.level !== 1) return;
    const k = key(b.text);
    if (!seen.has(k)) return void seen.add(k);
    for (let j = i + 1; j < blocks.length && j <= i + 8; j++) {
      const n = blocks[j];
      if (n.kind === "heading" && n.level <= 2) break;
      const m = CHAPTER_AIM.exec(blockText(n));
      if (!m) continue;
      const words = m[1].replace(/^(?:both|the|all|several|some|various)\s+/i, "").trim().split(/\s+/);
      if (words.length < 2 || words.length > 12) break;
      b.printed = b.text;
      b.text = words.map((w, x) => (x > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
      return;
    }
  });
}

/**
 * The book's chapter titles, made consistent: "5. Orofacial Complex" is
 * chapter 5; a title set in lower case ("the Problem of Universals") starts
 * with a capital; and when most chapters carry numbers, the ones that lost
 * theirs (chapter 1 printed without its label, say) get them back — but only
 * when every numbered chapter agrees with its place in the book.
 */
export function settleChapterNumbers(blocks: Block[], bookTitle?: string): void {
  const tops = blocks.filter((b): b is HeadingBlock => b.kind === "heading" && b.level === 1);
  // "2 Pathology of Teeth": a bare number in front is the chapter's when several chapters have one.
  const LEAD = /^(\d{1,3})[.:]?\s+(\p{Lu}.{2,})$/u;
  const bare = tops.filter((h) => !h.number && LEAD.test(h.text)).length >= 2;
  for (const h of tops) {
    if (!h.number) {
      const m = (bare ? LEAD : /^(\d{1,3})[.:]\s+(\p{Lu}.{2,})$/u).exec(h.text);
      if (m) {
        h.number = m[1];
        h.text = m[2].trim();
      }
    }
    h.text = capitalized(h.text);
  }
  const same = (t: string) => !!bookTitle && key(t) === key(bookTitle);
  const core = tops.filter((h) => !FRONT.test(h.text) && !BACK.test(h.text) && !same(h.text));
  const numbered = core.filter((h) => h.number && /^\d+$/.test(h.number));
  // Two numbered chapters that each sit exactly at their place are enough to go by.
  if (numbered.length < 2 || numbered.length === core.length) return;
  const offset = Number(numbered[0].number) - core.indexOf(numbered[0]);
  if (!numbered.every((h) => Number(h.number) - core.indexOf(h) === offset)) return;
  // Chapters after the last number are only filled while the book keeps counting up to the end.
  core.forEach((h, k) => {
    const n = k + offset;
    if (!h.number && n >= 1) h.number = String(n);
  });
}

/** "the Problem of Universals" → "The Problem of Universals"; "color atlas of oral diseases" → "Color Atlas of Oral Diseases"; "APPENDIX" → "Appendix". */
function capitalized(t: string): string {
  const words = t.split(" ");
  if (/^\p{Lu}{4,}$/u.test(t)) return t.charAt(0) + t.slice(1).toLowerCase();
  if (words.length >= 2 && t === t.toLowerCase() && /\p{L}/u.test(t))
    return words.map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  if (/^\p{Ll}/u.test(t) && SMALL_WORDS.has(words[0])) return t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

const CHAPTER_AIM =
  /\b(?:this|the present) chapter (?:reviews|discusses|covers|describes|focuses on|addresses|examines|presents|explores|outlines|introduces|deals with|considers|summarizes|is about|provides an overview of)\s+([^.,;:()]+?)(?:[.,;:(]| that | which | in (?:detail|depth)\b)/i;

const BACK_MATTER = /^(?:references|bibliography|further reading|index|glossary|appendix|appendices|notes|acknowledg|about the author|abbreviations|answers)/i;

/**
 * In a book whose chapters are numbered, an unnumbered top-level heading
 * between two numbered chapters ("Introduction", "Metaphysics") is a section
 * of the chapter before it. Back matter after the last chapter stays on top.
 */
export function sectionsUnderNumberedChapters(blocks: Block[]): void {
  const numbered = blocks.map((b, i) => (b.kind === "heading" && b.level === 1 && b.number ? i : -1)).filter((i) => i >= 0);
  if (numbered.length < 3) return;
  const first = numbered[0];
  for (let i = first + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "heading" || b.level !== 1 || b.number) continue;
    if (BACK_MATTER.test(b.text)) continue;
    // After the last numbered chapter, only headings that read as its sections move down.
    if (i > numbered[numbered.length - 1] && /^(?:part|section)\b/i.test(b.text)) continue;
    b.level = 2;
  }
}

/** "JONATHAN B. LEVINE, SIVAN FINKEL": a line of authors (not a "3 / Names" contents line). */
function authorLine(t: string): boolean {
  return !!t && !t.includes("/") && t.split(/\s+/).length <= 16 && /,/.test(t) && isByline(nameCase(t));
}

/** A line that reads as a title: short, capitalised, not a sentence. */
function titleLike(t: string): boolean {
  const words = t.split(" ").length;
  return t.length >= 3 && t.length <= 110 && words <= 14 && /^[\p{Lu}\d“"‘']/u.test(t) && !/[.,;:]$/.test(t) && !/\b(?:is|are|was|were)\b.*\b(?:the|a)\b.*\b\w+ed\b/.test(t);
}

const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * A chapter's own little contents list at its start ("The biologic model",
 * "55 The neutral zone", "66 Seven line FEE analysis 69 The ‘FEE appliance’…",
 * "82"): lines that only repeat headings found later in the chapter, with or
 * without page numbers. Kenning shows its own list, so they go — when there
 * are at least three, so a single real heading is never taken.
 */
export function dropChapterContents(blocks: Block[]): Block[] {
  const drop = new Set<number>();
  const starts = blocks.map((b, i) => (b.kind === "heading" && b.level === 1 ? i : -1)).filter((i) => i >= 0);
  for (let c = 0; c < starts.length; c++) {
    const from = starts[c];
    const to = starts[c + 1] ?? blocks.length;
    const later = new Map<string, number[]>();
    for (let k = from + 1; k < to; k++) {
      const b = blocks[k];
      if (b.kind === "heading") later.set(key(b.text), [...(later.get(key(b.text)) ?? []), k]);
    }
    // Is `t` made of later headings (other than block k itself), separated by page numbers?
    const isList = (t: string, k: number) => {
      // Dot leaders, and dots that stand in for spaces ("Clinical .considerations").
      const tokens = t
        .replace(/(?:\s*\.){3,}\s*/g, " ")
        .replace(/\s\.(?=\p{L})/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ");
      const num = (w: string) => /^\d{1,4}$/.test(w);
      let a = 0;
      while (a < tokens.length && num(tokens[a])) a++;
      if (a >= tokens.length) return 0;
      // Numbers can end a title ("Clinical case 3 1") or be the page number after it.
      const z = tokens.length;
      // Read it as entries ending at page numbers (titles may hold numbers too,
      // "Clinical case 3 1"): best[i] = most entries matching a later heading.
      const best: ({ hit: number; all: number } | null)[] = new Array(z + 1).fill(null);
      best[a] = { hit: 0, all: 0 };
      for (let i = a; i < z; i++) {
        const from = best[i];
        if (!from) continue;
        for (let j = i + 1; j <= z; j++) {
          if (j < z && !num(tokens[j])) continue;
          const at = later.get(key(tokens.slice(i, j).join(" ")));
          const hit = at?.some((x) => x > k) ? 1 : 0;
          const next = { hit: from.hit + hit, all: from.all + 1 };
          // A page number follows the title (and may be the last token).
          const to = j < z ? j + 1 : z;
          const cur = best[to];
          if (!cur || next.hit > cur.hit || (next.hit === cur.hit && next.all < cur.all)) best[to] = next;
          if (j < z && to <= z) {
            const stay = best[j];
            if (!stay || next.hit > stay.hit) {
              /* the number may also end the line: handled when j reaches z */
            }
          }
        }
      }
      const end = best[z];
      if (!end || !end.hit) return null;
      // Most entries are the chapter's own headings (a book's list and its headings can differ a little).
      return end.hit >= end.all * 0.6 ? end.hit : null;
    };
    const found: number[] = [];
    let entries = 0;
    for (let k = from + 1; k < to; k++) {
      const b = blocks[k];
      if (b.kind === "figure" || b.kind === "about") continue;
      // A chapter heading is never part of a contents list (and ends the opening).
      if (b.kind === "heading" && (b.level === 1 || b.number)) break;
      // A contents block listing the chapter's own sections.
      if (b.kind === "contents") {
        const hits = b.entries.filter((e) => (isList(e.title, k) ?? 0) > 0).length;
        if (hits >= Math.max(2, b.entries.length * 0.6)) {
          found.push(k);
          entries += hits;
          continue;
        }
        break;
      }
      const t = b.kind === "heading" ? b.text : b.kind === "paragraph" ? b.spans.map((x) => x.text).join("") : null;
      if (t === null) break;
      let n = isList(t, k);
      // An entry wrapping onto the next line: read it with the line before.
      const bare = t.replace(/(?:\s*\.){2,}\s*/g, " ").replace(/\s\.(?=\p{L})/gu, " ").trim();
      if (n === null && found[found.length - 1] === k - 1 && bare.split(/\s+/).length <= 12 && !/[!?]$|\p{L}\.$/u.test(bare)) {
        const prev = blocks[k - 1];
        const before = prev.kind === "heading" ? prev.text : prev.kind === "paragraph" ? prev.spans.map((x) => x.text).join("") : "";
        const joined = isList(`${before} ${t}`, k);
        if (joined !== null && joined > (isList(before, k) ?? 0)) n = joined - (isList(before, k) ?? 0);
      }
      if (n !== null) {
        found.push(k);
        entries += n;
        continue;
      }
      // Bylines and the chapter's title lines sit among them; body text ends the opening.
      if (t.split(/\s+/).length > 25) break;
    }
    if (entries >= 3) for (const k of found) drop.add(k);
  }
  return drop.size ? blocks.filter((_, i) => !drop.has(i)) : blocks;
}

// Words only a copyright / cataloguing page uses.
const IMPRINT = [
  /\bISBN\b/i,
  /library of congress/i,
  /british library/i,
  /cataloging|cataloguing/i,
  /all rights reserved/i,
  /(?:©|\(c\)|copyright)\s*(?:©\s*)?(?:19|20)\d\d/i,
  /first published|this edition (?:first )?published|reprinted/i,
  /printed (?:and bound )?in\b/i,
  /no part of this (?:publication|book)/i,
  /\bpermission\b.*\bpublisher\b/i,
  /permission is granted to copy/i,
  // The publisher's advert for the e-book edition, on a page of its own.
  /activate the e-?book/i,
  /\bredeem\b/i,
  /scratch off|peel off/i,
  /\b(?:pin|access) code\b/i,
  /expert ?consult|evolve\.elsevier|vitalsource|inkling/i,
  /any screen\. any time/i,
  /creative commons|gnu free documentation licen[cs]e/i,
  /typeset|set in \d/i,
];

/**
 * The opening pages read like a book's, whatever the source: the copyright
 * and cataloguing page folds into one "Publication details" block, and the
 * title pages keep a single title — the title repeated on the half-title
 * page and the names and degrees under it are text, not chapters.
 */
export function tidyOpening(blocks: Block[]): Block[] {
  if (!blocks.length) return blocks;
  const firstPage = blocks[0].page;
  const pages = new Map<number, Block[]>();
  for (const b of blocks) {
    if (b.page - firstPage > 30) break;
    pages.set(b.page, [...(pages.get(b.page) ?? []), b]);
  }
  // Imprint pages: early pages that hit several imprint markers.
  const imprint = new Set<number>();
  for (const [page, bs] of pages) {
    if (bs.some((b) => b.kind === "contents")) continue;
    const text = bs.map(blockText).join("\n");
    const opensWith = bs.find((b) => blockText(b).trim())?.kind ? blockText(bs.find((b) => blockText(b).trim())!).trim() : "";
    // (Copyright and advert pages are short: a whole book on one "page" — plain text — never is.)
    if ((text.match(/\S+/g) ?? []).length > 700) continue;
    if (IMPRINT.filter((re) => re.test(text)).length >= 2 || /^disclaimer\b/i.test(opensWith)) imprint.add(page);
  }
  // The title pages: everything before the imprint or contents page, if it comes early.
  const contentsAt = blocks.find((b) => b.kind === "contents" && b.page - firstPage <= 30)?.page;
  // Title pages may sit either side of a disclaimer or copyright page: they run up to the last one.
  const firstImprint = imprint.size ? Math.max(...[...imprint].filter((p) => p - firstPage <= 12), Math.min(...imprint)) : undefined;
  // (A preface or foreword before a late contents page keeps its heading.)
  const openingEnd = firstImprint ?? (contentsAt !== undefined && contentsAt - firstPage <= 8 ? contentsAt : Infinity);
  if (!imprint.size && openingEnd === Infinity) return blocks;
  // Title pages hold short lines: a page with real paragraphs isn't one (a paper's first page, a disclaimer).
  const prosePages = new Set(blocks.filter((b) => b.page < openingEnd && b.kind === "paragraph" && (spansText(b.spans).match(/\S+/g) ?? []).length > 60).map((b) => b.page));
  // …and once the book itself has begun (a paper's abstract on page one), there are no title pages.
  const composeTitle = !prosePages.has(firstPage);

  const out: Block[] = [];
  const seen = new Set<string>();
  const opening: { text: string; heading: boolean }[] = [];
  let titlePage: TitlePageBlock | null = null;
  let folded: Block & { kind: "imprint" } | null = null;
  for (const b of blocks) {
    if (imprint.has(b.page) && b.kind !== "figure") {
      const lines = blockLines(b).filter((l) => /[\p{L}\p{N}]{2,}/u.test(l));
      if (!folded) {
        folded = { kind: "imprint", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, lines: [] };
        out.push(folded);
      }
      for (const l of lines) {
        const prev = folded.lines[folded.lines.length - 1];
        // Rejoin lines a narrow page broke apart ("The" / "LATEX" / "source").
        if (prev && !/[.:;)\]]$/.test(prev) && (/^\p{Ll}/u.test(l) || prev.split(" ").length <= 3 || /\/$/.test(prev)))
          folded.lines[folded.lines.length - 1] = prev + (/\/$/.test(prev) ? "" : " ") + l;
        else folded.lines.push(l);
      }
      continue;
    }
    // The title pages become one composed title page.
    if (composeTitle && b.page < openingEnd && !prosePages.has(b.page) && (b.kind === "heading" || b.kind === "paragraph" || b.kind === "list" || b.kind === "figure")) {
      if (!titlePage) {
        titlePage = { kind: "titlepage", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, title: "", details: [] };
        out.push(titlePage);
      }
      if (b.kind === "figure") {
        if (b.image && !titlePage.cover) titlePage.cover = b.image;
        continue;
      }
      for (const text of blockLines(b)) {
        const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        if (!key || seen.has(key)) continue; // the half-title page repeats the title page
        seen.add(key);
        opening.push({ text, heading: b.kind === "heading" });
      }
      continue;
    }
    out.push(b);
  }
  if (titlePage) composeTitlePage(titlePage, opening);
  return out;
}

const EDITION = /\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|new)\s+edition\b|\bedition\b|\bversion\s+\d|^vol(?:ume|\.)\s*(?:\d+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
/** Words in a degree list: "DDS", "PhD", "Dr med dent", "FRCS (OMFS)". */
const DEGREE = /^(?:\(?[A-Z][A-Za-z]{0,5}\.?\)?|Dr|Prof|med|dent|dent\.|habil|rer|nat|PD|MSc|BSc|PhD|MDSc|BDSc)$/;
/** Words that start a label, never a person's name ("Volume Two", "Part One"). */
const NOT_A_NAME = /^(?:volume|vol\.?|part|book|edition|series|chapter|section|unit|module|appendix)\b|\b(?:professor|lecturer|university|college|school|department|hospital|institute|clinic|dean|chairman|director|consultant|emeritus|distinguished|associate|assistant|private|practice|faculty|center|centre)\b/i;
const BY_LINE = /^(?:(?:edited|written|compiled|illustrated)\s+)?by:?$|^editors?:?$|^authors?:?$/i;
const NAME = /^(?:(?:Dr|Prof|Professor|Sir|Dame)\.?\s+)?\p{Lu}[\p{L}'’.-]*(?:\s+(?:(?:van|von|de|da|del|di|le|la|du|bin|al)\s+)?\p{Lu}[\p{L}'’.-]*){1,3}$/u;
const PUBLISHER = /\b(?:press|publishing|publishers?|wiley|elsevier|springer|quintessence|thieme|mosby|saunders|lippincott|mcgraw|routledge|penguin|harper|\bltd\b|\binc\b)/i;

/** Names only: "Mark Greenwood | Ian Corbett", "Allen B. Downey". */
/** "Bailoor DN", "Pai K": a surname and initials, as some books list authors. */
const SURNAME_INITIALS = /^\p{Lu}[\p{Ll}'’-]+(?:\s\p{Lu}[\p{Ll}'’-]+)?\s\p{Lu}{1,3}$/u;

export function isByline(line: string): boolean {
  const parts = line
    .replace(/^by\s+/i, "")
    .split(/\s*(?:\||,|&|;|\band\b|·)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.length <= 6 && parts.every((p) => (NAME.test(p) || SURNAME_INITIALS.test(p)) && !PUBLISHER.test(p) && !NOT_A_NAME.test(p));
}

/** "Gary D. Klasser, DMD" → "Gary D. Klasser"; null when the line isn't a person. */
export function personName(line: string): string | null {
  // "Arndt Happe, DDS, Dr med dent": the name, then a comma, then degrees.
  const comma = line.indexOf(",");
  if (comma > 0) {
    const head = line.slice(0, comma).trim();
    const rest = line.slice(comma + 1).trim();
    if (NAME.test(head) && !PUBLISHER.test(head) && !NOT_A_NAME.test(head) && rest.split(/[\s,]+/).every((w) => !w || DEGREE.test(w))) return head;
  }
  const name = line.replace(/,?\s*(?:\b(?:[A-Z][A-Za-z]{0,3}\.?){1,4}(?:\s*\([A-Z]+\))?\s*,?\s*)+$/, (m) => (/[A-Z]{2}|PhD|MSc|BSc|MDSc|BDSc/.test(m) ? "" : m)).trim();
  return NAME.test(name) && !PUBLISHER.test(name) && !NOT_A_NAME.test(name) ? name : null;
}

const SECTION_LABEL = /^(?:contributors?|contributing authors|with contributions? (?:from|by)|foreword by|illustrations? by|reviewers?):?$/i;
const SPLIT_EDITION = /^(.{6,}?)[,:;–—-]\s*((?:[\p{L}\d]+\s+)?edition\b.*)$/iu;

/** Title, subtitle, authors, edition and publisher from the title pages' lines. */
function composeTitlePage(tp: TitlePageBlock, lines: { text: string; heading: boolean }[]): void {
  const used = new Set<number>();
  const take = (i: number) => (used.add(i), lines[i].text);
  // The title is the first thing the title pages say (not a label, name or edition).
  let titleAt = lines.findIndex((l) => !BY_LINE.test(l.text) && !EDITION.test(l.text) && !PUBLISHER.test(l.text) && l.text.length <= 140);
  if (titleAt < 0) titleAt = 0;
  // An author's name set above the title: the title is the heading just after it.
  if (personName(lines[titleAt]?.text ?? "") && !lines[titleAt].heading && lines[titleAt + 1]?.heading) titleAt++;
  tp.title = lines.length ? take(titleAt) : "";
  // A title set over several lines ("Essentials of" / "Esthetic" / "Dentistry").
  while (lines[titleAt + 1] && !used.has(titleAt + 1)) {
    const next = lines[titleAt + 1].text;
    const words = next.split(/\s+/);
    const dangling = SMALL_WORDS.has(tp.title.split(/\s+/).pop()!.toLowerCase());
    const fragment = words.length <= 2 && words.every((w) => /^\p{Lu}/u.test(w)) && tp.title.split(/\s+/).length + words.length <= 7;
    // "Techniques for Success with Implants" / "in the Esthetic Zone": a lower-case run-on.
    const runOn = /^(?:in|of|for|and|with|on|to|at|from|the|a|an)\s/u.test(next) && words.length <= 6;
    if (!(dangling || fragment || runOn) || EDITION.test(next) || BY_LINE.test(next) || personName(next) || PUBLISHER.test(next)) break;
    tp.title = `${tp.title} ${take(++titleAt)}`;
  }
  tp.title = tidyHeading(tp.title);
  // A cover's display capitals inside a title ("Techniques for SUCCESS WITH IMPLANTS in …").
  const caps = tp.title.split(" ").filter((w) => /^\p{Lu}{4,}$/u.test(w));
  if (caps.length >= 2) tp.title = tp.title.replace(/\b\p{Lu}{2,}\b/gu, (w) => (SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w[0] + w.slice(1).toLowerCase()));
  // Lines that only repeat part of the title (a half-title page set differently) go.
  const flat = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  lines.forEach((l, i) => {
    if (!used.has(i) && flat(l.text).length >= 4 && flat(tp.title).includes(flat(l.text))) used.add(i);
  });
  let subAt = titleAt + 1;
  while (used.has(subAt)) subAt++;
  const sub = lines[subAt];
  if (sub && sub.text.length <= 160 && !BY_LINE.test(sub.text) && !SECTION_LABEL.test(sub.text) && !personName(sub.text) && !PUBLISHER.test(sub.text)) {
    const split = SPLIT_EDITION.exec(sub.text);
    if (split) {
      used.add(subAt);
      tp.subtitle = split[1].trim();
      tp.edition = split[2].trim();
    } else if (!EDITION.test(sub.text)) tp.subtitle = take(subAt);
  }
  // Edition and volume ("Seventh Edition · Volume Two").
  const eds = tp.edition ? [tp.edition] : [];
  lines.forEach((l, i) => {
    if (!used.has(i) && EDITION.test(l.text) && l.text.length < 60 && !eds.some((e) => e.toLowerCase() === l.text.toLowerCase())) eds.push(take(i));
  });
  if (eds.length) tp.edition = eds.map(tidyHeading).join(" · ");
  // Names: a line of names, or the people listed after "Edited by" / "Editors".
  let names: string[] = [];
  let collecting = false;
  let since = 0; // lines since the last name: degrees and affiliations come between editors
  lines.forEach((l, i) => {
    if (used.has(i)) return;
    if (BY_LINE.test(l.text)) {
      used.add(i);
      if (/edit/i.test(l.text)) tp.edited = true;
      collecting = !names.length;
      return;
    }
    if (SECTION_LABEL.test(l.text)) {
      collecting = false;
      return;
    }
    const person = personName(l.text);
    if (collecting && person) {
      names.push(person);
      used.add(i);
      since = 0;
      return;
    }
    if (collecting && names.length && (++since > 8 || PUBLISHER.test(l.text))) collecting = false;
    if (!names.length && isByline(l.text)) {
      names = l.text.replace(/^by\s+/i, "").split(/\s*(?:\||&|;|·|\band\b)\s*/).filter(Boolean);
      used.add(i);
    } else if (!tp.publisher && PUBLISHER.test(l.text) && l.text.length < 80) {
      tp.publisher = take(i);
      // "JAYPEE BROTHERS" / "MEDICAL PUBLISHERS (P) LTD": a name set over two lines.
      const above = lines[i - 1];
      if (above && !used.has(i - 1) && above.text === above.text.toUpperCase() && /\p{Lu}{3}/u.test(above.text) && above.text.split(" ").length <= 4) {
        used.add(i - 1);
        tp.publisher = `${above.text} ${tp.publisher}`;
      }
      tp.publisher = tidyHeading(tp.publisher);
    }
  });
  if (names.length) tp.byline = [...new Set(names)].join(" · ");
  if (tp.subtitle) tp.subtitle = tidyHeading(tp.subtitle);
  // Everything else (affiliations, degrees, contributors) stays, quietly, behind a fold.
  tp.details = lines.filter((_, i) => !used.has(i)).map((l) => l.text);
}

const ADDRESS = /^(?:https?:\/\/|\/\/|www\.)\S+$|^[\w.-]+\.(?:com|org|net|edu|io|gov|ac\.uk|co\.uk)(?:\/\S*)?\.?$/i;

/**
 * A web address set on a line of its own in a typewriter font is part of the
 * sentence around it, not a program listing.
 */
function inlineAddresses(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const line = b.kind === "code" && b.lines.length === 1 ? b.lines[0].trim() : "";
    if (!line || !ADDRESS.test(line)) {
      out.push(b);
      continue;
    }
    const prev = out[out.length - 1];
    const prevText = prev?.kind === "paragraph" ? spansText(prev.spans).trimEnd() : "";
    if (prev?.kind === "paragraph" && prevText && !/[.!?]["”’)]*$/.test(prevText)) {
      const tight = /https?:$/.test(prevText); // "https:" + "//example.org" broken across lines
      const last = prev.spans[prev.spans.length - 1];
      if (tight) last.text = last.text.trimEnd();
      else if (!/\s$/.test(last.text)) prev.spans.push({ text: " " });
      if (tight && last.code) last.text += line;
      else prev.spans.push({ text: line, code: true });
      continue;
    }
    out.push({ kind: "paragraph", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, spans: [{ text: line, code: true }] });
  }
  return out;
}

function blockLines(b: Block): string[] {
  if (b.kind === "list") return b.items.map((it, i) => `${i + 1}. ${spansText(it).trim()}`);
  return blockText(b)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const ENDED = /[.!?:;]["”’)\]]*$/;
/** "term: definition" entries (glossaries) begin in lower case on purpose. */
const TERM = /^\p{Ll}[\p{L}\p{N} '’-]{0,40}:\s/u;
const INTERRUPTIONS = new Set(["figure", "table", "box", "code", "callout"]);

/**
 * A paragraph that starts in lower case continues a sentence: join it to the
 * nearest unfinished paragraph (or list item) before it, past any figure,
 * table or box set in between. Covers sentences broken by a box, a column
 * or page break, or a sidebar with loose lines.
 */
function stitchSentences(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const text = b.kind === "paragraph" ? spansText(b.spans).trim() : "";
    if (b.kind === "paragraph" && !b.small && /^[\p{Ll}]/u.test(text) && !TERM.test(text) && !/^(e\.g\.|i\.e\.|et al|vs\.|www\.|http)/i.test(text)) {
      let j = out.length - 1;
      let skipped = 0;
      while (j >= 0 && INTERRUPTIONS.has(out[j].kind) && skipped < 4) {
        j--;
        skipped++;
      }
      const q = out[j];
      if (q && q.kind === "paragraph" && !q.small && !ENDED.test(spansText(q.spans).trim())) {
        joinSpans(q.spans, b.spans);
        continue;
      }
      if (q && q.kind === "list" && q.items.length && !ENDED.test(spansText(q.items[q.items.length - 1]).trim())) {
        joinSpans(q.items[q.items.length - 1], b.spans);
        continue;
      }
    }
    out.push(b);
  }
  return out;
}

function joinSpans(into: Span[], more: Span[]): void {
  const last = into[into.length - 1];
  if (last && /\p{Ll}-$/u.test(last.text)) last.text = last.text.slice(0, -1); // a line-break hyphen
  else if (last && !/\s$/.test(last.text)) into.push({ text: " " });
  for (const s of more) into.push({ ...s, text: into.length && s === more[0] ? s.text.replace(/^\s+/, "") : s.text });
}

/**
 * A figure sits right after the paragraph that first mentions it — not
 * wherever the page layout happened to put it — as long as that mention is
 * close by (within two pages) and in the same chapter. Needs links (xref).
 */
export function placeFigures(blocks: Block[]): Block[] {
  const mention = new Map<string, number>();
  blocks.forEach((b, i) => {
    const spans = b.kind === "paragraph" ? b.spans : b.kind === "list" ? b.items.flat() : [];
    for (const s of spans) if (s.xref && !mention.has(s.xref)) mention.set(s.xref, i);
  });
  const chapterAt: number[] = [];
  let ch = 0;
  blocks.forEach((b, i) => {
    if (b.kind === "heading" && b.level === 1) ch++;
    chapterAt[i] = ch;
  });
  const moving = new Map<number, number>(); // figure index → mention index
  blocks.forEach((b, i) => {
    if (b.kind !== "figure" || !b.key) return;
    const m = mention.get(b.key);
    if (m === undefined || m === i - 1) return;
    if (Math.abs(blocks[m].page - b.page) > 2 || chapterAt[m] !== chapterAt[i]) return;
    // Already shortly after its mention, past only other figures: leave it.
    if (i > m && blocks.slice(m + 1, i).every((x) => x.kind === "figure" || x.kind === "table")) return;
    moving.set(i, m);
  });
  if (!moving.size) return blocks;
  const after = new Map<number, Block[]>();
  for (const [f, m] of moving) after.set(m, [...(after.get(m) ?? []), blocks[f]]);
  const out: Block[] = [];
  blocks.forEach((b, i) => {
    if (moving.has(i)) return;
    out.push(b);
    const figs = after.get(i);
    if (figs) out.push(...figs);
  });
  return out;
}

/**
 * The book's name: the file's own title, unless the title page says
 * otherwise (PDF metadata often holds a chapter name, like "Preface").
 */
export function bookTitle(blocks: Block[], metaTitle: string | undefined): string | undefined {
  const tp = blocks.find((b): b is TitlePageBlock => b.kind === "titlepage");
  const meta = cleanTitle(metaTitle?.trim());
  // Text from a font without a character table comes out as symbols: then the file's own title is better.
  if (tp?.title && (tp.title.match(/[$%*!"#&'()+]/g) ?? []).length > tp.title.length * 0.1) tp.title = meta ?? "";
  const page = tp?.title?.trim();
  if (!page) return meta || undefined;
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (meta && n(meta).includes(n(page))) return meta;
  return tp?.subtitle && page.length < 30 ? `${page}: ${tp.subtitle}`.slice(0, 120) : page;
}

const PAGE_NO = /^(?:\d{1,4}|[ivxlc]{1,7})$/i;
/** "1 / Arndt Happe, Gerd Körner" or "/ Arndt Happe": a chapter's number and authors. */
const CHAPTER_BY = /^(\d{1,3})?\s*\/\s*(\p{Lu}.+)$/u;
const CONTENTS_WORD = /^(?:table of )?contents$/i;

/**
 * Contents pages set like a magazine — each title on its own line, its page
 * number set apart, the chapter number and authors ("2 / Arndt Happe") on a
 * line of their own — read as loose headings and numbers. Early in the book,
 * a run of short lines and page numbers like that becomes a proper contents
 * block. Page numbers go to the titles in order; author lines go with the
 * title they belong to (the one above, unless the run opens with them).
 */
export function recoverContents(input: Block[]): Block[] {
  if (!input.length) return input;
  // A contents block that caught only the first few lines carries on into the loose lines after it.
  const startedAt = input.findIndex((b) => b.kind === "contents");
  const started = startedAt >= 0 ? input[startedAt] : null;
  if (started?.kind === "contents" && started.entries.length >= 6) return input;
  const firstPage = input[0].page;
  const textOf = (b: Block) => (b.kind === "heading" ? b.text : b.kind === "paragraph" ? spansText(b.spans) : "").replace(/\s+/g, " ").trim();
  const blocks = input;
  // With a "Contents" heading early on, the contents start on its page.
  const word = blocks.find((b) => b.page - firstPage <= 30 && CONTENTS_WORD.test(textOf(b)));
  for (let i = started ? startedAt + 1 : 0; i < blocks.length && blocks[i].page - firstPage <= 30; i++) {
    if (word && blocks[i].page < word.page) continue;
    if (started && i > startedAt + 1) break;
    // A chapter's own section list follows its byline: that's not the book's contents.
    if (authorLine(textOf(blocks[i])) || (i > 0 && authorLine(textOf(blocks[i - 1])))) continue;
    // Take the run: short headings/paragraphs, page numbers and "N / Authors" lines.
    let j = i;
    let numbers = 0;
    while (j < blocks.length) {
      const b = blocks[j];
      const t = textOf(b);
      if ((b.kind !== "heading" && b.kind !== "paragraph") || !t || t.length > 150 || (b.kind === "paragraph" && /[.!?]$/.test(t) && t.split(" ").length > 10)) break;
      // A chapter's opening page ("Chapter 1" heading on a new page) ends the contents.
      const label = b.kind === "heading" ? CHAPTER_LABEL.exec(t) : null;
      if (label && !label[2].trim() && j > i && b.page > blocks[j - 1].page) break;
      // A chapter opener's byline ("JONATHAN B. LEVINE, SIVAN FINKEL") is not a contents line:
      // contents pages give authors as "3 / Names" after a title.
      // (Unless it continues the authors on the line before: "…Tal Morr," / "Vincent Fehmer, Irena Sailer".)
      const prevLine = j > i ? textOf(blocks[j - 1]) : "";
      if (j > i && authorLine(t) && !/,\s*$/.test(prevLine) && !prevLine.includes("/")) break;
      if (PAGE_NO.test(t)) numbers++;
      j++;
    }
    if (j - i < 8 || numbers < 3) continue;
    const entries: ContentsEntry[] = started?.kind === "contents" ? [...started.entries] : [];
    const waiting: ContentsEntry[] = [];
    let label: { num?: string; authors: string } | null = null;
    let lastByline: ContentsEntry | null = null;
    // The run ends with the last line that found a place in the contents.
    let used = i - 1;
    for (let k = i; k < j; k++) {
      const t = textOf(blocks[k]);
      if (PAGE_NO.test(t)) {
        const e = waiting.shift();
        if (e) {
          e.page = t;
          used = k;
        }
        lastByline = null;
        continue;
      }
      const by = CHAPTER_BY.exec(t);
      if (by) {
        const prev = entries[entries.length - 1];
        // The authors of the title just above (or, if the run opens with them, of the next title).
        if (prev && !prev.authors && /^[\p{L}]/u.test(prev.title)) {
          prev.authors = by[2].replace(/,\s*$/, "");
          if (by[1]) prev.num = by[1];
          used = k;
          // Only a list ending in a comma runs onto the next line.
          lastByline = /,\s*$/.test(by[2]) ? prev : null;
        } else label = { num: by[1], authors: by[2] };
        continue;
      }
      // An author list running onto a second line ("Vincent Fehmer, Irena Sailer").
      if (lastByline && isByline(t.replace(/,\s*/g, " | "))) {
        lastByline.authors = `${lastByline.authors}, ${t.replace(/,\s*$/, "")}`;
        used = k;
        if (!/,\s*$/.test(t)) lastByline = null;
        continue;
      }
      lastByline = null;
      if (CONTENTS_WORD.test(t)) continue;
      // Small lines mixing titles and page numbers: "Foreword vii Preface" / "viii Contributors x".
      const tokens = t.split(" ");
      if (blocks[k].kind === "paragraph" && tokens.length <= 12 && tokens.some((w, n) => n > 0 && /^(?:\d{1,4}|[ivxlc]{1,7})$/.test(w)) && tokens.some((w) => /^\p{Lu}\p{L}{2,}/u.test(w))) {
        let words: string[] = [];
        used = k;
        for (const w of tokens) {
          if (/^(?:\d{1,4}|[ivxlc]{1,7})$/.test(w)) {
            if (words.length) entries.push({ title: words.join(" "), page: w });
            else {
              const e = waiting.shift();
              if (e) e.page = w;
            }
            words = [];
          } else words.push(w);
        }
        if (words.length) {
          const e: ContentsEntry = { title: words.join(" "), page: "" };
          entries.push(e);
          waiting.push(e);
        }
        continue;
      }
      const tail = /^(.+?)\s+(\d{1,4})$/.exec(t);
      const e: ContentsEntry = tail && blocks[k].kind !== "heading" ? { title: tail[1], page: tail[2] } : { title: t, page: "" };
      if (label) {
        if (label.num) e.num = label.num;
        e.authors = label.authors;
        label = null;
      }
      entries.push(e);
      if (!e.page) waiting.push(e);
    }
    const paged = entries.filter((e) => e.page);
    if (paged.length < 4 || paged.length < entries.length * 0.6) continue;
    // Titles read like titles: words, not figures from a table ("5.77 24.6", "3×3, 64").
    const wordy = (t: string) => /\p{L}{3,}/u.test(t) && (t.match(/[\d×.,%]/g) ?? []).length <= t.length * 0.2;
    if (paged.filter((e) => wordy(e.title)).length < paged.length * 0.9) continue;
    // Page numbers should mostly go up.
    const arabic = paged.map((e) => Number(e.page)).filter((n) => !Number.isNaN(n));
    let up = 0;
    for (let k = 1; k < arabic.length; k++) if (arabic[k] >= arabic[k - 1]) up++;
    if (arabic.length > 2 && up < (arabic.length - 1) * 0.7) continue;
    // Chapters with authors but no printed number take the next number in line.
    let last = 0;
    for (const e of paged) {
      if (e.num && /^\d+$/.test(e.num)) last = Number(e.num);
      else if (e.authors && last) e.num = String(++last);
    }
    j = used + 1;
    const first = started ?? blocks[i];
    const contents: Block = { kind: "contents", id: first.id, page: first.page, rect: first.rect, chapter: first.chapter, entries: paged };
    if (started) return [...blocks.slice(0, startedAt), contents, ...blocks.slice(j)];
    const keep = word && blocks.indexOf(word) >= i && blocks.indexOf(word) < j ? [word] : [];
    return [...blocks.slice(0, i), ...keep, contents, ...blocks.slice(j)];
  }
  return input;
}

/**
 * A page of headings and almost no text (a series list of other volumes, a
 * "books in this series" page) is a list, not a run of chapters.
 */
export function headingOnlyPages(blocks: Block[]): Block[] {
  const byPage = new Map<number, { heads: number; words: number }>();
  for (const b of blocks) {
    const s = byPage.get(b.page) ?? { heads: 0, words: 0 };
    if (b.kind === "heading") s.heads++;
    else if (b.kind === "paragraph" || b.kind === "list") s.words += (blockText(b).match(/\S+/g) ?? []).length;
    byPage.set(b.page, s);
  }
  const listPages = new Set([...byPage].filter(([, s]) => s.heads >= 5 && s.words < 40).map(([p]) => p));
  if (!listPages.size) return blocks;
  const out: Block[] = [];
  for (const b of blocks) {
    if (!listPages.has(b.page) || b.kind !== "heading") {
      out.push(b);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev?.kind === "list" && prev.page === b.page) prev.items.push([{ text: b.text }]);
    else out.push({ kind: "list", id: b.id, page: b.page, rect: b.rect, chapter: b.chapter, ordered: false, items: [[{ text: b.text }]] } as Block);
  }
  return out;
}

/**
 * A book's name from file details that are often a file name:
 * "Color Atlas of Oral and Maxillofacial Diseases - Brad W. Neville, … - (2019) 546pp. 978-0323552257"
 * → "Color Atlas of Oral and Maxillofacial Diseases".
 */
export function cleanTitle(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let t = raw
    .replace(/\.(pdf|epub|docx?|html?|md|txt)$/i, "")
    .replace(/[_]+/g, " ")
    // Download sites' tags: "( PDFDrive )", "[z-lib.org]", "(www.ebook3000.com)".
    .replace(/\s*[([]\s*(?:pdf ?drive|z-?lib(?:rary)?(?:\.\w+)?|lib ?gen|dokumen\.pub|ebook\w*|www\.[^)\]]+|[^)\]\s]+\.(?:com|org|net|pub))\s*[)\]]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = t.split(/\s+[-–—|]\s+|\s*\|\s*/);
  const junk = (p: string) =>
    isByline(p.replace(/,\s*/g, " | ")) ||
    /^\(?\d{4}\)?(?:\s|$)|\b\d+\s*pp\b|\bisbn\b|\b97[89][-\d]{10,}|^\d[\d-]{8,}$|\b(?:ebook|retail|scan|ocr|libgen|z-?lib|pdf)\b/i.test(p.trim());
  const kept = parts.filter((p, i) => i === 0 || !junk(p));
  t = kept.join(": ");
  t = t
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/\s+(?:pdf ?drive|z-?lib(?:rary)?|lib ?gen)\s*$/i, "")
    .trim();
  return t || raw;
}

const BOOK_PARTS = /^(?:index|preface|foreword|contributors?|acknowledg(?:e)?ments?|dedication|introduction|appendix|appendices|glossary|bibliography|references|abbreviations|about the (?:authors?|editors?))\b/i;

/**
 * One shape for every contents page: titles without trailing commas, and —
 * when a list of a chapter's sections follows the chapters (their pages
 * starting again from the front) — those sections nested under their chapter.
 */
export function tidyContents(blocks: Block[]): void {
  for (const b of blocks) {
    if (b.kind !== "contents") continue;
    for (const e of b.entries) e.title = e.title.replace(/\s*[,;:]\s*$/, "").trim();
    const page = (e: ContentsEntry) => (/^\d+$/.test(e.page) ? Number(e.page) : null);
    const chapters = b.entries.filter((e) => e.num && /^\d+$/.test(e.num) && page(e) !== null);
    if (chapters.length < 3) continue;
    const lastChapter = b.entries.lastIndexOf(chapters[chapters.length - 1]);
    // Entries after the chapter list whose pages fall back inside the book: sections.
    const late = b.entries.slice(lastChapter + 1).filter((e) => !e.num && !BOOK_PARTS.test(e.title) && page(e) !== null && page(e)! < page(chapters[chapters.length - 1])!);
    if (late.length < 3) continue;
    const owner = (e: ContentsEntry) => [...chapters].reverse().find((c) => page(c)! <= page(e)!) ?? chapters[0];
    const lateSet = new Set(late);
    const under = new Map<ContentsEntry, ContentsEntry[]>();
    for (const e of late) {
      e.sub = true;
      const c = owner(e);
      under.set(c, [...(under.get(c) ?? []), e]);
    }
    const out: ContentsEntry[] = [];
    for (const e of b.entries) {
      if (lateSet.has(e)) continue;
      out.push(e, ...(under.get(e) ?? []));
    }
    b.entries = out;
  }
}

/**
 * The chapters are the ones the contents page lists. When it numbers its
 * chapters and the book has many more top-level headings (an atlas with a
 * heading per disease), the headings it doesn't list are sections.
 */
export function chaptersFollowContents(blocks: Block[]): void {
  const contents = blocks.find((b) => b.kind === "contents");
  if (contents?.kind !== "contents") return;
  const n = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const listed = contents.entries.filter((e) => e.num && /^\d+$/.test(e.num) && !e.sub);
  if (listed.length < 3) return;
  const after = blocks.slice(blocks.indexOf(contents) + 1);
  const top = after.filter((b): b is HeadingBlock => b.kind === "heading" && b.level === 1);
  if (top.length <= listed.length * 1.5) return;
  const titles = listed.map((e) => ({ t: n(e.title), num: e.num }));
  for (const h of top) {
    const t = n(h.text);
    const match = titles.find((x) => x.t && (x.t === t || (t.length > 8 && (x.t.startsWith(t) || t.startsWith(x.t)))));
    if (match) h.number ??= match.num;
    else if (!BOOK_PARTS.test(h.text) && !h.number) h.level = 2;
  }
  // Levels never jump: what sat under a demoted heading moves up with it.
  let prev = 0;
  for (const b of blocks) {
    if (b.kind !== "heading") continue;
    if (prev && b.level > prev + 1) b.level = (prev + 1) as HeadingBlock["level"];
    prev = b.level;
  }
}
