// Inline AI: prompts, context from the book structure, and the cards that
// stream answers directly under the text the reader selected.

import { create } from "zustand";
import type { ChatMessage } from "../../shared/ipc";
import type { BookDoc } from "../../shared/model";
import { platform, type ChatHandle } from "./platform";
import type { BookIndex } from "./state/reader";
import { useSettings } from "./state/settings";

export type ActionKind = "explain" | "summarize" | "terms" | "simplify" | "ask";

export const ACTIONS: Record<ActionKind, { label: string; short: string; key: string }> = {
  explain: { label: "Explain", short: "Explain", key: "E" },
  simplify: { label: "Simplify", short: "Simplify", key: "S" },
  summarize: { label: "Summarize", short: "Summary", key: "U" },
  terms: { label: "Key terms", short: "Key terms", key: "T" },
  ask: { label: "Ask…", short: "Answer", key: "A" },
};

const SYSTEM = `You are a reading companion built into a book reader. The reader selected a passage and wants help understanding it.
Rules:
- Ground every statement in the provided book text. If the text doesn't support something, say so briefly instead of guessing.
- Be concise and concrete. No preamble, no closing offers, no restating the question.
- Use plain Markdown only: short paragraphs, "- " bullets, **bold** for terms. No headings, no tables.`;

const TASKS: Record<Exclude<ActionKind, "ask">, string> = {
  explain:
    "Explain the selected passage so a motivated non-expert understands it. Define any technical terms inline, say why it matters in the context of this section, and use one short example if it helps. 120 words at most.",
  simplify:
    "Rewrite the selected passage in plain, simple language (about a high-school reading level). Keep every fact and number; drop jargon or define it in parentheses. Keep it about the same length or shorter.",
  summarize: "Summarize the selected passage in 2–4 bullet points, most important idea first. Each bullet one sentence.",
  terms:
    'List the key terms and concepts in the selected passage as bullets in the form "- **term** — definition". Use the book\'s own definitions when the context gives them. 3–7 terms.',
};

export interface ReadingContext {
  bookTitle: string;
  chapter: string;
  sections: string[];
  before: string;
  paragraph: string;
  selection: string;
}

/** Collects the chapter, section path and nearby text for a block. */
export function contextFor(book: BookDoc, ix: BookIndex, blockId: string, selection: string): ReadingContext {
  const i = ix.byId.get(blockId) ?? 0;
  const block = book.blocks[i];
  const chapter = book.chapters[block.chapter];
  const sections: string[] = [];
  let level = 5;
  for (let k = i; k >= 0 && level > 2; k--) {
    const b = book.blocks[k];
    if (b.kind === "heading" && b.level < level && b.level > 1) {
      sections.unshift(b.text);
      level = b.level;
    }
    if (b.kind === "heading" && b.level === 1) break;
  }
  let before = "";
  for (let k = i - 1; k >= 0 && before.length < 900; k--) {
    const b = book.blocks[k];
    if (b.kind === "heading") break;
    if (b.kind === "paragraph" || b.kind === "list") before = `${ix.texts[k]}\n${before}`;
  }
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  return {
    bookTitle: book.title,
    chapter: chapter ? `${chapter.number ? `Chapter ${chapter.number}: ` : ""}${chapter.title}` : "",
    sections,
    before: clip(before.trim(), 1200),
    paragraph: clip(ix.texts[i], 2400),
    selection: clip(selection.trim(), 2400),
  };
}

