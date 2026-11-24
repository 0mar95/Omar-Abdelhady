// Study mode: questions written from a section's own text, answered in the
// page, with the ones you miss coming back later (a simple spaced schedule).
// Questions come from the local model; without it, fill-in-the-blank
// questions are made from the terms the book itself sets in bold.

import { create } from "zustand";
import type { ChatMessage } from "../../../shared/ipc";
import type { BookDoc } from "../../../shared/model";
import { streamChat } from "../ai";
import { platform } from "../platform";
import type { BookIndex } from "./reader";

export interface Question {
  id: string;
  /** The heading that opens the section the question comes from. */
  sectionId: string;
  section: string;
  q: string;
  type: "mcq" | "short";
  options?: string[];
  /** For mcq: index of the right option. For short: the model answer. */
  answer: number | string;
  why?: string;
}

export interface Review {
  /** Next time the question is due (ms). */
  due: number;
  /** Days until the next review after a right answer. */
  interval: number;
  right: number;
  wrong: number;
  last?: "right" | "wrong";
}

interface StudyStore {
  bookId: string | null;
  questions: Question[];
  reviews: Record<string, Review>;
  busy: string | null;
  error: string | null;
  load(bookId: string): Promise<void>;
  generate(book: BookDoc, ix: BookIndex, sectionId: string): Promise<void>;
  grade(id: string, right: boolean): void;
  dueCount(): number;
  due(): Question[];
}

const DAY = 86_400_000;

