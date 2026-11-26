// Study mode: questions from a section's own text, answered in the page, and
// a daily review across every book scheduled with FSRS (the algorithm modern
// Anki uses: each card comes back just before you'd forget it).
//
// Questions come from two places. The local model writes them, and each one
// is checked against the book: its supporting quote must really be in the
// section, the answer must be in that quote, and a second pass confirms the
// marked answer is the only right one. The book's own material (definitions,
// acronyms, key terms, numbers, tables) fills in, and is all there is when
// the model isn't running.

import { create } from "zustand";
import type { ChatMessage } from "../../../shared/ipc";
import type { BookDoc } from "../../../shared/model";
import { extractGlossary } from "../../../shared/glossary/extract";
import { fromLegacy, review, type Card, type Grade } from "../../../shared/study/fsrs";
import { answerInQuote, bookQuestions, findQuote, type Draft, type QuestionKind } from "../../../shared/study/questions";
import { streamChat } from "../ai";
import { platform } from "../platform";
import { useGlossary } from "./glossary";
import type { BookIndex } from "./reader";

export type { Card, Grade };

export interface Question {
  id: string;
  /** The heading that opens the section the question comes from. */
  sectionId: string;
  section: string;
  kind?: QuestionKind;
  q: string;
  type: "mcq" | "short";
  options?: string[];
  /** For mcq: index of the right option. For short: the model answer. */
  answer: number | string;
  /** The book's sentence the answer rests on. */
  why?: string;
  /** Where that sentence is. */
  blockId?: string;
  /** Written by the model (checked) or made from the book itself. */
  from?: "ai" | "book";
}

interface Saved {
  questions: Question[];
  reviews: Record<string, Card | LegacyReview>;
}
interface LegacyReview {
  due: number;
  interval: number;
  right: number;
  wrong: number;
  last?: "right" | "wrong";
}

interface StudyStore {
  bookId: string | null;
  questions: Question[];
  reviews: Record<string, Card>;
  busy: string | null;
  /** What the busy section is doing, for the hint line. */
  stage: string | null;
  error: string | null;
  load(bookId: string): Promise<void>;
  generate(book: BookDoc, ix: BookIndex, sectionId: string): Promise<void>;
  /**
   * Records an answer, scheduled from `before` (the card as it was before this
   * answer, so a change of mind — Good to Easy — is graded from the same start).
   * `first` counts it toward the day's streak.
   */
  grade(id: string, grade: Grade, before: Card | undefined, first: boolean): Card;
  dueCount(): number;
  due(): Question[];
}

/** Questions in a chapter's quiz. */
const QUIZ_SIZE = 8;

const ready = (r: Card | LegacyReview): Card => ("s" in r ? r : fromLegacy(r));

/** Placeholder options from older versions ("The opposite of that"): such questions are dropped. */
const FILLER = /^(the opposite of that|nothing about it|something (else|unrelated)|neither|both|all of the above|none of the above)$/i;
const sound = (qs: Question[] | undefined) => (qs ?? []).filter((q) => (q.options ?? []).filter((o) => FILLER.test(o.trim())).length < 2);

export const useStudy = create<StudyStore>((set, get) => ({
  bookId: null,
  questions: [],
  reviews: {},
  busy: null,
  stage: null,
  error: null,
  async load(bookId) {
    set({ bookId, questions: [], reviews: {}, error: null });
    const saved = await platform.stateGet<Saved>(`study:${bookId}`);
    if (saved && get().bookId === bookId) set({ questions: sound(saved.questions), reviews: upgrade(saved.reviews) });
  },
  async generate(book, ix, sectionId) {
    if (get().busy) return;
    set({ busy: sectionId, stage: "Writing questions from this section…", error: null });
    try {
      const sec = sectionOf(book, ix, sectionId);
      const blocks: { id: string; text: string }[] = [];
      for (let i = sec.start; i < sec.end; i++) blocks.push({ id: book.blocks[i].id, text: ix.texts[i] });
      const terms = useGlossary.getState().bookId === book.id && useGlossary.getState().terms.length ? useGlossary.getState().terms : extractGlossary(book);
      const own = bookQuestions(book, ix.texts, { start: sec.start, end: sec.end }, terms, QUIZ_SIZE).map((d) => ({ ...d, from: "book" as const }));
      let ai: (Draft & { from: "ai" })[] = [];
      try {
        const drafts = await fromModel(sec);
        const grounded = ground(drafts, blocks, sec.text);
        if (grounded.length) {
          set({ stage: "Checking the answers against the book…" });
          ai = (await confirm(sec, grounded)).map((d) => ({ ...d, from: "ai" as const }));
        }
      } catch {
        /* the model isn't running: the book's own questions are used */
      }
      // The model's checked questions first, then the book's own, five in all.
      const made = [...ai, ...own.filter((o) => !ai.some((a) => a.blockId === o.blockId && a.kind === o.kind))].slice(0, QUIZ_SIZE);
      if (!made.length) throw new Error("There isn't enough in this section to ask about yet.");
      const stamp = Date.now().toString(36);
      const qs: Question[] = made.map((m, i) => ({ ...m, id: `${sectionId}:${stamp}:${i}`, sectionId, section: sec.title }));
      set((s) => ({ questions: [...s.questions.filter((q) => q.sectionId !== sectionId), ...qs] }));
      save(get());
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: null, stage: null });
    }
  },
  grade(id, g, before, first) {
    const next = review(before, g);
    set((s) => ({ reviews: { ...s.reviews, [id]: next } }));
    save(get());
    if (first) logAnswer();
    return next;
  },
  dueCount() {
    return get().due().length;
  },
  due() {
    const { questions, reviews } = get();
    const now = Date.now();
    return questions.filter((q) => reviews[q.id] && reviews[q.id].due <= now);
  },
}));

