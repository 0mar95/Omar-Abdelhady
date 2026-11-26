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
  return s.replace(/[ﬀ-ﬆ­‐‑ ]/g, (c) => LIGATURES[c] ?? c)
    // Bullets drawn with symbol fonts (Symbol, Wingdings) arrive as private-use characters.
    .replace(/[\uF0A7\uF0B7\uF09F\uF0A8\uF06C\uF06E\uF075\uF076\uF0D8\uF0E0\uF0FC\uF0D7]/g, (c) => (c === "\uF0FC" ? "✓" : "•"))
    // An unmapped symbol glyph (a control code) standing alone or before a space is a bullet;
    // control codes are never text.
    .replace(/^\s*[\u0001-\u0008\u000E-\u001F](?=\s|$)/, "•")
    .replace(/[\u0001-\u0008\u000E-\u001F]/g, "");
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
/**
 * A figure, table or box reference: "Fig 1-2", "Figure 3.2", "Fig. 1.32A–C",
 * "Fig 5a", "Table 2-1". Groups: kind word, number, panel letters (optional).
 * The panel letters (upper or lower case, ranges like "A–C") are kept in the
 * link's text but not in the key: the link goes to the whole figure.
 */
export const XREF_RE = /\b(Fig(?:ure)?s?\.?|Tables?|Box(?:es)?)\s*(\d+(?:\s?[-–.]\s?\d+)?)((?:[A-Za-z](?![a-z]))(?:\s?[-–,]\s?[A-Za-z](?![a-z]))*)?(?![\w])/g;

export function xrefKey(kindWord: string, num: string): string {
  const k = /^fig/i.test(kindWord) ? "Fig" : /^tab/i.test(kindWord) ? "Table" : "Box";
  return `${k} ${num.replace(/\s/g, "").replace(/[–.]/g, "-")}`;
}

// Capital panel letters after the number ("Fig. 1.32A", "Fig 2.4A–C") belong to
// the same figure: matched, but not part of its number.
export const CAPTION_RE = /^(Fig(?:ure)?\.?|FIG(?:URE)?\.?|Table|TABLE|Box|BOX)\s*(\d+\s?[-–.]\s?\d+[a-z]?|\d+[a-z]?)(?:[A-Z](?:\s?[-–,]\s?[A-Z])*)?(?![\w])\s*(\(cont(?:inued|'d|\.)?\))?/;

export function countWords(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}
