// Questions made from the book's own material, with no AI: its definitions,
// acronyms, bold key terms, numbers with units, and tables. Wrong options are
// real terms and values from the same chapter, never filler. A question is
// only made when there are enough good wrong options for it.

import type { BookDoc } from "../model";
import type { GlossaryTerm } from "../glossary/extract";

export type QuestionKind = "definition" | "acronym" | "term" | "number" | "table" | "concept" | "case";

export interface Draft {
  kind: QuestionKind;
  type: "mcq" | "short";
  q: string;
  options?: string[];
  /** mcq: index of the right option; short: the answer. */
  answer: number | string;
  /** The book's sentence the answer comes from. */
  why?: string;
  /** Where that sentence is. */
  blockId?: string;
}

export interface SectionRange {
  start: number;
  end: number;
}

const MAX = 5;

/** Questions for blocks [start, end) of the book. `terms` is the book's glossary. */
export function bookQuestions(book: BookDoc, rawTexts: string[], range: SectionRange, terms: GlossaryTerm[], max = MAX): Draft[] {
  // Paragraph text without citation numbers and superscripts ("pain.12" → "pain.").
  // Unmarked ones too: a number glued after a word's punctuation ("interactions.12", "100%.8").
  const texts = rawTexts.map((t, i) => {
    const b = book.blocks[i];
    const plain = b?.kind === "paragraph" && b.spans.some((x) => x.cite || x.sup) ? b.spans.filter((x) => !x.cite && !x.sup).map((x) => x.text).join("") : t;
    return plain.replace(/(?<=[\p{L}%)\]])([.,;:])\d{1,3}(?:[,–-]\d{1,3})*(?=\s|$)/gu, "$1");
  });
  const chapter = book.blocks[range.start]?.chapter ?? 0;
  const inChapter = (i: number) => book.blocks[i]?.chapter === chapter;
  const inSection = (i: number) => i >= range.start && i < range.end;
  const seed = hash(book.blocks[range.start]?.id ?? "");
  const out: Draft[] = [];
  const used = new Set<string>();
  const add = (d: Draft | null) => {
    if (!d || out.length >= max) return;
    const key = norm(d.q);
    if (used.has(key)) return;
    used.add(key);
    out.push(d);
  };

  // Pools of wrong options: the chapter's (then the book's) own terms.
  const glossTerms = terms.filter((t) => t.kind === "term");
  const acronyms = terms.filter((t) => t.kind === "acronym" && t.expansion);
  const bold = boldTerms(book, (i) => inChapter(i));
  const chapterTerms = uniq([...glossTerms.filter((t) => inChapter(t.blockIndex)).map((t) => t.term), ...bold]);
  const termPool = uniq([...chapterTerms, ...glossTerms.map((t) => t.term)]);
  const near = chapterTerms.length;

  const definitions: Draft[] = [];
  const spelled: Draft[] = [];
  for (const t of terms) {
    if (!inSection(t.blockIndex)) continue;
    if (t.kind === "acronym" && t.expansion) {
      if (!spellsOut(t.term, t.expansion)) continue;
      const pool = uniq([...acronyms.filter((a) => a.key !== t.key && inChapter(a.blockIndex)), ...acronyms.filter((a) => a.key !== t.key)].map((a) => cap(a.expansion!)));
      const opts = choose(cap(t.expansion), pool, seed + t.blockIndex + spelled.length);
      if (opts) spelled.push({ kind: "acronym", type: "mcq", q: `What does ${t.term} stand for?`, ...opts, why: t.definition, blockId: book.blocks[t.blockIndex]?.id });
    } else if (t.kind === "term") {
      const blanked = blank(t.definition, t.aliases.concat(t.term));
      if (!blanked) continue;
      const opts = choose(t.term, termPool.filter((x) => norm(x) !== norm(t.term)), seed + t.blockIndex + definitions.length, near);
      if (opts) definitions.push({ kind: "definition", type: "mcq", q: `Which term fits? “${blanked}”`, ...opts, why: t.definition, blockId: book.blocks[t.blockIndex]?.id });
    }
  }

  const clozes: Draft[] = [];
  for (let i = range.start; i < range.end; i++) {
    const b = book.blocks[i];
    if (b.kind !== "paragraph") continue;
    for (const s of b.spans) {
      const term = s.b ? s.text.trim().replace(/[.,;:]$/, "") : "";
      if (term.length < 4 || term.split(/\s+/).length > 5 || /^\d/.test(term)) continue;
      const sentence = sentenceWith(texts[i], term);
      const blanked = sentence && blank(sentence, [term]);
      if (!blanked) continue;
      const opts = choose(term, termPool.filter((x) => norm(x) !== norm(term)), seed + i, near);
      if (opts) clozes.push({ kind: "term", type: "mcq", q: `Fill in the blank: “${blanked}”`, ...opts, why: sentence, blockId: b.id });
    }
  }

  const numbers = numberQuestions(book, texts, range, inChapter, seed);
  const tables = tableQuestions(book, range, seed);

  // A mix: one of each kind first, then the rest; acronyms last, at most two.
  const lists = [definitions, tables, numbers, clozes, spelled.slice(0, Math.max(2, Math.floor(max / 3)))];
  for (const l of lists) add(l[0] ?? null);
  for (let k = 1; out.length < max && lists.some((l) => l.length > k); k++) for (const l of lists) add(l[k] ?? null);
  return out;
}