/** Up to `max` characters drawn evenly from every part of a long text, so a chapter quiz covers all of it. */
export function sample(text: string, max: number): string {
  if (text.length <= max) return text;
  const parts = text.split(/\n\n+/);
  const share = Math.max(200, Math.floor(max / parts.length));
  const out: string[] = [];
  let used = 0;
  const step = parts.length * share > max * 1.6 ? Math.ceil((parts.length * share) / max) : 1;
  for (let k = 0; k < parts.length && used < max; k += step) {
    const piece = parts[k].length > share ? `${parts[k].slice(0, share)}…` : parts[k];
    out.push(piece);
    used += piece.length;
  }
  return out.join("\n\n");
}

function upgrade(reviews: Record<string, Card | LegacyReview> | undefined): Record<string, Card> {
  const out: Record<string, Card> = {};
  for (const [k, r] of Object.entries(reviews ?? {})) out[k] = ready(r);
  return out;
}

function save(s: StudyStore) {
  if (s.bookId) void platform.stateSet(`study:${s.bookId}`, { questions: s.questions, reviews: s.reviews });
}

// ---------- the daily review, across every book ----------

export interface DueItem {
  bookId: string;
  bookTitle: string;
  q: Question;
  card: Card;
}

/** What's due now, how many questions there are in all, and when the next one comes due. */
export async function overview(books: { id: string; title: string }[]): Promise<{ due: DueItem[]; total: number; next: number | null }> {
  const now = Date.now();
  const out: DueItem[] = [];
  let total = 0;
  let next: number | null = null;
  for (const b of books) {
    const cur = useStudy.getState();
    const saved = cur.bookId === b.id ? { questions: cur.questions, reviews: cur.reviews } : await platform.stateGet<Saved>(`study:${b.id}`);
    if (!saved) continue;
    const reviews = upgrade(saved.reviews);
    for (const q of sound(saved.questions)) {
      const card = reviews[q.id];
      if (!card) continue;
      total++;
      if (card.due <= now) out.push({ bookId: b.id, bookTitle: b.title, q, card });
      else if (next === null || card.due < next) next = card.due;
    }
  }
  return { due: out.sort((a, b) => a.card.due - b.card.due), total, next };
}

/** Grades a question of any book (the open one or one on the shelf). */
export function gradeIn(bookId: string, id: string, g: Grade, before: Card | undefined, first: boolean): Card {
  const cur = useStudy.getState();
  if (cur.bookId === bookId) return cur.grade(id, g, before, first);
  const next = review(before, g);
  // Saves are queued per book so quick answers don't overwrite each other.
  pending = pending.then(async () => {
    const saved = await platform.stateGet<Saved>(`study:${bookId}`);
    if (saved) await platform.stateSet(`study:${bookId}`, { questions: saved.questions, reviews: { ...upgrade(saved.reviews), [id]: next } });
  });
  if (first) logAnswer();
  return next;
}
let pending: Promise<void> = Promise.resolve();

/** Answers per day, for the streak. */
type Log = Record<string, number>;
let log: Log | null = null;
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function readLog(): Promise<Log> {
  log ??= (await platform.stateGet<Log>("study:log")) ?? {};
  return log;
}

function logAnswer() {
  void readLog().then((l) => {
    l[today()] = (l[today()] ?? 0) + 1;
    void platform.stateSet("study:log", l);
  });
}

