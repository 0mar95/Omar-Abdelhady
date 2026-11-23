// End-to-end check of the extractor on a real book. Books are not part of the
// repository; point BOOK_PDF at a PDF to run it:
//   BOOK_PDF=~/Books/orofacial-pain.pdf npm test
import fs from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { blockText } from "../model.ts";
import { bookIdFor, extractFromDocument } from "./extract.ts";

const file = process.env.BOOK_PDF;

describe.skipIf(!file)("extractFromDocument (real book)", () => {
  it("rebuilds a readable book", async () => {
    const bytes = new Uint8Array(fs.readFileSync(file!));
    const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, disableFontFace: true, fontExtraProperties: true }).promise;
    const book = await extractFromDocument(doc, pdfjs, { id: await bookIdFor(bytes), fileName: path.basename(file!) });

    expect(book.blocks.length).toBeGreaterThan(50);
    expect(book.toc.length).toBeGreaterThan(3);
    // No paragraph should still contain line-break hyphenation or ligature glyphs.
    const text = book.blocks.map(blockText).join("\n");
    expect(text).not.toMatch(/[ﬀ-ﬆ]/);
    // Repeated page furniture (running footers, watermarks) must be gone.
    const lines = text.split("\n");
    const counts = new Map<string, number>();
    for (const l of lines) if (l.length > 30) counts.set(l, (counts.get(l) ?? 0) + 1);
    const repeated = [...counts.values()].filter((n) => n > book.pageCount * 0.2);
    expect(repeated).toEqual([]);
    // Most paragraphs inside chapters start at a sentence start, not mid-sentence.
    const paras = book.blocks.filter((b) => b.kind === "paragraph" && b.chapter > 0);
    const broken = paras.filter((b) => /^[a-z]/.test(blockText(b).trim()));
    expect(broken.length / Math.max(1, paras.length)).toBeLessThan(0.03);
    // A printed contents page becomes one list, without leader glyphs.
    const contents = book.blocks.filter((b) => b.kind === "contents");
    if (contents.length) {
      for (const c of contents) for (const e of c.kind === "contents" ? c.entries : []) expect(e.title).not.toMatch(/[.!·…_]{2,}$/);
    }
    // Block ids are unique.
    expect(new Set(book.blocks.map((b) => b.id)).size).toBe(book.blocks.length);
  }, 300_000);
});
