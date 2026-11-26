// "In this part": what one of Kenning's chapters covers, before reading it —
// its sections, and the few key terms it introduces. Built only from the book
// (headings, terms the book defines there, words it sets in bold), the same
// way for every book.

import type { Block, BookDoc, Span } from "./model.ts";
import type { GlossaryTerm } from "./glossary/extract.ts";
import type { ReadingUnit } from "./units.ts";

export interface UnitPreview {
  sections: { id: string; text: string }[];
  /** Up to `max` key terms, most important first. */
  terms: { text: string; blockId: string; definition?: string }[];
}

export function unitPreview(book: BookDoc, u: ReadingUnit, glossary: GlossaryTerm[], max = 4): UnitPreview {
  const blocks = book.blocks;
  const sections: UnitPreview["sections"] = [];
  for (let i = u.start + 1; i < u.end; i++) {
    const b = blocks[i];
    if (b.kind === "heading" && b.level === 2) sections.push({ id: b.id, text: b.text });
  }

  // Terms the book defines in this part, weighed by how often the part uses them.
  const scored = new Map<string, { text: string; blockId: string; definition?: string; score: number }>();
  const add = (text: string, blockId: string, score: number, definition?: string) => {
    const k = text.toLowerCase();
    const had = scored.get(k);
    if (had) had.score += score;
    else scored.set(k, { text, blockId, definition, score });
  };
  for (const t of glossary) {
    if (t.blockIndex < u.start || t.blockIndex >= u.end || !keyTerm(t.term)) continue;
    const uses = t.occurrences.filter((i) => i >= u.start && i < u.end).length;
    const text = t.kind === "acronym" && t.expansion && t.expansion.length <= 40 ? `${t.expansion} (${t.term})` : t.term;
    add(text, t.blockId, 2 + uses, t.definition);
  }
  // Words the book sets in bold in running text are the ones it wants learnt.
  const bold = new Map<string, { text: string; blockId: string; n: number }>();
  for (let i = u.start; i < u.end; i++) {
    for (const spans of spansOf(blocks[i])) {
      const line = spans.map((x) => x.text).join("");
      // Bold counts inside running text only, not in a short label line ("PATIENTS’ FAQS").
      const running = line.length >= 80 && line !== line.toUpperCase();
      spans.forEach((s, k) => {
        // Bold that opens a paragraph is a run-in heading, not a term.
        if (!s.b || k === 0 || !running) return;
        const text = s.text.replace(/^[\s([{"“]+|[\s)\]}"”.,;:]+$/g, "");
        if (!keyTerm(text)) return;
        const key = text.toLowerCase();
        const had = bold.get(key);
        if (had) had.n++;
        else bold.set(key, { text, blockId: blocks[i].id, n: 1 });
      });
    }
  }
  for (const b of bold.values()) {
    const glossed = [...scored.keys()].find((k) => k.startsWith(b.text.toLowerCase()) || b.text.toLowerCase().startsWith(k));
    if (glossed) scored.get(glossed)!.score += 2;
    // One plain word in bold is emphasis ("visualize") unless the book defines it.
    else if (/\s/.test(b.text) || b.text !== b.text.toLowerCase()) add(b.text, b.blockId, 1 + b.n);
  }
  const terms = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ text, blockId, definition }) => ({ text, blockId, definition }));
  return { sections, terms };
}

function spansOf(b: Block): Span[][] {
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

/** A bold run that names something: a few words, not a label ("Note:") or a sentence. */
function keyTerm(t: string): boolean {
  if (t.length < 3 || t.length > 48) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  if (/^(?:note|notes|tip|tips|caution|warning|example|examples|key points?|summary|step \d+|figure|fig|table|box|see|and|or|the|continued|cont(?:'|’)?d|clinical(?: tips?| notes?| relevance)?|case(?: study| report)?|introduction|conclusions?|discussion|background|objectives?|aims?)$/i.test(t)) return false;
  // A word set in capitals is a running label ("CLINICAL"); a short one may be an abbreviation ("TMD").
  if (/^\p{Lu}{6,}$/u.test(t.replace(/[\s-]/g, ""))) return false;
  if (/^\d|[.!?]$/.test(t)) return false;
  // Instructions set in bold ("identify", "describe") aren't terms.
  if (/^(?:identify|describe|explain|list|discuss|define|understand|compare|contrast|outline|recogni[sz]e|know|learn|review|summari[sz]e|evaluate|assess|apply|demonstrate|state|name|important|remember|always|never|only|not|must|should)$/i.test(t)) return false;
  return /\p{L}{3}/u.test(t);
}
