// Opening books that aren't PDFs (EPUB, Word, HTML, Markdown, text) in the
// app: conversion with the browser's own HTML parser, caching like PDFs, and
// the book's images.

import { unzipSync } from "fflate";
import { EXTRACTOR_VERSION, type BookDoc } from "../../shared/model";
import { convertBook, type ConvertEnv } from "../../shared/formats";
import { platform } from "./platform";

const env: ConvertEnv = {
  parse: (s, type) => new DOMParser().parseFromString(s, type),
  async docxToHtml(bytes) {
    const mammoth = await import("mammoth");
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const result = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: ab });
    return result.value;
  },
  async markdownToHtml(md) {
    const { marked } = await import("marked");
    return marked.parse(md, { async: false }) as string;
  },
};

const cacheKey = (id: string) => `book-${id}-v${EXTRACTOR_VERSION}`;

/** The book (from cache when possible) and, for EPUBs, the files its images come from. */
export async function loadOrConvert(bytes: Uint8Array, id: string, fileName: string): Promise<{ book: BookDoc; files: Record<string, Uint8Array> | null }> {
  const cached = await platform.cacheGet(cacheKey(id));
  if (cached) {
    try {
      const book = JSON.parse(cached) as BookDoc;
      if (book.version === EXTRACTOR_VERSION) return { book, files: book.format === "epub" ? unzipSync(bytes) : null };
    } catch {
      /* convert again */
    }
  }
  const { book, files } = await convertBook(bytes, { id, fileName }, env);
  await platform.cacheSet(cacheKey(id), JSON.stringify(book));
  return { book, files: files ?? null };
}

// ---------- images ----------

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

let files: Record<string, Uint8Array> | null = null;
const urls = new Map<string, string>();

/** Called when a book opens (and with null when it closes). */
export function setBookFiles(f: Record<string, Uint8Array> | null): void {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  files = f;
}

/** A displayable URL for a figure's image reference. */
export function imageUrl(ref: string): string | undefined {
  if (ref.startsWith("data:")) return ref;
  const have = urls.get(ref);
  if (have) return have;
  const data = files?.[ref];
  if (!data) return undefined;
  const ext = /\.([a-z0-9]+)$/i.exec(ref)?.[1]?.toLowerCase() ?? "";
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] ?? "application/octet-stream" }));
  urls.set(ref, url);
  return url;
}
