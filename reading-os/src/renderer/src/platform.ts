// Everything that differs between the desktop app (Electron) and the browser
// build used for development and automated tests.

import type {
  AiConfig,
  AiStatus,
  ChatChunk,
  ChatRequest,
  IndexStatus,
  MarginNote,
  NoteEvent,
  OpenedFile,
  ReadingOSApi,
  SearchHit,
  SearchParams,
} from "../../shared/ipc";

declare global {
  interface Window {
    readingOS?: ReadingOSApi;
  }
}

export interface ChatHandle {
  done: Promise<void>;
  abort(): void;
}

export interface Platform {
  kind: "electron" | "web";
  pickPdf(): Promise<OpenedFile | null>;
  fileFromDrop(file: File): Promise<OpenedFile>;
  /** Keeps the bytes (web) or the path (desktop) so the book can be reopened. */
  rememberBook(id: string, file: OpenedFile): Promise<void>;
  loadBook(id: string, path?: string): Promise<Uint8Array | null>;
  cacheGet(key: string): Promise<string | null>;
  cacheSet(key: string, value: string): Promise<void>;
  stateGet<T>(key: string): Promise<T | null>;
  stateSet(key: string, value: unknown): Promise<void>;
  aiStatus(baseUrl: string): Promise<AiStatus>;
  chat(req: ChatRequest, onText: (t: string) => void): ChatHandle;
  onMenu(cb: (action: string) => void): () => void;
  /** Whether search runs on the local index (desktop) or the simple in-page fallback (browser). */
  hasIndex: boolean;
  aiConfigure(cfg: AiConfig): Promise<void>;
  indexBook(bookId: string, title: string, blockIndex: number): Promise<IndexStatus | null>;
  onIndexStatus(cb: (s: IndexStatus) => void): () => void;
  search(p: SearchParams): Promise<SearchHit[] | null>;
  notesList(bookId: string): Promise<MarginNote[]>;
  onNoteEvent(cb: (e: NoteEvent) => void): () => void;
  readingPosition(bookId: string, blockIndex: number): void;
}

// ---------- Electron ----------

function electronPlatform(api: ReadingOSApi): Platform {
  const listeners = new Map<string, (c: ChatChunk) => void>();
  api.onAiChunk((c) => listeners.get(c.id)?.(c));
  return {
    kind: "electron",
    pickPdf: () => api.openPdfDialog(),
    async fileFromDrop(file) {
      return { path: api.pathForFile(file) || undefined, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },
    async rememberBook() {
      /* the library entry keeps the file path */
    },
    async loadBook(_id, path) {
      return path ? api.readFile(path) : null;
    },
    cacheGet: (k) => api.cacheGet(k),
    cacheSet: (k, v) => api.cacheSet(k, v),
    stateGet: async <T,>(k: string) => (await api.stateGet(k)) as T | null,
    stateSet: (k, v) => api.stateSet(k, v),
    aiStatus: (base) => api.aiStatus(base),
    chat(req, onText) {
      const id = crypto.randomUUID();
      const done = new Promise<void>((resolve, reject) => {
        listeners.set(id, (c) => {
          if (c.text) onText(c.text);
          if (c.done) {
            listeners.delete(id);
            if (c.error) reject(new Error(c.error));
            else resolve();
          }
        });
      });
      void api.aiChat(id, req);
      return { done, abort: () => void api.aiAbort(id) };
    },
    onMenu: (cb) => api.onMenu(cb),
    hasIndex: true,
    aiConfigure: (cfg) => api.aiConfigure(cfg),
    indexBook: (id, title, blockIndex) => api.indexBook(id, title, blockIndex),
    onIndexStatus: (cb) => api.onIndexStatus(cb),
    search: (p) => api.search(p),
    notesList: (id) => api.notesList(id),
    onNoteEvent: (cb) => api.onNoteEvent(cb),
    readingPosition: (id, blockIndex) => void api.readingPosition(id, blockIndex),
  };
}

// ---------- Browser ----------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("reading-os", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => resolve((r.result as T) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage unavailable (private window): the app still works for this session */
  }
}

function webPlatform(): Platform {
  return {
    kind: "web",
    pickPdf() {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/pdf,.pdf";
        input.onchange = async () => {
          const f = input.files?.[0];
          resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
        };
        input.click();
      });
    },
    async fileFromDrop(file) {
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },
    rememberBook: (id, file) => kvSet(`bytes:${id}`, file.bytes),
    loadBook: (id) => kvGet<Uint8Array>(`bytes:${id}`),
    cacheGet: (k) => kvGet<string>(`cache:${k}`),
    cacheSet: (k, v) => kvSet(`cache:${k}`, v),
    stateGet: <T,>(k: string) => kvGet<T>(`state:${k}`),
    stateSet: (k, v) => kvSet(`state:${k}`, v),
    async aiStatus(base) {
      try {
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
        const body = (await res.json()) as { models?: { name: string }[] };
        return { ok: res.ok, models: (body.models ?? []).map((m) => m.name).sort() };
      } catch (e) {
        return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
      }
    },
    chat(req, onText) {
      const ctrl = new AbortController();
      const done = (async () => {
        const res = await fetch(`${req.baseUrl}/api/chat`, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            stream: true,
            think: false,
            keep_alive: "30m",
            options: { temperature: req.temperature ?? 0.3, num_ctx: req.numCtx ?? 8192 },
          }),
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(res.status === 404 ? `The model "${req.model}" isn't installed. Run: ollama pull ${req.model}` : `Ollama error ${res.status} ${text}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const msg = JSON.parse(line) as { message?: { content?: string }; error?: string };
            if (msg.error) throw new Error(msg.error);
            if (msg.message?.content) onText(msg.message.content);
          }
        }
      })().catch((e) => {
        if (!ctrl.signal.aborted) throw e;
      });
      return { done, abort: () => ctrl.abort() };
    },
    onMenu: () => () => {},
    // The browser build has no local index: search falls back to scanning the
    // open book, and margin notes are a desktop feature.
    hasIndex: false,
    aiConfigure: async () => {},
    indexBook: async () => null,
    onIndexStatus: () => () => {},
    search: async () => null,
    notesList: async () => [],
    onNoteEvent: () => () => {},
    readingPosition: () => {},
  };
}

export const platform: Platform = window.readingOS ? electronPlatform(window.readingOS) : webPlatform();