// ---------- numbers ----------

const UNIT = String.raw`(%|percent|mm|cm|µm|μm|nm|kVp|kV|mA|mAs|mg|g|kg|mL|ml|L|mSv|µSv|μSv|Gy|°C|years?|months?|weeks?|days?|hours?|minutes?|seconds?|times)`;
const NUMBER_RE = new RegExp(String.raw`(?<![\w.])(\d{1,4}(?:[.,]\d+)?)\s?${UNIT}(?![\w])`, "g");

function numberQuestions(book: BookDoc, texts: string[], range: SectionRange, inChapter: (i: number) => boolean, seed: number): Draft[] {
  // Every number+unit in the chapter, for realistic wrong options.
  const byUnit = new Map<string, Set<string>>();
  for (let i = 0; i < book.blocks.length; i++) {
    if (!inChapter(i) || book.blocks[i].kind !== "paragraph") continue;
    for (const m of texts[i].matchAll(NUMBER_RE)) {
      const u = unitKey(m[2]);
      if (!byUnit.has(u)) byUnit.set(u, new Set());
      byUnit.get(u)!.add(m[1]);
    }
  }
  const out: Draft[] = [];
  for (let i = range.start; i < range.end; i++) {
    const b = book.blocks[i];
    if (b.kind !== "paragraph") continue;
    for (const sentence of sentences(texts[i])) {
      if (sentence.length < 50 || sentence.length > 300) continue;
      // Numbers in brackets are asides (sample sizes, ranges): not worth a question.
      const m = [...sentence.matchAll(NUMBER_RE)].find((x) => !insideBrackets(sentence, x.index!));
      if (!m) continue;
      const value = m[1];
      const unit = m[2];
      const shown = (v: string) => `${v}${/^%$/.test(unit) ? "%" : ` ${Number(v) === 1 ? unit.replace(/s$/, "") : unit.replace(/^(year|month|week|day|hour|minute|second)$/, "$1s")}`}`;
      // Wrong values written like the right one (same decimals), so none stands out.
      const places = (v: string) => (v.split(/[.,]/)[1] ?? "").length;
      const n = Number(value.replace(",", "."));
      const close = (v: string) => {
        const x = Number(v.replace(",", "."));
        return x >= n / 3 && x <= n * 3;
      };
      const others = [...(byUnit.get(unitKey(unit)) ?? [])].filter((v) => v !== value && places(v) === places(value) && close(v));
      const pool = uniq([...others.slice(0, 2), ...nearby(value, unit), ...others.slice(2)]).map(shown);
      const blanked = sentence.slice(0, m.index) + "_____" + sentence.slice(m.index! + m[0].length);
      const opts = choose(shown(value), pool, seed + i + out.length);
      if (opts) out.push({ kind: "number", type: "mcq", q: `Fill in the number: “${blanked}”`, ...opts, why: sentence, blockId: b.id });
      break;
    }
  }
  return out;
}

