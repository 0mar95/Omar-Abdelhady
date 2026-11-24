// Entry point: PDF bytes → BookDoc. Works in the browser (renderer) and in Node
// (tests and the command-line extractor); the caller passes in pdf.js.

import { repairPrivateGlyphs } from "./glyphs.ts";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BookDoc } from "../model.ts";
import { analyzeBook } from "./analyze.ts";
import { loadPage, type PdfjsLike, type RawPage } from "./load.ts";

export interface ExtractProgress {
  phase: "reading" | "analyzing";
  done: number;
  total: number;
}

export async function extractFromDocument(
  doc: PDFDocumentProxy,
  pdfjs: PdfjsLike,
  meta: { id: string; fileName: string },
  onProgress?: (p: ExtractProgress) => void,
): Promise<BookDoc> {
  const started = Date.now();
  const raw: RawPage[] = [];
  let failed = 0;
  let lastError: unknown;
  for (let i = 0; i < doc.numPages; i++) {
    try {
      raw.push(await loadPage(doc, i, pdfjs));
    } catch (e) {
      // A damaged page shouldn't stop the whole book: keep its place, empty.
      failed++;
      lastError = e;
      const prev = raw[raw.length - 1];
      raw.push({ index: i, w: prev?.w ?? 612, h: prev?.h ?? 792, runs: [], graphics: [] });
    }
    if (onProgress && (i % 4 === 0 || i === doc.numPages - 1)) onProgress({ phase: "reading", done: i + 1, total: doc.numPages });
  }
  if (failed === doc.numPages) throw lastError instanceof Error ? lastError : new Error("None of this PDF's pages could be read.");
  if (failed) console.warn(`${failed} of ${doc.numPages} pages couldn't be read and were left empty`);
  onProgress?.({ phase: "analyzing", done: 0, total: 1 });
  let title: string | undefined;
  let author: string | undefined;
  try {
    const md = await doc.getMetadata();
    const info = md.info as { Title?: string; Author?: string } | undefined;
    title = info?.Title?.trim() || undefined;
    author = info?.Author?.trim() || undefined;
  } catch {
    /* metadata is optional */
  }
  // Ligatures drawn with private glyphs ("e\uE01Aects") get their letters back.
  repairPrivateGlyphs(raw);
  const book = analyzeBook(raw, { ...meta, title, author }, started);
  onProgress?.({ phase: "analyzing", done: 1, total: 1 });
  return book;
}

/** Stable id from file size and a sample of its bytes (fast for large files). */
export async function bookIdFor(data: Uint8Array): Promise<string> {
  const sample = new Uint8Array(Math.min(data.length, 1 << 20) + 8);
  sample.set(data.subarray(0, sample.length - 8));
  new DataView(sample.buffer).setFloat64(sample.length - 8, data.length);
  const digest = await crypto.subtle.digest("SHA-256", sample);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