export function buildMessages(kind: ActionKind, ctx: ReadingContext, question?: string): ChatMessage[] {
  const where = [ctx.bookTitle && `Book: ${ctx.bookTitle}`, ctx.chapter, ...ctx.sections.map((s) => `Section: ${s}`)].filter(Boolean).join("\n");
  const task = kind === "ask" ? `Answer the reader's question about the selected passage: ${question}` : TASKS[kind];
  const user = `${where}

Preceding text:
"""${ctx.before || "(start of section)"}"""

Paragraph containing the selection:
"""${ctx.paragraph}"""

Selected passage:
"""${ctx.selection}"""

Task: ${task}`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

// ---------- streaming ----------

const mockMode = () => new URLSearchParams(location.search).has("mockAI") || useSettings.getState().model === "mock";

/** Offline stand-in used by automated tests (?mockAI) so the UI can be exercised without Ollama. */
function mockChat(messages: ChatMessage[], onText: (t: string) => void): ChatHandle {
  const recap = /Most recently read text[^\n]*\n"""([\s\S]*?)"""/.exec(messages[1].content);
  const sel = recap?.[1] ?? /Selected passage:\n"""([\s\S]*?)"""/.exec(messages[1].content)?.[1] ?? "";
  const words = sel.split(/\s+/).filter((w) => w.length > 6).slice(0, 4);
  const heads = [...sel.matchAll(/^## (.+)$/gm)].map((m) => m[1]).slice(-3);
  const text = recap
    ? `${(heads.length ? heads : ["the recent pages"]).map((h) => `- You read about **${h}**.`).join("\n")}\n- Key words along the way: ${words.map((w) => w.replace(/[^\w-]/g, "")).join(", ") || "none"}.\n\nYou stopped as the text was building on that. _(Demo recap — connect Ollama for a real one.)_`
    : `**In short:** this passage is about ${words.map((w) => w.replace(/[^\w-]/g, "")).join(", ") || "the topic at hand"}.\n\n- It introduces the idea and why it matters here.\n- It links back to the surrounding section.\n\n_(Demo answer — connect Ollama for real explanations.)_`;
  let stopped = false;
  const done = (async () => {
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      if (stopped) return;
      await new Promise((r) => setTimeout(r, 18));
      onText(piece);
    }
  })();
  return { done, abort: () => (stopped = true) };
}

export function streamChat(messages: ChatMessage[], onText: (t: string) => void): ChatHandle {
  if (mockMode()) return mockChat(messages, onText);
  const s = useSettings.getState();
  return platform.chat({ model: s.model, baseUrl: s.ollamaUrl, messages }, onText);
}

// ---------- cards ----------

export interface Card {
  id: string;
  blockId: string;
  kind: ActionKind;
  quote: string;
  question?: string;
  text: string;
  status: "streaming" | "done" | "error";
  error?: string;
  collapsed: boolean;
  createdAt: number;
}

interface CardStore {
  bookId: string | null;
  cards: Card[];
  load(bookId: string): Promise<void>;
  run(kind: ActionKind, blockId: string, quote: string, ctx: ReadingContext, question?: string, replace?: string): string;
  /** Keeps a finished answer (e.g. from ⌘K) as a card under a block. */
  pin(blockId: string, question: string, text: string): void;
  remove(id: string): void;
  toggle(id: string): void;
  stop(id: string): void;
}

const handles = new Map<string, ChatHandle>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function persist(bookId: string | null, cards: Card[]) {
  if (!bookId) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void platform.stateSet(
      `cards:${bookId}`,
      cards.filter((c) => c.status !== "error").map((c) => ({ ...c, status: c.status === "streaming" ? "done" : c.status })),
    );
  }, 400);
}

export const useCards = create<CardStore>((set, get) => ({
  bookId: null,
  cards: [],
  async load(bookId) {
    set({ bookId, cards: [] });
    const saved = (await platform.stateGet<Card[]>(`cards:${bookId}`)) ?? [];
    if (get().bookId === bookId) set({ cards: saved });
  },
  run(kind, blockId, quote, ctx, question, replace) {
    const id = replace ?? crypto.randomUUID();
    const card: Card = { id, blockId, kind, quote, question, text: "", status: "streaming", collapsed: false, createdAt: Date.now() };
    handles.get(id)?.abort();
    set((s) => ({ cards: replace ? s.cards.map((c) => (c.id === id ? card : c)) : [...s.cards, card] }));
    const update = (patch: Partial<Card>) => {
      set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
      persist(get().bookId, get().cards);
    };
    let text = "";
    const handle = streamChat(buildMessages(kind, ctx, question), (t) => {
      text += t;
      update({ text });
    });
    handles.set(id, handle);
    handle.done
      .then(() => update({ status: "done" }))
      .catch((e: unknown) => update({ status: "error", error: e instanceof Error ? e.message : String(e) }))
      .finally(() => handles.delete(id));
    return id;
  },
  pin(blockId, question, text) {
    const card: Card = { id: crypto.randomUUID(), blockId, kind: "ask", quote: question, question, text, status: "done", collapsed: false, createdAt: Date.now() };
    const cards = [...get().cards, card];
    set({ cards });
    persist(get().bookId, cards);
  },
  remove(id) {
    handles.get(id)?.abort();
    const cards = get().cards.filter((c) => c.id !== id);
    set({ cards });
    persist(get().bookId, cards);
  },
  toggle(id) {
    const cards = get().cards.map((c) => (c.id === id ? { ...c, collapsed: !c.collapsed } : c));
    set({ cards });
    persist(get().bookId, cards);
  },
  stop(id) {
    handles.get(id)?.abort();
  },
}));
