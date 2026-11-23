import { create } from "zustand";
import { platform } from "../platform";

export interface LibraryEntry {
  id: string;
  title: string;
  fileName: string;
  path?: string;
  pageCount: number;
  words: number;
  chapters: number;
  addedAt: number;
  openedAt: number;
  /** 0..1 */
  progress: number;
  position?: string;
}

interface LibraryStore {
  entries: LibraryEntry[];
  loaded: boolean;
  load(): Promise<void>;
  upsert(e: LibraryEntry): void;
  update(id: string, patch: Partial<LibraryEntry>): void;
  remove(id: string): void;
}

const persist = (entries: LibraryEntry[]) => void platform.stateSet("library", entries);

export const useLibrary = create<LibraryStore>((set, get) => ({
  entries: [],
  loaded: false,
  async load() {
    const entries = (await platform.stateGet<LibraryEntry[]>("library")) ?? [];
    set({ entries, loaded: true });
  },
  upsert(e) {
    const entries = [e, ...get().entries.filter((x) => x.id !== e.id)];
    set({ entries });
    persist(entries);
  },
  update(id, patch) {
    const entries = get().entries.map((x) => (x.id === id ? { ...x, ...patch } : x));
    set({ entries });
    persist(entries);
  },
  remove(id) {
    const entries = get().entries.filter((x) => x.id !== id);
    set({ entries });
    persist(entries);
  },
}));
