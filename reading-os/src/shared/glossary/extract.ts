// Builds a book's glossary from its own text, without AI:
//  - acronyms defined in parentheses: "temporomandibular disorders (TMDs)"
//    (the Schwartz–Hearst abbreviation algorithm),
//  - defined terms: italic terms in a defining sentence, e.g. "*Nociceptive
//    pain* is …", "the IASP defines *neuropathic pain* as …".
// It also counts where each term appears and provides a fast text matcher.

import type { Block, BookDoc, Span } from "../model.ts";

export interface GlossaryTerm {
  /** Stable key: acronym as written (singular) or the lowercased singular term. */
  key: string;
  kind: "acronym" | "term";
  /** Display form: "TMD" or "nociceptive pain". */
  term: string;
  /** Acronyms: the spelled-out form, e.g. "temporomandibular disorder". */
  expansion?: string;
  /** Surface forms matched in the text. */
  aliases: string[];
  /** The sentence where the book defines or first explains the term. */
  definition: string;
  blockId: string;
  blockIndex: number;
  page: number;
  /** Indices of blocks that mention the term, in reading order. */
  occurrences: number[];
}

const DEFINING_BLOCKS = new Set<Block["kind"]>(["paragraph", "list", "callout"]);

function blockSpans(b: Block): Span[][] {
  switch (b.kind) {
    case "paragraph":
      return [b.spans];
    case "list":
    case "callout":
      return b.items;
    case "box":
      return b.body.flatMap((x) => (x.kind === "paragraph" ? [x.spans] : x.items));
    default:
      return [];
  }
}

function plainText(spans: Span[]): string {
  return spans.map((s) => (s.cite ? "" : s.text)).join("");
}

