// Small text repairs that PDFs need before they read like a book.

const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬅ": "st",
  "ﬆ": "st",
  "­": "", // soft hyphen
  "‐": "-",
  "‑": "-",
  " ": " ",
};

export function normalizeText(s: string): string {
  return s.replace(/[ﬀ-ﬆ­‐‑ ]/g, (c) => LIGATURES[c] ?? c);
}

const WORD_RE = /[A-Za-z][A-Za-z'’]*/g;

/** Collects every word written without a line-break hyphen, for hyphen repair. */
export class WordBook {
  private words = new Map<string, number>();

  addText(text: string): void {
    for (const m of text.matchAll(WORD_RE)) {
      const w = m[0].toLowerCase();
      this.words.set(w, (this.words.get(w) ?? 0) + 1);
    }
  }

  has(word: string): boolean {
    return this.words.has(word.toLowerCase());
  }

  /** Words that appear with a real hyphen, e.g. "evidence-based". */
  private hyphenated = new Set<string>();

  addHyphenated(text: string): void {
    for (const m of text.matchAll(/[A-Za-z]+-[A-Za-z]+/g)) this.hyphenated.add(m[0].toLowerCase());
  }

  isHyphenated(compound: string): boolean {
    return this.hyphenated.has(compound.toLowerCase());
  }
}

/**
 * Joins two pieces of text across a line break. Removes the hyphen of a word
 * split at the end of a line ("classifi-" + "cations") but keeps real compound
 * hyphens ("evidence-" + "based") when the book uses that compound elsewhere.
 */
export function joinLines(prev: string, next: string, book?: WordBook): string {
  const a = prev.replace(/\s+$/, "");
  const b = next.replace(/^\s+/, "");
  if (!a) return b;
  if (!b) return a;
  const hy = /([A-Za-z]+)[-‐­]$/.exec(a);
  if (hy) {
    const tail = /^([A-Za-z]+)/.exec(b);
    if (tail) {
      const left = hy[1];
      const right = tail[1];
      const joined = left + right;
      const compound = `${left}-${right}`;
      // Keep the hyphen for compounds the book writes with one ("evidence-based"),
      // or when both halves are words but the joined form never appears
      // ("peer-reviewed"). A capitalised right half ("ICD-10") is a real hyphen too.
      const keepHyphen =
        !!book && (book.isHyphenated(compound) || (!book.has(joined) && book.has(left) && book.has(right) && left.length > 2 && right.length > 2));
      if (keepHyphen || /^[A-Z0-9]/.test(right)) return a + b;
      return a.slice(0, -1) + b;
    }
    return a + b;
  }
  // Words split with an en dash or a slash keep no space ("2016–" + "2018").
  if (/[–—/]$/.test(a)) return a + b;
  return `${a} ${b}`;
}

/** "21-23" → [21,22,23]; "4,5" → [4,5]; returns null if it isn't a citation. */
export function parseCitation(s: string): number[] | null {
  const t = s.replace(/\s+/g, "");
  if (!/^\d{1,3}([,–—-]\d{1,3})*$/.test(t)) return null;
  const out: number[] = [];
  for (const part of t.split(",")) {
    const [a, b] = part.split(/[–—-]/).map(Number);
    if (b !== undefined && b > a && b - a < 60) for (let n = a; n <= b; n++) out.push(n);
    else out.push(a);
  }
  return out;
}

/** Matches "Fig 1-1", "Figure 3.2", "Table 2-4", "Box 5-3" and returns a normalized key. */
export const XREF_RE = /\b(Fig(?:ure)?s?\.?|Tables?|Box(?:es)?)\s*(\d+\s?[-–.]\s?\d+[a-z]?|\d+[a-z]?)\b/g;

export function xrefKey(kindWord: string, num: string): string {
  const k = /^fig/i.test(kindWord) ? "Fig" : /^tab/i.test(kindWord) ? "Table" : "Box";
  return `${k} ${num.replace(/\s/g, "").replace(/[–.]/g, "-")}`;
}

export const CAPTION_RE = /^(Fig(?:ure)?\.?|FIG(?:URE)?\.?|Table|TABLE|Box|BOX)\s*(\d+\s?[-–.]\s?\d+[a-z]?|\d+[a-z]?)\b\s*(\(cont(?:inued|'d|\.)?\))?/;

export function countWords(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}
