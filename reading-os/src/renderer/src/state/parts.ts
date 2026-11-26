// Kenning's chapters as things you finish: which parts are done (read to the
// end, or their quiz passed), and the short summary that closes each part.
//
// A summary is three points, each tied to a sentence of the book that says
// it: the local model writes them and every quote is checked against the
// part. Without the model, the book's own definitions and section openings
// stand in.

import { create } from "zustand";
import type { BookDoc } from "../../../shared/model";
import { extractGlossary } from "../../../shared/glossary/extract";
import { findQuote } from "../../../shared/study/questions";
import type { ReadingUnit } from "../../../shared/units";
import { streamChat } from "../ai";
import { platform } from "../platform";
import { useGlossary } from "./glossary";
import type { BookIndex } from "./reader";
import { sample, sectionOf } from "./study";

export interface SummaryPoint {
  text: string;
  /** The book's sentence that says it, and where. */
  quote: string;
  blockId: string;
}

export interface PartSummary {
  points: SummaryPoint[];
  /** "ai": written by the model and checked; "book": taken from the book as it stands. */
  from: "ai" | "book";
}

export interface Done {
  at: number;
  by: "read" | "quiz";
}

interface Saved {
  done: Record<string, Done>;
  summaries: Record<string, PartSummary>;
}

interface PartsStore {
  bookId: string | null;
  done: Record<string, Done>;
  summaries: Record<string, PartSummary>;
  busy: string | null;
  load(bookId: string): Promise<void>;
  markDone(unitId: string, by: Done["by"]): void;
  summarize(book: BookDoc, ix: BookIndex, unit: ReadingUnit, again?: boolean): Promise<void>;
}

export const useParts = create<PartsStore>((set, get) => ({
  bookId: null,
  done: {},
  summaries: {},
  busy: null,
  async load(bookId) {
    set({ bookId, done: {}, summaries: {}, busy: null });
    const saved = await platform.stateGet<Saved>(`parts:${bookId}`);
    if (saved && get().bookId === bookId) set({ done: saved.done ?? {}, summaries: saved.summaries ?? {} });
  },
  markDone(unitId, by) {
    const had = get().done[unitId];
    // Passing the quiz says more than reaching the end.
    if (had && (had.by === "quiz" || by === "read")) return;
    set((s) => ({ done: { ...s.done, [unitId]: { at: Date.now(), by } } }));
    save(get());
  },
  async summarize(book, ix, unit, again = false) {
    if (get().busy || (!again && get().summaries[unit.id])) return;
    set({ busy: unit.id });
    try {
      const sec = sectionOf(book, ix, unit.id);
      const blocks: { id: string; text: string }[] = [];
      for (let i = unit.start; i < unit.end; i++) blocks.push({ id: book.blocks[i].id, text: ix.texts[i] });
      let summary: PartSummary | null = null;
      try {
        const points = ground(await fromModel(sec.title, sample(sec.text, 7000)), blocks);
        if (points.length >= 2) summary = { points, from: "ai" };
      } catch {
        /* no model: the book's own words */
      }
      summary ??= fromBook(book, ix, unit);
      if (summary.points.length && get().bookId === book.id) {
        set((s) => ({ summaries: { ...s.summaries, [unit.id]: summary } }));
        save(get());
      }
    } finally {
      set({ busy: null });
    }
  },
}));

function save(s: PartsStore) {
  if (s.bookId) void platform.stateSet(`parts:${s.bookId}`, { done: s.done, summaries: s.summaries });
}

const SYSTEM = `You sum up a part of a textbook (often dental or medical) for a student who just read it.
Write exactly 3 points: the three things most worth remembering, in the order the text gives them.
Rules:
- Each point is one plain sentence of at most 22 words, using ONLY what the text says.
- For each point give "quote": the sentence from the text that says it, copied word for word.
- Reply with JSON only: {"points":[{"point":"…","quote":"…"}]}`;

async function fromModel(title: string, text: string): Promise<{ point: string; quote: string }[]> {
  let out = "";
  await streamChat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Part: ${title}\n\nText:\n"""${text}"""\n\nWrite the 3 points as JSON.` },
    ],
    (t) => (out += t),
  ).done;
  return parsePoints(out);
}

export function parsePoints(reply: string): { point: string; quote: string }[] {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  try {
    const data = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as { points?: unknown[] };
    return (data.points ?? [])
      .map((p) => p as Record<string, unknown>)
      .filter((p) => typeof p.point === "string" && typeof p.quote === "string")
      .map((p) => ({ point: (p.point as string).trim(), quote: (p.quote as string).trim() }))
      .filter((p) => p.point.split(/\s+/).length <= 40);
  } catch {
    return [];
  }
}

/** Keeps the points whose quote is really in the part, with the book's own sentence. */
function ground(points: { point: string; quote: string }[], blocks: { id: string; text: string }[]): SummaryPoint[] {
  const out: SummaryPoint[] = [];
  for (const p of points) {
    const found = findQuote(p.quote, blocks);
    if (!found || citation(found.sentence) || out.some((o) => o.blockId === found.blockId && o.quote === found.sentence)) continue;
    out.push({ text: p.point, quote: found.sentence, blockId: found.blockId });
  }
  return out.slice(0, 3);
}

/** A reference-list entry ("Int J Periodontics 2010;30(5):471–7.") says nothing to keep. */
const citation = (s: string) => /\b(?:19|20)\d{2}\s*;\s*\d+|\bet al\.|\bdoi:|\bpp?\.\s*\d/i.test(s);

/** Without the model: the terms the part defines, else the opening sentence of its sections. */
function fromBook(book: BookDoc, ix: BookIndex, unit: ReadingUnit): PartSummary {
  const terms = useGlossary.getState().bookId === book.id && useGlossary.getState().terms.length ? useGlossary.getState().terms : extractGlossary(book);
  const points: SummaryPoint[] = [];
  for (const t of terms) {
    if (t.blockIndex < unit.start || t.blockIndex >= unit.end || t.kind !== "term" || !t.definition) continue;
    points.push({ text: t.definition, quote: t.definition, blockId: t.blockId });
  }
  points.sort((a, b) => (ix.byId.get(a.blockId) ?? 0) - (ix.byId.get(b.blockId) ?? 0));
  if (points.length < 3) {
    for (let i = unit.start + 1; i < unit.end && points.length < 3; i++) {
      const b = book.blocks[i];
      if (b.kind !== "heading" || b.level !== 2) continue;
      for (let k = i + 1; k < Math.min(unit.end, i + 4); k++) {
        if (book.blocks[k].kind !== "paragraph") continue;
        const first = ix.texts[k].match(/^.{20,240}?[.!?](?=\s|$)/)?.[0];
        if (first && !citation(first) && !points.some((p) => p.blockId === book.blocks[k].id)) points.push({ text: first, quote: first, blockId: book.blocks[k].id });
        break;
      }
    }
  }
  return { points: points.slice(0, 3), from: "book" };
}
