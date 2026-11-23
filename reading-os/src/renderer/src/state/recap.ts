// "Catch me up": a recap of what the reader has already read, streamed from
// the local model and kept per book so reopening at the same place is instant.

import { create } from "zustand";
import { recapMaterial, recapMessages, type RecapMaterial, type RecapScope } from "../../../shared/recap";
import { streamChat } from "../ai";
import { platform, type ChatHandle } from "../platform";
import { useNotes } from "./notes";
import { useReader } from "./reader";
import { useSettings } from "./settings";

interface Saved {
  blockId: string;
  model: string;
  text: string;
  createdAt: number;
}

interface RecapStore {
  scope: RecapScope;
  /** Scope asked for by a command; the panel opens on "recent" otherwise. */
  pending: RecapScope | null;
  material: RecapMaterial | null;
  text: string;
  status: "idle" | "streaming" | "done" | "error" | "empty";
  error?: string;
  start(scope: RecapScope, fresh?: boolean): Promise<void>;
  stop(): void;
}

let handle: ChatHandle | null = null;
let run = 0;

export const useRecap = create<RecapStore>((set, get) => ({
  scope: "recent",
  pending: null,
  material: null,
  text: "",
  status: "idle",

  async start(scope, fresh = false) {
    handle?.abort();
    handle = null;
    const token = ++run;
    const { book, ix, currentBlock } = useReader.getState();
    if (!book || !ix) return;
    const pos = currentBlock ? ix.byId.get(currentBlock) ?? 0 : 0;
    set({ scope, material: null, text: "", status: "streaming", error: undefined });

    // Notes already on screen, plus any the main process has stored.
    const notes = new Map<string, { summary: string }>(useNotes.getState().notes);
    if (useNotes.getState().bookId !== book.id || !notes.size)
      for (const n of await platform.notesList(book.id).catch(() => [])) if (!notes.has(n.blockId)) notes.set(n.blockId, n);
    if (token !== run) return;
    const material = recapMaterial(book, pos, scope, notes);
    if (material.empty) {
      set({ material, status: "empty" });
      return;
    }
    set({ material });

    const model = useSettings.getState().model;
    const key = `recap:${book.id}`;
    const saved = ((await platform.stateGet<Partial<Record<RecapScope, Saved>>>(key)) ?? {}) as Partial<Record<RecapScope, Saved>>;
    if (token !== run) return;
    const hit = saved[scope];
    if (!fresh && hit && hit.blockId === material.stoppedAt.blockId && hit.model === model && hit.text) {
      set({ text: hit.text, status: "done" });
      return;
    }

    const chapter = book.chapters[book.blocks[pos]?.chapter ?? 0];
    const chapterTitle = chapter ? `${chapter.number ? `Chapter ${chapter.number}: ` : ""}${chapter.title}` : "";
    let text = "";
    const h = streamChat(recapMessages(book.title, chapterTitle, material), (t) => {
      if (token !== run) return;
      text += t;
      set({ text });
    });
    handle = h;
    try {
      await h.done;
      if (token !== run) return;
      set({ status: "done" });
      if (text.trim()) {
        const latest = ((await platform.stateGet<Partial<Record<RecapScope, Saved>>>(key)) ?? {}) as Partial<Record<RecapScope, Saved>>;
        void platform.stateSet(key, { ...latest, [scope]: { blockId: material.stoppedAt.blockId, model, text, createdAt: Date.now() } });
      }
    } catch (e) {
      if (token === run) set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (handle === h) handle = null;
    }
  },

  stop() {
    run++;
    handle?.abort();
    handle = null;
    if (get().status === "streaming") set({ status: "idle" });
  },
}));

/** Opens the recap panel, optionally on a given scope. */
export function openRecap(scope?: RecapScope): void {
  useRecap.setState({ pending: scope ?? null });
  useReader.getState().setOverlay("recap");
}