export const useStudy = create<StudyStore>((set, get) => ({
  bookId: null,
  questions: [],
  reviews: {},
  busy: null,
  error: null,
  async load(bookId) {
    set({ bookId, questions: [], reviews: {}, error: null });
    const saved = await platform.stateGet<{ questions: Question[]; reviews: Record<string, Review> }>(`study:${bookId}`);
    if (saved && get().bookId === bookId) set({ questions: saved.questions ?? [], reviews: saved.reviews ?? {} });
  },
  async generate(book, ix, sectionId) {
    if (get().busy) return;
    set({ busy: sectionId, error: null });
    try {
      const sec = sectionOf(book, ix, sectionId);
      let made = await fromModel(sec).catch(() => [] as Omit<Question, "id" | "sectionId" | "section">[]);
      if (made.length < 2) made = [...made, ...cloze(book, ix, sec)].slice(0, 5);
      if (!made.length) throw new Error("This section is too short to ask about.");
      const qs: Question[] = made.map((m, i) => ({ ...m, id: `${sectionId}:${Date.now().toString(36)}:${i}`, sectionId, section: sec.title }));
      set((s) => ({ questions: [...s.questions.filter((q) => q.sectionId !== sectionId), ...qs] }));
      save(get());
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: null });
    }
  },
  grade(id, right) {
    const prev = get().reviews[id] ?? { due: 0, interval: 0, right: 0, wrong: 0 };
    const now = Date.now();
    // Right: wait longer each time (1, 3, 8, 20… days). Wrong: back tomorrow, from the start.
    const interval = right ? Math.max(1, Math.round((prev.interval || 0.4) * 2.5)) : 1;
    const next: Review = { due: now + interval * DAY, interval: right ? interval : 0, right: prev.right + (right ? 1 : 0), wrong: prev.wrong + (right ? 0 : 1), last: right ? "right" : "wrong" };
    set((s) => ({ reviews: { ...s.reviews, [id]: next } }));
    save(get());
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

function save(s: StudyStore) {
  if (s.bookId) void platform.stateSet(`study:${s.bookId}`, { questions: s.questions, reviews: s.reviews });
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
  return { title: head.kind === "heading" ? head.text : "", chapter: ch?.title ?? "", text: parts.join("\n\n"), start, end };
}

/** For short sections grouped under one quiz: the group's first heading → where the group ends. */
const groups = new WeakMap<BookDoc, Map<string, number>>();

/**
 * Where quizzes go: after each section (chapter or section level) with enough
 * to ask about; short neighbouring sections are grouped until there is.
 * Returns: id of the last block covered → id of the heading the quiz starts at.
 */
export function quizSections(book: BookDoc, ix: BookIndex): Map<string, string> {
  const out = new Map<string, string>();
  const ends = new Map<string, number>();
  const bounds = book.blocks.map((b, i) => (b.kind === "heading" && b.level <= 2 ? i : -1)).filter((i) => i >= 0);
  const wordsIn = (a: number, z: number) => {
    let n = 0;
    for (let i = a; i < z; i++) {
      const b = book.blocks[i];
      if (b.kind === "paragraph" || b.kind === "list" || b.kind === "callout" || b.kind === "box") n += (ix.texts[i].match(/\S+/g) ?? []).length;
    }
    return n;
  };
  let groupStart = -1;
  for (let k = 0; k < bounds.length; k++) {
    const at = bounds[k];
    const next = bounds[k + 1] ?? book.blocks.length;
    const head = book.blocks[at];
    // A new chapter never joins the previous chapter's group.
    if (head.kind === "heading" && head.level === 1 && groupStart >= 0 && wordsIn(groupStart, at) >= 120) close(groupStart, at);
    if (head.kind === "heading" && head.level === 1) groupStart = -1;
    if (groupStart < 0) groupStart = at;
    if (wordsIn(groupStart, next) >= 220) {
      close(groupStart, next);
      groupStart = -1;
    }
  }
  if (groupStart >= 0 && wordsIn(groupStart, book.blocks.length) >= 120) close(groupStart, bounds.find((b) => b > groupStart && (book.blocks[b] as { level?: number }).level === 1) ?? book.blocks.length);
  groups.set(book, ends);
  return out;

  function close(from: number, to: number) {
    const last = book.blocks[to - 1];
    const head = book.blocks[from];
    if (!last || !head) return;
    out.set(last.id, head.id);
    ends.set(head.id, to);
  }
}

const SYSTEM = `You write short self-test questions for a student reading a textbook.
Rules:
- Use ONLY facts stated in the given section text. Never add outside knowledge.
- Ask about the most important ideas: definitions, mechanisms, distinguishing features, numbers that matter clinically.
- Mix 3 multiple-choice questions (4 options, one clearly right, plausible wrong ones from the same topic) and 1 or 2 short-answer questions.
- Reply with JSON only, no prose, in exactly this shape:
{"questions":[{"type":"mcq","q":"…","options":["…","…","…","…"],"answer":0,"why":"one sentence from the text"},{"type":"short","q":"…","answer":"…","why":"…"}]}`;

async function fromModel(sec: Section): Promise<Omit<Question, "id" | "sectionId" | "section">[]> {
  const text = sec.text.length > 7000 ? `${sec.text.slice(0, 7000)}…` : sec.text;
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Chapter: ${sec.chapter}\nSection: ${sec.title}\n\nSection text:\n"""${text}"""\n\nWrite the questions as JSON.` },
  ];
  let out = "";
  await streamChat(messages, (t) => (out += t)).done;
  return parseQuestions(out);
}

/** Pulls the questions out of a model reply, tolerating extra text, code fences and small slips. */
export function parseQuestions(reply: string): Omit<Question, "id" | "sectionId" | "section">[] {
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
  const out: Omit<Question, "id" | "sectionId" | "section">[] = [];
  for (const raw of list) {
    const q = raw as Record<string, unknown>;
    const text = typeof q.q === "string" ? q.q.trim() : "";
    if (!text) continue;
    const why = typeof q.why === "string" ? q.why.trim() : undefined;
    if (Array.isArray(q.options) && q.options.length >= 2) {
      const options = q.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
      const answer = typeof q.answer === "number" ? q.answer : options.findIndex((o) => o === String(q.answer).trim());
      if (answer >= 0 && answer < options.length) out.push({ type: "mcq", q: text, options, answer, why });
    } else if (typeof q.answer === "string" && q.answer.trim()) {
      out.push({ type: "short", q: text, answer: q.answer.trim(), why });
    }
  }
  return out.slice(0, 6);
}

/** Offline questions: a sentence that sets a term in bold, with the term blanked out. */
function cloze(book: BookDoc, ix: BookIndex, sec: Section): Omit<Question, "id" | "sectionId" | "section">[] {
  const out: Omit<Question, "id" | "sectionId" | "section">[] = [];
  const terms: string[] = [];
  for (let i = sec.start + 1; i < sec.end && out.length < 4; i++) {
    const b = book.blocks[i];
    if (b.kind !== "paragraph") continue;
    const bold = b.spans.filter((s) => s.b && s.text.trim().length > 3 && s.text.trim().split(" ").length <= 5).map((s) => s.text.trim());
    terms.push(...bold);
    for (const term of bold) {
      const sentence = ix.texts[i].split(/(?<=[.!?])\s+/).find((s) => s.includes(term));
      if (!sentence || sentence.length < 40 || sentence.length > 320) continue;
      out.push({ type: "short", q: `Fill in the blank: ${sentence.replace(term, "_____")}`, answer: term, why: sentence });
      break;
    }
  }
  return out;
}
