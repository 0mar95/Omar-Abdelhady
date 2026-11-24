// Highlights: passages the reader marked, saved per book on this computer.

import { create } from "zustand";
import { platform } from "../platform";

export interface Highlight {
  id: string;
  blockId: string;
  text: string;
  at: number;
}

interface HighlightStore {
  bookId: string | null;
  list: Highlight[];
  load(bookId: string): Promise<void>;
  add(blockId: string, text: string): void;
  remove(id: string): void;
}

const key = (bookId: string) => `highlights:${bookId}`;

export const useHighlights = create<HighlightStore>((set, get) => ({
  bookId: null,
  list: [],
  async load(bookId) {
    set({ bookId, list: [] });
    const saved = await platform.stateGet<Highlight[]>(key(bookId));
    if (get().bookId === bookId) set({ list: Array.isArray(saved) ? saved : [] });
  },
  add(blockId, text) {
    const { bookId, list } = get();
    const clean = text.replace(/\s+/g, " ").trim();
    if (!bookId || clean.length < 2 || list.some((h) => h.blockId === blockId && h.text === clean)) return;
    const next = [...list, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, blockId, text: clean, at: Date.now() }];
    set({ list: next });
    void platform.stateSet(key(bookId), next);
  },
  remove(id) {
    const { bookId, list } = get();
    const next = list.filter((h) => h.id !== id);
    set({ list: next });
    if (bookId) void platform.stateSet(key(bookId), next);
  },
}));

/** Paints highlights with the CSS Custom Highlight API: no change to the book's DOM. */
export function paintHighlights(root: HTMLElement, list: Highlight[]): void {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const Ctor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !Ctor) return;
  const ranges: Range[] = [];
  for (const h of list) {
    const el = root.querySelector(`[data-block="${CSS.escape(h.blockId)}"]`);
    if (!el) continue;
    const r = findText(el, h.text);
    if (r) ranges.push(r);
  }
  registry.set("reader-hl", new Ctor(...ranges));
}

/** A range for `text` inside `el`, matching across elements and ignoring whitespace differences. */
function findText(el: Element, text: string): Range | null {
  const map: { node: Text; offset: number }[] = [];
  let flat = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let lastSpace = true;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const space = /\s/.test(t[i]);
      if (space && lastSpace) continue;
      flat += space ? " " : t[i];
      map.push({ node: n, offset: i });
      lastSpace = space;
    }
  }
  const at = flat.indexOf(text);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + text.length - 1];
  const r = document.createRange();
  r.setStart(start.node, start.offset);
  r.setEnd(end.node, end.offset + 1);
  return r;
}