const unitKey = (u: string) => u.toLowerCase().replace(/s$/, "").replace("percent", "%").replace(/[µμ]/, "u");

/** Plausible neighbours of a value: half, double, and a little either side. */
function nearby(value: string, unit: string): string[] {
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return [];
  const decimals = (value.split(/[.,]/)[1] ?? "").length;
  const fmt = (x: number) => (decimals ? x.toFixed(decimals) : String(Math.round(x)));
  const pct = unitKey(unit) === "%";
  const cands = [n * 0.5, n * 2, n * 1.5, n * 0.75, n + (n >= 10 ? 10 : 1), n - (n > 10 ? 10 : 1)].filter((x) => x > 0 && (!pct || x <= 100));
  return uniq(cands.map(fmt)).filter((v) => v !== value);
}

function insideBrackets(s: string, at: number): boolean {
  const before = s.slice(0, at);
  return before.lastIndexOf("(") > before.lastIndexOf(")");
}

const STOP = new Set(["of", "and", "the", "in", "for", "to", "a", "an", "on", "with", "by"]);
/** Whether the expansion spells the acronym ("CSF" ← "cerebrospinal fluid" counts: C-S-F needs only to appear in order). */
function spellsOut(acronym: string, expansion: string): boolean {
  const letters = acronym.replace(/[^A-Za-z]/g, "").toLowerCase();
  const parts = expansion.toLowerCase().split(/[\s-]+/).filter((w) => w && !STOP.has(w));
  if (!letters || !parts.length) return false;
  if (parts[0][0] !== letters[0]) return false;
  // Every word's first letter must be in the acronym, in order (letters may come from inside words).
  const joined = parts.join(" ");
  let at = 0;
  for (const ch of letters) {
    const i = joined.indexOf(ch, at);
    if (i < 0) return false;
    at = i + 1;
  }
  return parts.every((w) => letters.includes(w[0]));
}

// ---------- tables ----------

function tableQuestions(book: BookDoc, range: SectionRange, seed: number): Draft[] {
  const out: Draft[] = [];
  for (let i = range.start; i < range.end; i++) {
    const b = book.blocks[i];
    if (b.kind !== "table" || b.headerRows < 1) continue;
    const header = b.rows[b.headerRows - 1];
    const body = b.rows.slice(b.headerRows).filter((r) => r[0]?.trim());
    if (body.length < 3 || header.length < 2) continue;
    const name = b.caption.map((s) => s.text).join("").trim().replace(/^(table\s*[\d.–-]+\s*)/i, "") || b.key || "the table";
    for (let c = 1; c < header.length && out.length < 2; c++) {
      const col = body.map((r) => (r[c] ?? "").trim());
      const short = col.filter((v) => v && v.length <= 48);
      if (uniq(short).length < 4 || !header[c]?.trim()) continue;
      const r = body[(seed + c) % body.length];
      const right = (r[c] ?? "").trim();
      if (!right || right.length > 48) continue;
      const opts = choose(right, uniq(short).filter((v) => norm(v) !== norm(right)), seed + c);
      if (!opts) continue;
      out.push({
        kind: "table",
        type: "mcq",
        q: `In ${quoteName(name)}, what is the ${header[c].trim().toLowerCase()} for “${r[0].trim()}”?`,
        ...opts,
        why: `${r[0].trim()} — ${header[c].trim()}: ${right}`,
        blockId: b.id,
      });
    }
  }
  return out;
}

const quoteName = (n: string) => (n.length > 70 ? "the table" : `“${n.replace(/[.:]$/, "")}”`);

// ---------- helpers ----------

function boldTerms(book: BookDoc, keep: (i: number) => boolean): string[] {
  const out: string[] = [];
  book.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph" || !keep(i)) return;
    for (const s of b.spans) {
      const t = s.b ? s.text.trim().replace(/[.,;:]$/, "") : "";
      if (t.length >= 4 && t.split(/\s+/).length <= 5 && !/^\d/.test(t) && !/^(note|figure|table|fig)\b/i.test(t)) out.push(t);
    }
  });
  return uniq(out);
}