/** Days in a row with at least one answer, ending today (or yesterday, if today isn't done yet). */
export async function streak(): Promise<{ days: number; today: number }> {
  const l = await readLog();
  const d = new Date();
  const done = l[today(d)] ?? 0;
  if (!done) d.setDate(d.getDate() - 1);
  let n = 0;
  while (l[today(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return { days: n, today: done };
}

interface Section {
  title: string;
  chapter: string;
  text: string;
  start: number;
  end: number;
}

/**
 * The text a quiz covers: from its heading to the next heading of the same or a
 * higher level — or, for short sections grouped together, up to the quiz's place.
 */
export function sectionOf(book: BookDoc, ix: BookIndex, headingId: string): Section {
  const start = ix.byId.get(headingId) ?? 0;
  const head = book.blocks[start];
  const level = head.kind === "heading" ? head.level : 1;
  const groupEnd = groups.get(book)?.get(headingId);
  let end = start + 1;
  if (groupEnd !== undefined) end = groupEnd;
  else
    while (end < book.blocks.length) {
      const b = book.blocks[end];
      if (b.kind === "heading" && b.level <= level) break;
      end++;
    }
  const parts: string[] = [];
  for (let i = start + 1; i < end; i++) {
    const b = book.blocks[i];
    if (b.kind === "paragraph" || b.kind === "list" || b.kind === "callout" || b.kind === "box" || (b.kind === "heading" && b.level > level)) parts.push(ix.texts[i]);
  }
  const ch = book.chapters[head.chapter];
  const unit = ix.units.units.find((u) => u.start === start);
  return { title: unit?.title ?? (head.kind === "heading" ? head.text : ""), chapter: unit?.chapterTitle ?? ch?.title ?? "", text: parts.join("\n\n"), start, end };
}

/** For short sections grouped under one quiz: the group's first heading → where the group ends. */
const groups = new WeakMap<BookDoc, Map<string, number>>();

/**
 * Where quizzes go: one at the end of each of Kenning's chapters (reading
 * units), covering all of it, after its last passage and before its reference
 * list. The folded front and back matter get none.
 * Returns: id of the last block covered → id of the block the quiz starts at.
 */
export function quizSections(book: BookDoc, ix: BookIndex): Map<string, string> {
  const out = new Map<string, string>();
  const ends = new Map<string, number>();
  const readable = (k: number) => {
    const b = book.blocks[k];
    // The part's own tables and figures come before its quiz; its reference list after.
    return b.kind === "paragraph" || b.kind === "list" || b.kind === "callout" || b.kind === "box" || b.kind === "table" || b.kind === "figure";
  };
  for (const u of ix.units.units) {
    if (u.kind !== "read") continue;
    const words = (u.end < book.blocks.length ? ix.wordsBefore[u.end] : ix.totalWords) - ix.wordsBefore[u.start];
    if (words < 150) continue;
    let last = u.end - 1;
    while (last > u.start && !readable(last)) last--;
    out.set(book.blocks[last].id, book.blocks[u.start].id);
    ends.set(book.blocks[u.start].id, u.end);
  }
  groups.set(book, ends);
  return out;
}

const SYSTEM = `You write self-test questions for a student reading a textbook (often dental or medical).
Rules:
- Use ONLY facts stated in the section text. Never add outside knowledge.
- Ask about what matters: definitions, how things work, how similar things differ, numbers and thresholds that matter clinically.
- Write 6 multiple-choice questions spread across the whole text (beginning, middle and end), each with 4 options: one clearly right, three plausible wrong ones from the same topic, similar in length. No "all of the above" or "none of the above".
- Vary the kinds: "definition", "compare" (how two things differ), "number" (a value, dose, threshold or percentage), "concept" (why or how).
- If the section describes diagnosis or treatment, make one of them a "case": a 1–2 sentence patient description, asking for the most likely diagnosis or the best next step, answerable from the text.
- For every question give "quote": the sentence from the text, copied word for word, that proves the answer.
- Reply with JSON only, in exactly this shape:
{"questions":[{"kind":"definition","q":"…","options":["…","…","…","…"],"answer":0,"quote":"…"}]}`;

async function fromModel(sec: Section): Promise<Draft[]> {
  const text = sample(sec.text, 7000);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Chapter: ${sec.chapter}\nSection: ${sec.title}\n\nSection text:\n"""${text}"""\n\nWrite the questions as JSON.` },
  ];
  let out = "";
  await streamChat(messages, (t) => (out += t)).done;
  return parseQuestions(out);
}

/** Keeps the model's questions whose quote is really in the section and whose answer is in that quote. */
function ground(drafts: Draft[], blocks: { id: string; text: string }[], sectionText: string): Draft[] {
  const out: Draft[] = [];
  for (const d of drafts) {
    const found = d.why ? findQuote(d.why, blocks) : null;
    if (!found) continue;
    const answer = d.type === "mcq" ? d.options![d.answer as number] : String(d.answer);
    // Filler wrong options ("Something unrelated") make a question pointless: wrong
    // options should come from the topic, sharing words with the section.
    if (d.type === "mcq" && d.options!.filter((o, i) => i !== d.answer && offTopic(o, sectionText)).length >= 2) continue;
    const source = blocks.find((b) => b.id === found.blockId)?.text ?? "";
    // A patient case's answer (a diagnosis, a next step) need only be in the section.
    if (!answerInQuote(answer, d.kind === "case" ? sectionText : `${found.sentence} ${source}`)) continue;
    out.push({ ...d, why: found.sentence, blockId: found.blockId });
  }
  return out;
}

function offTopic(option: string, text: string): boolean {
  if (/\d/.test(option)) return false;
  const words = option.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
  const hay = text.toLowerCase();
  return !words.some((w) => hay.includes(w.slice(0, Math.max(4, w.length - 2))));
}

const CHECK = `You check self-test questions against a textbook section.
For each question, answer ok=true only if the section text clearly supports the marked answer AND none of the other options is also correct according to the text.
Reply with JSON only: {"verdicts":[{"n":1,"ok":true}]}`;

/** A second pass: the model confirms each marked answer is right and the only right one. */
async function confirm(sec: Section, drafts: Draft[]): Promise<Draft[]> {
  const text = sample(sec.text, 7000);
  const list = drafts
    .map((d, i) => `${i + 1}. ${d.q}\n${(d.options ?? []).map((o, k) => `   ${String.fromCharCode(65 + k)}) ${o}${k === d.answer ? "   ← marked answer" : ""}`).join("\n")}`)
    .join("\n\n");
  let out = "";
  try {
    await streamChat(
      [
        { role: "system", content: CHECK },
        { role: "user", content: `Section text:\n"""${text}"""\n\nQuestions:\n${list}\n\nReply with the JSON verdicts.` },
      ],
      (t) => (out += t),
    ).done;
  } catch {
    return drafts;
  }
  const cleaned = out.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  try {
    const data = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as { verdicts?: { n: number; ok: boolean }[] };
    const bad = new Set((data.verdicts ?? []).filter((v) => v.ok === false).map((v) => v.n - 1));
    return drafts.filter((_, i) => !bad.has(i));
  } catch {
    // An unreadable check keeps the grounded questions.
    return drafts;
  }
}

const KINDS = new Set<QuestionKind>(["definition", "acronym", "term", "number", "table", "concept", "case"]);

/** Pulls the questions out of a model reply, tolerating extra text, code fences and small slips. */
export function parseQuestions(reply: string): Draft[] {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (data as { questions?: unknown[] }).questions ?? [];
  const out: Draft[] = [];
  for (const raw of list) {
    const q = raw as Record<string, unknown>;
    const text = typeof q.q === "string" ? q.q.trim() : "";
    if (!text) continue;
    const why = typeof q.quote === "string" ? q.quote.trim() : typeof q.why === "string" ? q.why.trim() : undefined;
    const kindRaw = typeof q.kind === "string" ? q.kind.toLowerCase() : "concept";
    const kind = (kindRaw === "compare" ? "concept" : KINDS.has(kindRaw as QuestionKind) ? kindRaw : "concept") as QuestionKind;
    if (Array.isArray(q.options) && q.options.length >= 3) {
      const options = q.options.map((o) => String(o).trim().replace(/^[A-D][).:]\s+/, "")).filter(Boolean).slice(0, 5);
      if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) continue;
      if (options.some((o) => /^(all|none) of the above/i.test(o))) continue;
      const answer =
        typeof q.answer === "number" ? q.answer : /^[A-D]$/i.test(String(q.answer).trim()) ? String(q.answer).trim().toUpperCase().charCodeAt(0) - 65 : options.findIndex((o) => o === String(q.answer).trim());
      if (answer >= 0 && answer < options.length) out.push({ kind, type: "mcq", q: text, options, answer, why });
    } else if (typeof q.answer === "string" && q.answer.trim()) {
      out.push({ kind, type: "short", q: text, answer: q.answer.trim(), why });
    }
  }
  return out.slice(0, 8);
}
