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

export interface ReadingOSApi {
  platform: string;
  openPdfDialog(): Promise<OpenedFile | null>;
  readFile(path: string): Promise<Uint8Array | null>;
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
}
