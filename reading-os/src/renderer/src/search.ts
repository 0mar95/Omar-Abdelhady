// Search and question answering over the library. The desktop app uses the
// local index (exact words + meaning); the browser build scans the open book.

import type { ChatMessage, SearchHit, SearchParams } from "../../shared/ipc";
import { streamChat } from "./ai";
import { platform, type ChatHandle } from "./platform";
import { useReader } from "./state/reader";

export async function searchBooks(p: SearchParams): Promise<SearchHit[]> {
  const indexed = await platform.search(p).catch(() => null);
  if (indexed) return indexed;
  return scanOpenBook(p);
}

/** Fallback without the index: every word must appear in the block. */
function scanOpenBook(p: SearchParams): SearchHit[] {
  const { book, ix } = useReader.getState();
  if (!book || !ix || (p.bookId && p.bookId !== book.id)) return [];
  const terms = p.q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (let i = 0; i < book.blocks.length && hits.length < (p.limit ?? 20); i++) {
    const b = book.blocks[i];
    if (b.kind === "index" || b.kind === "heading" || b.kind === "references" || b.kind === "contents") continue;
    if (p.maxBlock !== undefined && i > p.maxBlock) break;
    const text = ix.texts[i];
    const lower = text.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) continue;
    const at = Math.max(0, lower.indexOf(terms[0]) - 60);
    let snippet = text.slice(at, at + 200).replace(/\s+/g, " ");
    for (const t of terms) snippet = snippet.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "\u0001$1\u0002");
    hits.push({
      bookId: book.id,
      bookTitle: book.title,
      chunkId: i,
      blockId: b.id,
      blockIndex: i,
      chapter: b.chapter,
      section: book.chapters[b.chapter]?.title ?? "",
      page: b.page,
      kind: b.kind,
      snippet: `${at > 0 ? "…" : ""}${snippet}…`,
      text,
      match: "exact",
      score: 1,
    });
  }
  return hits;
}

const ASK_SYSTEM = `You answer a reader's question using only the numbered sources from their books.
Rules:
- Cite the sources you use like [1] or [2][3], right after the statement they support.
- If the sources don't contain the answer, say so in one sentence and suggest a better search; don't use outside knowledge.
- Be concise: a direct answer first, then up to 4 short bullet points if helpful. Plain Markdown, no headings.`;

export function askMessages(question: string, sources: SearchHit[]): ChatMessage[] {
  const list = sources
    .map((s, i) => `[${i + 1}] ${s.bookTitle} · ${s.section}${s.kind !== "text" ? ` (${s.kind})` : ""}\n"""${s.text.slice(0, 1800)}"""`)
    .join("\n\n");
  return [
    { role: "system", content: ASK_SYSTEM },
    { role: "user", content: `Question: ${question}\n\nSources:\n${list}` },
  ];
}

/** Retrieves passages, then streams an answer that cites them. */
export function askBooks(
  question: string,
  scope: Omit<SearchParams, "q" | "limit">,
  on: { sources(s: SearchHit[]): void; text(t: string): void },
): ChatHandle {
  let inner: ChatHandle | null = null;
  let stopped = false;
  const done = (async () => {
    const hits = await searchBooks({ q: question, ...scope, limit: 12 });
    // Reference lists rarely answer questions; use them only if nothing else matched.
    const text = hits.filter((h) => h.kind !== "refs");
    const sources = (text.length ? text : hits).slice(0, 6);
    on.sources(sources);
    if (stopped) return;
    if (!sources.length) {
      on.text("Nothing in the book matches this question yet. Try different words, or turn off “Only what I've read”.");
      return;
    }
    inner = streamChat(askMessages(question, sources), on.text);
    await inner.done;
  })();
  return {
    done,
    abort() {
      stopped = true;
      inner?.abort();
    },
  };
}
