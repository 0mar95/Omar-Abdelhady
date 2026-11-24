// Book covers for the library: the real cover when the book has one (a PDF's
// first page, an EPUB's cover image), made once as a small JPEG and cached;
// otherwise the library draws a generated cover from the title.

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import type { BookDoc } from "../../shared/model";
import { imageUrl } from "./formats";
import { platform } from "./platform";

const WIDTH = 360; // pixels; covers show at up to ~180 CSS px on 2x screens
const key = (id: string) => `cover-${id}`;
const listeners = new Set<(id: string) => void>();

/** Makes and caches a cover for a newly opened book, if it has a real one. */
export async function ensureCover(book: BookDoc, doc: PDFDocumentProxy | null): Promise<void> {
  try {
    if (await platform.cacheGet(key(book.id))) return;
    const url = doc ? await pdfCover(doc) : await imageCover(book);
    if (!url) return;
    await platform.cacheSet(key(book.id), url);
    for (const l of listeners) l(book.id);
  } catch {
    /* a book without a cover gets a generated one */
  }
}

async function pdfCover(doc: PDFDocumentProxy): Promise<string | null> {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: WIDTH / base.width });
  // Very wide first pages (spreads, slides) don't make covers.
  if (base.width > base.height * 1.1) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport, background: "#ffffff" }).promise;
  if (isBlank(canvas)) return null;
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function imageCover(book: BookDoc): Promise<string | null> {
  // EPUBs open with their cover image: the first image in the first two documents.
  const tp = book.blocks.find((b) => b.kind === "titlepage");
  const fig = book.blocks.find((b) => b.kind === "figure" && b.image && b.page <= 1);
  const image = tp?.kind === "titlepage" && tp.cover ? tp.cover : fig?.kind === "figure" ? fig.image : undefined;
  const src = image ? imageUrl(image) : undefined;
  if (!src) return null;
  const img = new Image();
  img.src = src;
  await img.decode();
  if (img.naturalHeight < img.naturalWidth * 1.1) return null; // not cover-shaped
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * WIDTH);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** A first page with (almost) nothing on it is no cover. */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4 * 7) if (data[i] + data[i + 1] + data[i + 2] < 690) ink++;
  return ink / (data.length / (4 * 7)) < 0.01;
}

/** The cached cover for a book, or null (then draw a generated one). */
export function useCover(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void platform.cacheGet(key(id)).then((u) => alive && setUrl(u || null));
    load();
    const l = (changed: string) => changed === id && load();
    listeners.add(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
  }, [id]);
  return url;
}

export function removeCover(id: string): void {
  void platform.cacheSet(key(id), "");
}

// Generated covers: a muted color chosen from the title, so a book always looks the same.
const PALETTE = ["#2f4f4f", "#7a3b2e", "#34425c", "#4a5a3c", "#8a6a2f", "#5b3a55", "#3d5a6c", "#6b4f3a"];

export function coverColor(title: string): string {
  // FNV-1a with a final mix, so similar titles still land on different colors.
  let h = 0x811c9dc5;
  for (const c of title) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return PALETTE[(h >>> 0) % PALETTE.length];
}
