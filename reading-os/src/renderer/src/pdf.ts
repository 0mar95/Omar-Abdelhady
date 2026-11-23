// pdf.js in the renderer: opening documents, running the extractor, and
// rendering parts of pages (figures, original tables, page view).

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { EXTRACTOR_VERSION, type BookDoc, type Rect } from "../../shared/model";
import { bookIdFor, extractFromDocument, type ExtractProgress } from "../../shared/pdf/extract";
import { platform } from "./platform";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (p: string) => new URL(`pdfjs/${p}`, document.baseURI).href;

export function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given; keep ours intact.
    data: bytes.slice(),
    cMapUrl: asset("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: asset("standard_fonts/"),
    wasmUrl: asset("wasm/"),
    fontExtraProperties: true,
    verbosity: 0,
  }).promise;
}

export { bookIdFor };

const cacheKey = (id: string) => `book-${id}-v${EXTRACTOR_VERSION}`;

/** Returns the structured book, from cache when this file was opened before. */
export async function loadOrExtract(
  doc: PDFDocumentProxy,
  id: string,
  fileName: string,
  onProgress: (p: ExtractProgress) => void,
): Promise<BookDoc> {
  const cached = await platform.cacheGet(cacheKey(id));
  if (cached) {
    try {
      const book = JSON.parse(cached) as BookDoc;
      if (book.version === EXTRACTOR_VERSION) return book;
    } catch {
      /* corrupt cache: extract again */
    }
  }
  const book = await extractFromDocument(doc, pdfjs, { id, fileName }, onProgress);
  await platform.cacheSet(cacheKey(id), JSON.stringify(book));
  return book;
}

// ---------- rendering ----------

const regionCache = new Map<string, Promise<string>>();

/** Renders a rectangle of a page to an image URL (cached for the session). */
export function renderRegion(doc: PDFDocumentProxy, pageIndex: number, rect: Rect, width: number): Promise<string> {
  const scale = Math.min(4, Math.max(1, (width * window.devicePixelRatio) / Math.max(1, rect.x1 - rect.x0)));
  const key = `${doc.fingerprints[0]}|${pageIndex}|${rect.x0.toFixed(1)},${rect.y0.toFixed(1)},${rect.x1.toFixed(1)},${rect.y1.toFixed(1)}|${scale.toFixed(2)}`;
  let p = regionCache.get(key);
  if (!p) {
    p = (async () => {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale, offsetX: -rect.x0 * scale, offsetY: -rect.y0 * scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil((rect.x1 - rect.x0) * scale);
      canvas.height = Math.ceil((rect.y1 - rect.y0) * scale);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      return blob ? URL.createObjectURL(blob) : canvas.toDataURL();
    })();
    regionCache.set(key, p);
    p.catch(() => regionCache.delete(key));
  }
  return p;
}

export { pdfjs };