/** The sentence of `text` that contains position `at`. */
function sentenceAt(text: string, at: number): string {
  const re = /[^.!?]*(?:[.!?](?!\d)|$)["”’)\]]*/g;
  let start = 0;
  for (const m of text.matchAll(re)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (at >= s && at < e) {
      start = s;
      let out = m[0].trim();
      // Abbreviations such as "eg." or "Dr." split sentences too early; extend once.
      if (/\b(eg|ie|vs|Dr|al|approx|cf)\.$/i.test(out)) {
        const next = re.exec(text.slice(e));
        if (next) out = `${out} ${next[0].trim()}`;
      }
      return out.slice(0, 420);
    }
  }
  return text.slice(start, start + 300).trim();
}

// ---------- acronyms (Schwartz & Hearst, 2003) ----------

const NOT_ACRONYM = new Set(["eg", "ie", "Fig", "Figs", "cont", "PO", "ed", "eds", "IV", "II", "III", "VI", "VII", "VIII", "IX", "XI", "XII", "OR", "AND", "NOT"]);

function isShortForm(sf: string): boolean {
  if (sf.length < 2 || sf.length > 12) return false;
  if (!/^[A-Za-z]/.test(sf)) return false;
  if (!/[A-Z]/.test(sf)) return false;
  if (/^[A-Z][a-z]+$/.test(sf)) return false; // an ordinary capitalised word
  if (/\s/.test(sf)) return false;
  if (NOT_ACRONYM.has(sf)) return false;
  return true;
}

/** Shortest suffix of `longForm` whose letters can spell the short form. */
export function bestLongForm(shortForm: string, longForm: string): string | null {
  let s = shortForm.length - 1;
  let l = longForm.length - 1;
  while (s >= 0) {
    const c = shortForm[s].toLowerCase();
    if (!/[a-z0-9]/i.test(c)) {
      s--;
      continue;
    }
    while ((l >= 0 && longForm[l].toLowerCase() !== c) || (s === 0 && l > 0 && /[a-z0-9]/i.test(longForm[l - 1]))) l--;
    if (l < 0) return null;
    l--;
    s--;
  }
  l = longForm.lastIndexOf(" ", l) + 1;
  return longForm.slice(l);
}

/** Words that end in "s" but are singular (diseases, Latin terms). */
const ALWAYS_S = new Set(["shingles", "herpes", "diabetes", "measles", "mumps", "rabies", "scabies", "series", "species", "news", "migrans", "perstans", "lens", "mucus", "pons", "biceps", "triceps", "forceps"]);

export function singular(word: string): string {
  if (ALWAYS_S.has(word.toLowerCase())) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  // Latin/Greek singulars end in -is, -us, -os, -as, -ss: "arthritis", "torticollis".
  if (/(is|us|os|as|ss|ys)$/.test(word)) return word;
  if (/s$/.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

interface AcronymHit {
  sf: string;
  lf: string;
  at: number;
}

export function findAcronyms(text: string): AcronymHit[] {
  const out: AcronymHit[] = [];
  for (const m of text.matchAll(/\(([^()]{2,40})\)/g)) {
    const inside = m[1].split(/[;,]\s*/)[0].trim();
    const sf = inside.replace(/['’]s$/, "");
    if (!isShortForm(sf)) continue;
    const before = text.slice(0, m.index).trimEnd();
    const words = before.split(/\s+/);
    const letters = sf.replace(/[^A-Za-z0-9]/g, "").length;
    const maxWords = Math.min(letters + 5, letters * 2);
    const window = words.slice(-maxWords).join(" ").replace(/^[^A-Za-z]+/, "");
    const lf = initialsLongForm(sf.replace(/s$/, ""), window) ?? bestLongForm(sf.replace(/s$/, ""), window);
    if (!lf) continue;
    const lfWords = lf.split(/\s+/);
    if (lf.length <= sf.length || lfWords.length > maxWords) continue;
    if (!/^[A-Za-z]/.test(lf) || /[()]/.test(lf)) continue;
    // The long form should start at a word that the first acronym letter begins.
    if (lf[0].toLowerCase() !== sf[0].toLowerCase()) continue;
    out.push({ sf, lf: lf.replace(/[,;:]$/, ""), at: m.index ?? 0 });
  }
  return out;
}

// ---------- defined terms ----------

const STOP_TERMS = new Set(
  "not all and or but must should only also any each never always both either neither none some very more most less few can may might in vivo in vitro et al per se de novo a priori ad hoc via versus".split(" "),
);

/** Single words the book italicises that are too generic to underline everywhere. */
const GENERIC = new Set(
  "acute chronic primary secondary tertiary episodic symptomatic nonspecific specific receptive perpetuating predisposing initiating precipitating field flag central peripheral general functional structural local systemic normal abnormal positive negative mild moderate severe early late first second third major minor simple complex true false direct indirect".split(
    " ",
  ),
);

const DEFINES_AFTER = /^[\s,]*(?:\([^)]*\)\s*)?(?:is|are|was|refers? to|describes?|denotes?|means?|represents?|consists? of|involves?|occurs?|can be defined|is defined|has been defined|are defined|have been defined|is characterized|are characterized|is the|are the)\b/i;
const DEFINES_BEFORE = /(?:defined as|defines|known as|termed|called|referred to as|refers to|so-called|designated|described as|the term|the terms|the concept of)\s*["“]?$/i;

function termKey(t: string): string {
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w, i, arr) => (i === arr.length - 1 ? singular(w) : w))
    .join(" ");
}

function cleanTerm(t: string): string {
  return t
    .replace(/\s*\([^)]*\)?\s*$/, "") // a trailing "(CRPS" belongs to an acronym, not the term
    .replace(/^[\s"“‘(]+|[\s"”’),.;:]+$/g, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ");
}

interface TermHit {
  term: string;
  display: string;
  sentence: string;
  /** 3: the term is the subject of a defining sentence; 2: "X is/refers to"; 1: "called X"; 0: emphasis only. */
  score: number;
}

/** Italic runs, merging italic spans separated only by spaces (line joins). */
function italicRuns(spans: Span[]): { text: string; start: number }[] {
  const runs: { text: string; start: number }[] = [];
  let pos = 0;
  let cur: { text: string; start: number } | null = null;
  for (const s of spans) {
    const start = pos;
    if (!s.cite) pos += s.text.length;
    if (s.i && !s.cite && !s.xref) {
      if (cur) cur.text += s.text;
      else cur = { text: s.text, start };
    } else if (cur && !s.cite && /^\s+$/.test(s.text)) {
      cur.text += s.text;
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.map((r) => ({ ...r, text: r.text.replace(/\s+$/, "") }));
}

function findDefinedTerms(spans: Span[]): TermHit[] {
  const text = plainText(spans);
  const out: TermHit[] = [];
  for (const run of italicRuns(spans)) {
    const raw = run.text;
    const term = cleanTerm(raw);
    const words = term.split(" ");
    if (term.length < 3 || term.length > 60 || words.length > 6) continue;
    if (/[:;?!.\d]/.test(term)) continue;
    if (/\b(edition|revision|version|volume)\b/i.test(term)) continue; // parts of document titles
    if (STOP_TERMS.has(term.toLowerCase())) continue;
    if (words.length === 1 && GENERIC.has(term.toLowerCase())) continue;
    if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(term) && words.length > 2) continue; // titles of works
    const offset = raw.indexOf(term.split(" ")[0]);
    const start = run.start + Math.max(0, offset);
    const after = text.slice(start + term.length, start + term.length + 60);
    const before = text.slice(Math.max(0, start - 40), start);
    const sentence = sentenceAt(text, start + 1);
    const initial = /(^|[.!?]["”’)]?\s*)$/.test(text.slice(0, start));
    let score = 0;
    if (DEFINES_AFTER.test(after)) score = initial || /^\W*$/.test(before) ? 3 : 2;
    else if (DEFINES_BEFORE.test(before.trim())) score = 1;
    if (!score && words.length === 1 && term.length < 8) continue;
    // Keep capitals only when they aren't just sentence-initial ("Sjögren syndrome").
    const display = initial && /^[A-Z][a-z]/.test(term) && !/[A-Z]/.test(term.slice(1)) ? term[0].toLowerCase() + term.slice(1) : term;
    out.push({ term, display, sentence, score });
  }
  return out;
}

/** Long form from word initials ("American Academy of Orofacial Pain" for AAOP), if they spell the acronym. */
function initialsLongForm(sf: string, before: string): string | null {
  const letters = sf.replace(/[^A-Za-z]/g, "").toLowerCase();
  const words = before.split(/\s+/).filter(Boolean);
  const skip = new Set(["of", "and", "the", "for", "in", "on", "to", "with", "&"]);
  let i = words.length - 1;
  let k = letters.length - 1;
  while (i >= 0 && k >= 0) {
    const w = words[i].replace(/^[^A-Za-z]+/, "");
    if (skip.has(w.toLowerCase())) {
      i--;
      continue;
    }
    // Hyphenated words may supply several letters ("gene-related").
    const parts = w.split("-").filter(Boolean);
    for (let p = parts.length - 1; p >= 0 && k >= 0; p--) {
      if (parts[p][0]?.toLowerCase() !== letters[k]) return null;
      k--;
    }
    i--;
  }
  if (k >= 0) return null;
  return words.slice(i + 1).join(" ").replace(/^[^A-Za-z]+/, "");
}

// ---------- assembly ----------

type Draft = GlossaryTerm & { score: number; italicCount: number };

export function extractGlossary(book: BookDoc): GlossaryTerm[] {
  const acronyms = new Map<string, Draft>();
  const terms = new Map<string, Draft>();
  const numbered = book.chapters.some((c) => c.number);
  book.blocks.forEach((b, i) => {
    if (!DEFINING_BLOCKS.has(b.kind) && b.kind !== "box") return;
    // Front matter (preface, contributors) mentions terms before the chapters define them.
    if (numbered && !book.chapters[b.chapter]?.number) return;
    for (const spans of blockSpans(b)) {
      const text = plainText(spans);
      for (const a of findAcronyms(text)) {
        const key = a.sf.replace(/s$/, "");
        if (acronyms.has(key)) continue;
        const plural = /s$/.test(a.sf);
        const lfWords = a.lf.split(" ");
        let expansion = plural ? [...lfWords.slice(0, -1), singular(lfWords[lfWords.length - 1])].join(" ") : a.lf;
        // Lowercase a sentence-initial capital ("Burning mouth syndrome"), keep names ("American …").
        if (/^[A-Z][a-z]/.test(expansion) && !/\s[A-Z]/.test(expansion)) expansion = expansion[0].toLowerCase() + expansion.slice(1);
        acronyms.set(key, {
          key,
          kind: "acronym",
          term: key,
          expansion,
          aliases: [key, `${key}s`],
          definition: sentenceAt(text, a.at),
          blockId: b.id,
          blockIndex: i,
          page: b.page,
          occurrences: [],
          score: 1,
          italicCount: 0,
        });
      }
      for (const t of findDefinedTerms(spans)) {
        const key = termKey(t.term);
        const existing = terms.get(key);
        if (existing) {
          existing.italicCount++;
          // Keep the best definition: the term as the subject of a defining sentence beats "called X".
          if (t.score > existing.score) Object.assign(existing, { definition: t.sentence, blockId: b.id, blockIndex: i, page: b.page, score: t.score });
          continue;
        }
        const forms = new Set([t.term.toLowerCase(), key]);
        const last = key.split(" ").pop()!;
        if (!/s$/.test(last)) forms.add(/[^aeiou]y$/.test(key) ? `${key.slice(0, -1)}ies` : `${key}s`);
        terms.set(key, {
          key,
          kind: "term",
          term: t.display.replace(/\S+$/, (w) => singular(w)),
          aliases: [...forms],
          definition: t.sentence,
          blockId: b.id,
          blockIndex: i,
          page: b.page,
          occurrences: [],
          score: t.score,
          italicCount: 1,
        });
      }
    }
  });

  // A defined term that spells out an acronym joins the acronym's entry.
  for (const a of acronyms.values()) {
    if (!a.expansion) continue;
    const key = termKey(a.expansion);
    const t = terms.get(key);
    const e = a.expansion.toLowerCase();
    if (a.expansion.split(" ").length >= 2) a.aliases.push(e, termKey(e) === e ? `${e}s` : termKey(e));
    if (t) {
      if (t.score >= 2) Object.assign(a, { definition: t.definition, blockId: t.blockId, blockIndex: t.blockIndex, page: t.page });
      terms.delete(key);
    }
  }

  // Keep terms the book defines, or emphasises more than once.
  const kept = [...acronyms.values(), ...[...terms.values()].filter((t) => t.score > 0 || t.italicCount >= 2)];
  const list: GlossaryTerm[] = kept.map(({ score: _s, italicCount: _c, ...t }) => t);
  properCase(list, book);
  const byKey = new Map(list.map((t) => [t.key, t]));
  const matcher = buildMatcher(list);
  book.blocks.forEach((b, i) => {
    if (b.kind === "index" || b.kind === "references" || b.kind === "heading") return;
    const seen = new Set<string>();
    for (const spans of blockSpans(b)) for (const m of matcher(plainText(spans))) seen.add(m.key);
    for (const k of seen) byKey.get(k)?.occurrences.push(i);
  });
  // Terms mentioned only where they are defined add little; keep acronyms regardless.
  return list
    .filter((t) => t.kind === "acronym" || t.occurrences.length >= 2 || t.definition.length > 40)
    .sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));
}

/**
 * Proper names keep their capitals ("Sjögren syndrome", "Arnold-Chiari"):
 * a word is capitalised when the book writes it that way mid-sentence more
 * often than in lowercase.
 */
function properCase(list: GlossaryTerm[], book: BookDoc): void {
  const upper = new Map<string, number>();
  const lower = new Map<string, number>();
  for (const b of book.blocks) {
    if (b.kind !== "paragraph" && b.kind !== "list") continue;
    for (const spans of blockSpans(b))
      for (const m of plainText(spans).matchAll(/[a-z,;]\s+([\p{L}][\p{L}'’-]*)/gu)) {
        const w = m[1];
        const map = /^\p{Lu}/u.test(w) ? upper : lower;
        const k = w.toLowerCase();
        map.set(k, (map.get(k) ?? 0) + 1);
      }
  }
  for (const t of list) {
    if (t.kind === "acronym") continue;
    t.term = t.term
      .split(" ")
      .map((w) => {
        const k = w.toLowerCase();
        return (upper.get(k) ?? 0) > (lower.get(k) ?? 0) ? w[0].toUpperCase() + w.slice(1).replace(/-(\p{Ll})/gu, (_, c: string) => `-${c.toUpperCase()}`) : w.toLowerCase();
      })
      .join(" ");
  }
}

// ---------- matching ----------

export interface TermMatch {
  start: number;
  end: number;
  key: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Finds glossary terms in text: acronyms case-sensitively, terms case-insensitively, longest first. */
export function buildMatcher(terms: GlossaryTerm[]): (text: string) => TermMatch[] {
  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  for (const t of terms)
    for (const a of t.aliases) {
      if (t.kind === "acronym" && a === a.toUpperCase().replace(/S$/, "s")) exact.set(a, t.key);
      else if (t.kind === "acronym" && /^[A-Z]/.test(a)) exact.set(a, t.key);
      else loose.set(a.toLowerCase(), t.key);
    }
  const alt = (keys: string[]) =>
    keys
      .sort((a, b) => b.length - a.length)
      .map(esc)
      .join("|");
  const exactRe = exact.size ? new RegExp(`(?<![\\w/-])(?:${alt([...exact.keys()])})(?![\\w/-]|-\\d)`, "g") : null;
  const looseRe = loose.size ? new RegExp(`(?<![\\w-])(?:${alt([...loose.keys()])})(?![\\w-])`, "gi") : null;
  return (text: string) => {
    const found: TermMatch[] = [];
    if (exactRe)
      for (const m of text.matchAll(exactRe)) {
        const k = exact.get(m[0]);
        if (k) found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, key: k });
      }
    if (looseRe)
      for (const m of text.matchAll(looseRe)) {
        const k = loose.get(m[0].toLowerCase());
        if (k) found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, key: k });
      }
    // Longest match wins where matches overlap.
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const out: TermMatch[] = [];
    let until = -1;
    for (const f of found) {
      if (f.start < until) continue;
      out.push(f);
      until = f.end;
    }
    return out;
  };
}

/**
 * Which terms to mark in each block: the first mention of a term in each
 * section (as encyclopedias link only a first mention), so the page stays calm.
 */
export function firstMentions(book: BookDoc, match: (text: string) => TermMatch[]): Map<string, Set<string>> {
  const allowed = new Map<string, Set<string>>();
  let seen = new Set<string>();
  for (const b of book.blocks) {
    if (b.kind === "heading") {
      if (b.level <= 3) seen = new Set();
      continue;
    }
    if (b.kind !== "paragraph" && b.kind !== "list" && b.kind !== "callout" && b.kind !== "box") continue;
    const keys = new Set<string>();
    for (const spans of blockSpans(b))
      for (const m of match(plainText(spans)))
        if (!seen.has(m.key)) {
          seen.add(m.key);
          keys.add(m.key);
        }
    if (keys.size) allowed.set(b.id, keys);
  }
  return allowed;
}
