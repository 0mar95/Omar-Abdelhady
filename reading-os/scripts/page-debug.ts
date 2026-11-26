// Debug: the text lines (font, size, position) and drawn shapes of one PDF page.
//   node --experimental-strip-types scripts/page-debug.ts book.pdf <page index>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPage } from "../src/shared/pdf/load.ts";
import { buildLines, fontStats } from "../src/shared/pdf/lines.ts";

const [file, pageArg] = process.argv.slice(2);
const pdfDir = path.join(path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json"))), "/");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0, disableFontFace: true, useSystemFonts: false, fontExtraProperties: true, cMapUrl: pdfDir + "cmaps/", cMapPacked: true, standardFontDataUrl: pdfDir + "standard_fonts/" }).promise;
const sample = [];
for (let i = 0; i < Math.min(doc.numPages, 40); i += 3) sample.push(await loadPage(doc, i, pdfjs as never));
const stats = fontStats(sample);
const page = await loadPage(doc, Number(pageArg), pdfjs as never);
console.log("body:", stats, "page", page.w, "x", page.h, "graphics:", page.graphics.length, "images:", page.graphics.filter((g) => g.kind === "image").length);
for (const l of buildLines(page, stats)) console.log(`${l.top.toFixed(0).padStart(4)} x${l.x0.toFixed(0).padStart(4)}-${l.x1.toFixed(0).padEnd(4)} ${l.size.toFixed(1)} ${l.firstBold ? "B" : " "} ${l.firstFont.slice(0, 22).padEnd(22)} ${l.text.slice(0, 70)}`);
const paths = page.graphics.filter((g) => g.kind === "path");
console.log("paths bbox sample:", paths.slice(0, 8).map((g) => `${g.x0.toFixed(0)},${g.y0.toFixed(0)}-${g.x1.toFixed(0)},${g.y1.toFixed(0)}`).join(" "));
