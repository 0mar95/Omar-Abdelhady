// Copies a range of pages from a PDF into a new, smaller PDF, keeping fonts
// and text exactly as they are (for sharing a few pages of a book that reads
// wrongly, when the whole file is too big to send).
//   npm run slice -- "path/to/book.pdf" 20 60
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

const [file, fromArg = "1", toArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: npm run slice -- "path/to/book.pdf" <first page> <last page>');
  process.exit(1);
}
const src = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true, updateMetadata: false });
const count = src.getPageCount();
const from = Math.max(1, Number(fromArg));
const to = Math.min(count, Number(toArg ?? from + 39));
const out = await PDFDocument.create();
const pages = await out.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
for (const p of pages) out.addPage(p);
const bytes = await out.save();
const target = path.join(path.dirname(file), `${path.basename(file, path.extname(file))} - pages ${from}-${to}.pdf`);
fs.writeFileSync(target, bytes);
console.log(`Wrote ${target} (${(bytes.length / 1e6).toFixed(1)} MB, ${to - from + 1} of ${count} pages)`);
