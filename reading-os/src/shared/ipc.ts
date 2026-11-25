// Contract between the renderer and the Electron main process. The preload
// script exposes exactly this API as `window.readingOS`.

export interface OpenedFile {
  /** Absolute path on disk, when known (used to reopen from the library). */
  path?: string;
  name: string;
  bytes: Uint8Array;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Ollama base URL, e.g. http://127.0.0.1:11434 */
  baseUrl: string;
  temperature?: number;
  numCtx?: number;
}

export interface ChatChunk {
  id: string;
  text?: string;
  done?: boolean;
  error?: string;
}

export interface AiStatus {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface ReadingOSApi extends LibraryApi, GlossaryApi {
  platform: string;
  openPdfDialog(): Promise<OpenedFile | null>;
  readFile(path: string): Promise<Uint8Array | null>;
  /** Shows the book's file in Finder / Explorer. */
  showFile(path: string): Promise<void>;
  /** Path of a File dropped onto the window. */
  pathForFile(file: File): string;
  cacheGet(key: string): Promise<string | null>;
  cacheSet(key: string, value: string): Promise<void>;
  stateGet(key: string): Promise<unknown>;
  stateSet(key: string, value: unknown): Promise<void>;
  aiStatus(baseUrl: string): Promise<AiStatus>;
  aiChat(id: string, req: ChatRequest): Promise<void>;
  aiAbort(id: string): Promise<void>;
  onAiChunk(cb: (chunk: ChatChunk) => void): () => void;
  onMenu(cb: (action: string) => void): () => void;
  voiceStatus(): Promise<VoiceStatus>;
  /** Downloads (first time) and loads the natural voices. */
  voicePrepare(): Promise<VoiceStatus>;
  voiceSpeak(text: string, voice: string, speed: number): Promise<{ rate: number; pcm: Float32Array }>;
  voiceCancel(): void;
  onVoiceStatus(cb: (s: VoiceStatus) => void): () => void;
}

/** The natural (neural) voices used by Listen. */
export type VoiceStatus =
  | { state: "missing" | "downloaded" | "ready" }
  | { state: "loading"; progress: number }
  | { state: "error"; message: string };

// ---------- Phase 2: library index, search, margin notes ----------

export interface AiConfig {
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  /** Generate margin notes in the background while reading. */
  notes: boolean;
}

export interface IndexStatus {
  bookId: string;
  state: "indexing" | "embedding" | "ready" | "no-embed-model" | "offline" | "unknown";
  chunks: number;
  embedded: number;
  embedModel: string;
  notes: number;
  message?: string;
}

export interface SearchParams {
  q: string;
  /** Limit to one book; all books when absent. */
  bookId?: string;
  /** Reading-position limit: only blocks up to this index (one book only). */
  maxBlock?: number;
  limit?: number;
}

export interface SearchHit {
  bookId: string;
  bookTitle: string;
  chunkId: number;
  blockId: string;
  blockIndex: number;
  chapter: number;
  section: string;
  page: number;
  kind: string;
  /** Short excerpt; matched words wrapped in \u0001…\u0002. */
  snippet: string;
  text: string;
  match: "exact" | "meaning" | "both";
  score: number;
}

export interface MarginNote {
  bookId: string;
  blockId: string;
  summary: string;
  concepts: string[];
  model: string;
  createdAt: number;
}

export type NoteEvent = { type: "note"; note: MarginNote } | { type: "working"; bookId: string; blockId: string | null };

export interface LibraryApi {
  aiConfigure(cfg: AiConfig): Promise<void>;
  indexBook(bookId: string, title: string, blockIndex: number): Promise<IndexStatus>;
  onIndexStatus(cb: (s: IndexStatus) => void): () => void;
  search(p: SearchParams): Promise<SearchHit[]>;
  notesList(bookId: string): Promise<MarginNote[]>;
  onNoteEvent(cb: (e: NoteEvent) => void): () => void;
  readingPosition(bookId: string, blockIndex: number): Promise<void>;
  /** The reader is scrolling: background AI work waits so scrolling stays smooth. */
  readerActivity(): void;
}

// ---------- Phase 3: glossary ----------

export interface DefineRequest {
  key: string;
  term: string;
  expansion?: string;
  /** The book's own defining sentence. */
  definition: string;
  /** The paragraph around it, for extra grounding. */
  context?: string;
}

export type GlossaryEvent = { bookId: string; key: string; definition: string } | { bookId: string; key: string; failed: true };

export interface BookMention {
  bookId: string;
  title: string;
  count: number;
  /** First block mentioning the term in that book. */
  blockId: string;
}

export interface GlossaryApi {
  glossaryDefinitions(bookId: string): Promise<Record<string, string>>;
  /** Returns a stored definition, or queues one and answers later via onGlossaryEvent. */
  glossaryDefine(bookId: string, req: DefineRequest): Promise<string | null>;
  onGlossaryEvent(cb: (e: GlossaryEvent) => void): () => void;
  glossaryMentions(phrases: string[], excludeBookId: string): Promise<BookMention[]>;
}
