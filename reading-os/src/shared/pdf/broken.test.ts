import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { blockText } from "../model";
import { extractFromDocument } from "./extract";

/** A short book whose list of pages has one entry that isn't a page (seen in real PDFs). */
async function brokenBook(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= 5; i++) {
    const page = pdf.addPage([400, 600]);
    page.drawText(`Chapter text on page ${i}. The patient reported pain in the jaw joint.`, { x: 40, y: 540, size: 11, font });
  }
  const pages = pdf.catalog.lookup(PDFName.of("Pages"), PDFDict);
  pages.lookup(PDFName.of("Kids"), PDFArray).insert(2, pdf.context.register(PDFNumber.of(42)));
  return pdf.save({ useObjectStreams: false });
}

describe("damaged PDFs", () => {
  it("opens a book whose page list has a broken entry, with every real page", async () => {
    const data = await brokenBook();
    const doc = await pdfjs.getDocument({ data, verbosity: 0, disableFontFace: true, fontExtraProperties: true }).promise;
    const book = await extractFromDocument(doc, pdfjs, { id: "broken", fileName: "broken.pdf" });
    const text = book.blocks.map(blockText).join("\n");
    for (let i = 1; i <= 5; i++) expect(text).toContain(`page ${i}.`);
  });
});
