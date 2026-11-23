// Margin notes and indexing status for the open book, kept in sync with the
// background work in the main process.

import { create } from "zustand";
import type { IndexStatus, MarginNote } from "../../../shared/ipc";
import { platform } from "../platform";
import { useSettings } from "./settings";

interface NotesStore {
  bookId: string | null;
  notes: Map<string, MarginNote>;
  /** Heading block whose note is being written right now. */
  working: string | null;
  status: IndexStatus | null;
  open(bookId: string, title: string, blockIndex: number): Promise<void>;
  close(): void;
}

export const useNotes = create<NotesStore>((set, get) => ({
  bookId: null,
  notes: new Map(),
  working: null,
  status: null,
  async open(bookId, title, blockIndex) {
    set({ bookId, notes: new Map(), working: null, status: null });
    const status = await platform.indexBook(bookId, title, blockIndex);
    const notes = await platform.notesList(bookId);
    if (get().bookId !== bookId) return;
    set({ status, notes: new Map(notes.map((n) => [n.blockId, n])) });
  },
  close() {
    set({ bookId: null, notes: new Map(), working: null, status: null });
  },
}));

let wired = false;

/** Subscribes once to main-process events and keeps AI settings in sync. */
export function wireBackground(): void {
  if (wired) return;
  wired = true;
  platform.onIndexStatus((s) => {
    if (s.bookId === useNotes.getState().bookId) useNotes.setState({ status: s });
  });
  platform.onNoteEvent((e) => {
    const st = useNotes.getState();
    if (e.type === "working") {
      if (e.bookId === st.bookId) useNotes.setState({ working: e.blockId });
      return;
    }
    if (e.note.bookId !== st.bookId) return;
    const notes = new Map(st.notes);
    notes.set(e.note.blockId, e.note);
    useNotes.setState({ notes });
  });
  const push = () => {
    const s = useSettings.getState();
    void platform.aiConfigure({ baseUrl: s.ollamaUrl, chatModel: s.model, embedModel: s.embedModel, notes: s.marginNotes });
  };
  push();
  useSettings.subscribe((s, prev) => {
    if (s.ollamaUrl !== prev.ollamaUrl || s.model !== prev.model || s.embedModel !== prev.embedModel || s.marginNotes !== prev.marginNotes) push();
  });
}

let posTimer: ReturnType<typeof setTimeout> | undefined;

/** Tells the background worker where the reader is, so notes are written nearby first. */
export function reportPosition(bookId: string, blockIndex: number): void {
  clearTimeout(posTimer);
  posTimer = setTimeout(() => platform.readingPosition(bookId, blockIndex), 800);
}
