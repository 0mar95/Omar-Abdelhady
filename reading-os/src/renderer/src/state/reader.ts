import type { PDFDocumentProxy } from "pdfjs-dist";
import { create } from "zustand";
import type { OpenedFile } from "../../../shared/ipc";
import { blockText, type Block, type BookDoc } from "../../../shared/model";
import type { ExtractProgress } from "../../../shared/pdf/extract";
import { countWords } from "../../../shared/pdf/text";
import { bookIdFor, loadOrExtract, openPdf } from "../pdf";
import { platform } from "../platform";
import { useLibrary, type LibraryEntry } from "./library";
import { setGlossaryContext, useGlossary } from "./glossary";
import { reportPosition, useNotes } from "./notes";

export type View = "clean" | "page";
export type Overlay = null | "toc" | "type" | "palette" | "glossary";

/** Lookups derived once per book. */
export interface BookIndex {
  byId: Map<string, number>;
  /** Words before each block, for progress and time estimates. */
  wordsBefore: number[];
  totalWords: number;
  /** "Fig 1-1" → block id. */
  byKey: Map<string, string>;
  /** First block on or after each page. */
  pageFirstBlock: number[];
  texts: string[];
}

export function indexBook(book: BookDoc): BookIndex {
  const byId = new Map<string, number>();
  const byKey = new Map<string, string>();
  const wordsBefore: number[] = [];
  const texts: string[] = [];
  let words = 0;
  book.blocks.forEach((b, i) => {
    byId.set(b.id, i);
    wordsBefore.push(words);
    const t = blockText(b);
    texts.push(t);
    // References and the index are skimmed, not read: don't count them.
    if (b.kind !== "references" && b.kind !== "index") words += countWords(t);
    if ((b.kind === "figure" || b.kind === "table" || b.kind === "box") && b.key && !byKey.has(b.key)) byKey.set(b.key, b.id);
  });
  const pageFirstBlock: number[] = new Array(book.pageCount).fill(-1);
  book.blocks.forEach((b, i) => {
    if (pageFirstBlock[b.page] === -1) pageFirstBlock[b.page] = i;
  });
  // Pages without their own block point to the next block that exists.
  let next = book.blocks.length - 1;
  for (let p = book.pageCount - 1; p >= 0; p--) {
    if (pageFirstBlock[p] === -1) pageFirstBlock[p] = next;
    else next = pageFirstBlock[p];
  }
  return { byId, wordsBefore, totalWords: words, byKey, pageFirstBlock, texts };
}

export interface JumpTarget {
  blockId?: string;
  page?: number;
  /** Text to highlight inside the block after jumping. */
  highlight?: string;
  nonce: number;
}

interface ReaderStore {
  status: "idle" | "loading" | "ready" | "error";
  progress: ExtractProgress | null;
  error: string | null;
  book: BookDoc | null;
  ix: BookIndex | null;
  doc: PDFDocumentProxy | null;
  entry: LibraryEntry | null;
  view: View;
  overlay: Overlay;
  /** Text to prefill the palette with (e.g. a concept clicked in a margin note). */
  paletteQuery: string;
  currentBlock: string | null;
  currentPage: number;
  jump: JumpTarget | null;
  openFile(file: OpenedFile): Promise<void>;
  openEntry(entry: LibraryEntry): Promise<void>;
  close(): void;
  setView(v: View): void;
  setOverlay(o: Overlay): void;
  openPalette(query?: string): void;
  jumpTo(t: Omit<JumpTarget, "nonce">): void;
  setPosition(blockId: string): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useReader = create<ReaderStore>((set, get) => ({
  status: "idle",
  progress: null,
  error: null,
  book: null,
  ix: null,
  doc: null,
  entry: null,
  view: "clean",
  overlay: null,
  paletteQuery: "",
  currentBlock: null,
  currentPage: 0,
  jump: null,

  async openFile(file) {
    set({ status: "loading", progress: { phase: "reading", done: 0, total: 1 }, error: null, overlay: null });
    try {
      const id = await bookIdFor(file.bytes);
      const doc = await openPdf(file.bytes);
      const book = await loadOrExtract(doc, id, file.name, (p) => set({ progress: p }));
      await platform.rememberBook(id, file);
      const lib = useLibrary.getState();
      const existing = lib.entries.find((e) => e.id === id);
      const entry: LibraryEntry = {
        id,
        title: book.title,
        fileName: file.name,
        path: file.path ?? existing?.path,
        pageCount: book.pageCount,
        words: book.stats.words,
        chapters: book.chapters.length,
        addedAt: existing?.addedAt ?? Date.now(),
        openedAt: Date.now(),
        progress: existing?.progress ?? 0,
        position: existing?.position,
      };
      lib.upsert(entry);
      void get().doc?.loadingTask.destroy();
      const ix = indexBook(book);
      const start = entry.position && ix.byId.has(entry.position) ? entry.position : book.blocks[0]?.id;
      set({
        status: "ready",
        book,
        ix,
        doc,
        entry,
        progress: null,
        currentBlock: start ?? null,
        currentPage: start ? book.blocks[ix.byId.get(start)!].page : 0,
        jump: start ? { blockId: start, nonce: Date.now() } : null,
      });
      // Index for search and start margin notes around where the reader is.
      void useNotes.getState().open(id, book.title, start ? ix.byId.get(start) ?? 0 : 0);
      setGlossaryContext(book, ix);
      useGlossary.getState().load(book, ix);
    } catch (e) {
      console.error(e);
      set({ status: "error", error: e instanceof Error ? e.message : String(e), progress: null });
    }
  },

  async openEntry(entry) {
    set({ status: "loading", progress: { phase: "reading", done: 0, total: 1 }, error: null });
    const bytes = await platform.loadBook(entry.id, entry.path);
    if (!bytes) {
      set({ status: "error", error: `Couldn't open “${entry.fileName}”. It may have been moved or deleted — open it again from its new location.` });
      return;
    }
    await get().openFile({ name: entry.fileName, path: entry.path, bytes });
  },

  close() {
    useNotes.getState().close();
    useGlossary.getState().close();
    void get().doc?.loadingTask.destroy();
    set({ status: "idle", book: null, ix: null, doc: null, entry: null, overlay: null, jump: null });
  },

  setView(view) {
    set({ view });
  },

  setOverlay(overlay) {
    set({ overlay, paletteQuery: overlay === "palette" ? get().paletteQuery : "" });
  },

  openPalette(query = "") {
    set({ overlay: "palette", paletteQuery: query });
  },

  jumpTo(t) {
    const { book, ix } = get();
    let blockId = t.blockId;
    if (!blockId && t.page !== undefined && book && ix) blockId = book.blocks[ix.pageFirstBlock[t.page]]?.id;
    set({ jump: { ...t, blockId, nonce: Date.now() } });
  },

  setPosition(blockId) {
    const { book, ix, entry } = get();
    if (!book || !ix || !entry) return;
    const i = ix.byId.get(blockId);
    if (i === undefined) return;
    set({ currentBlock: blockId, currentPage: book.blocks[i].page });
    reportPosition(entry.id, i);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const progress = ix.totalWords ? Math.min(1, ix.wordsBefore[i] / ix.totalWords) : 0;
      useLibrary.getState().update(entry.id, { position: blockId, progress, openedAt: Date.now() });
    }, 600);
  },
}));

export function blockAt(book: BookDoc, ix: BookIndex, id: string | null): Block | undefined {
  if (!id) return undefined;
  const i = ix.byId.get(id);
  return i === undefined ? undefined : book.blocks[i];
}
