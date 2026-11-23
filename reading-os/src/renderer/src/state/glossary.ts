// The open book's glossary: terms extracted from the text, short AI
// definitions (asked for when a term is first hovered), and a fast matcher
// used to mark terms in the reading view.

import { create } from "zustand";
import type { BookDoc } from "../../../shared/model";
import { buildMatcher, extractGlossary, firstMentions, type GlossaryTerm, type TermMatch } from "../../../shared/glossary/extract";
import { platform } from "../platform";
import type { BookIndex } from "./reader";

interface GlossaryStore {
  bookId: string | null;
  terms: GlossaryTerm[];
  byKey: Map<string, GlossaryTerm>;
  match: ((text: string) => TermMatch[]) | null;
  /** Terms to mark per block (first mention in each section). */
  allowed: Map<string, Set<string>>;
  /** Short plain-language definitions written by the local model. */
  ai: Record<string, string>;
  pending: Set<string>;
  failed: Set<string>;
  load(book: BookDoc, ix: BookIndex): void;
  close(): void;
  request(key: string): void;
}

let wired = false;

export const useGlossary = create<GlossaryStore>((set, get) => ({
  bookId: null,
  terms: [],
  byKey: new Map(),
  match: null,
  allowed: new Map(),
  ai: {},
  pending: new Set(),
  failed: new Set(),

  load(book, ix) {
    set({ bookId: book.id, terms: [], byKey: new Map(), match: null, allowed: new Map(), ai: {}, pending: new Set(), failed: new Set() });
    if (!wired) {
      wired = true;
      platform.onGlossaryEvent((e) => {
        const st = useGlossary.getState();
        if (e.bookId !== st.bookId) return;
        const pending = new Set(st.pending);
        pending.delete(e.key);
        if ("failed" in e) set({ pending, failed: new Set(st.failed).add(e.key) });
        else set({ pending, ai: { ...st.ai, [e.key]: e.definition } });
      });
    }
    // Extraction takes a fraction of a second; let the first page paint first.
    const run = () => {
      if (get().bookId !== book.id) return;
      const terms = extractGlossary(book);
      const match = buildMatcher(terms);
      set({ terms, byKey: new Map(terms.map((t) => [t.key, t])), match, allowed: firstMentions(book, match) });
      void ix;
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(run, { timeout: 800 });
    else setTimeout(run, 200);
    void platform.glossaryDefinitions(book.id).then((ai) => {
      if (get().bookId === book.id) set({ ai: { ...ai, ...get().ai } });
    });
  },

  close() {
    set({ bookId: null, terms: [], byKey: new Map(), match: null, allowed: new Map(), ai: {}, pending: new Set(), failed: new Set() });
  },

  request(key) {
    const st = get();
    const t = st.byKey.get(key);
    if (!t || !st.bookId || st.ai[key] || st.pending.has(key) || st.failed.has(key)) return;
    set({ pending: new Set(st.pending).add(key) });
    const bookId = st.bookId;
    void platform
      .glossaryDefine(bookId, { key: t.key, term: t.term, expansion: t.expansion, definition: t.definition, context: contextFor(t) })
      .then((def) => {
        const now = get();
        if (now.bookId !== bookId) return;
        if (def) {
          const pending = new Set(now.pending);
          pending.delete(key);
          set({ pending, ai: { ...now.ai, [key]: def } });
        } else if (!platform.hasIndex) {
          // Browser build: no background worker to answer.
          const pending = new Set(now.pending);
          pending.delete(key);
          set({ pending, failed: new Set(now.failed).add(key) });
        }
      });
  },
}));

let contextBook: { book: BookDoc; ix: BookIndex } | null = null;

export function setGlossaryContext(book: BookDoc, ix: BookIndex): void {
  contextBook = { book, ix };
}

/** The paragraph around a term's definition, to ground the short definition. */
function contextFor(t: GlossaryTerm): string | undefined {
  if (!contextBook) return undefined;
  return contextBook.ix.texts[t.blockIndex]?.slice(0, 1800);
}