/** The sentence with the term replaced by a blank; null when it doesn't read as a question. */
function blank(sentence: string, forms: string[]): string | null {
  if (sentence.length < 40 || sentence.length > 320) return null;
  const sorted = [...new Set(forms)].filter(Boolean).sort((a, b) => b.length - a.length);
  let out = sentence;
  let hit = false;
  for (const f of sorted) {
    const re = new RegExp(`(?<![\\p{L}])${escape(f)}(?![\\p{L}])`, "giu");
    if (re.test(out)) {
      out = out.replace(re, "_____");
      hit = true;
    }
  }
  if (!hit) return null;
  // Too little left to go on.
  if (out.replace(/_____/g, "").replace(/\W+/g, " ").trim().split(" ").length < 6) return null;
  return out;
}

/** The right answer among three wrong ones, in a stable shuffled order; null if there aren't three good ones. */
function choose(right: string, pool: string[], seed: number, near = pool.length): { options: string[]; answer: number } | null {
  const r = norm(right);
  const rw = right.split(/\s+/).length;
  let x = (seed >>> 0) || 7;
  const rand = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) % 1000) / 1000;
  const cands: { p: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const [i, p] of pool.entries()) {
    const n = norm(p);
    if (!n || n === r || n.includes(r) || r.includes(n) || seen.has(n)) continue;
    // Similar length reads fairer than an odd one out.
    if (p.length > right.length * 3 + 12 || right.length > p.length * 3 + 12) continue;
    seen.add(n);
    const score = Math.abs(p.split(/\s+/).length - rw) + Math.abs(Math.log((p.length + 4) / (right.length + 4))) * 2 + rand() * 1.6 + (i < near ? 0 : 1.5);
    cands.push({ p, score });
  }
  if (cands.length < 3) return null;
  const wrong = cands.sort((a, b) => a.score - b.score).slice(0, 3).map((c) => c.p);
  const options = [right, ...wrong];
  const order = shuffle([0, 1, 2, 3], seed);
  return { options: order.map((k) => options[k]), answer: order.indexOf(0) };
}

function shuffle<T>(a: T[], seed: number): T[] {
  const out = [...a];
  let x = (seed >>> 0) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

export const sentences = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    .map((s) => s.trim())
    .filter(Boolean);

function sentenceWith(text: string, term: string): string | null {
  return sentences(text).find((s) => s.toLowerCase().includes(term.toLowerCase())) ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
const uniq = (a: string[]) => {
  const seen = new Set<string>();
  return a.filter((x) => {
    const n = norm(x);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- checking AI questions against the text ----------

const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 2);

/**
 * Where the quote comes from in the section: the block and sentence that share
 * most of its words, or null when the quote isn't really in the text.
 */
export function findQuote(quote: string, blocks: { id: string; text: string }[]): { blockId: string; sentence: string } | null {
  const q = new Set(words(quote));
  if (q.size < 4) return null;
  let best: { blockId: string; sentence: string; score: number } | null = null;
  for (const b of blocks)
    for (const s of sentences(b.text)) {
      const w = new Set(words(s));
      let hit = 0;
      for (const x of q) if (w.has(x)) hit++;
      const score = hit / q.size;
      if (!best || score > best.score) best = { blockId: b.id, sentence: s, score };
    }
  return best && best.score >= 0.75 ? { blockId: best.blockId, sentence: best.sentence } : null;
}

/** Whether the right answer is backed by the quote: its key words (and any numbers) appear in it. */
export function answerInQuote(answer: string, quote: string): boolean {
  const nums = answer.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (nums.some((n) => !quote.includes(n))) return false;
  const a = words(answer);
  if (!a.length) return true;
  const qw = new Set(words(quote).flatMap((w) => [w, w.replace(/s$/, "")]));
  const hit = a.filter((w) => qw.has(w) || qw.has(w.replace(/s$/, ""))).length;
  return hit / a.length >= 0.5;
}
