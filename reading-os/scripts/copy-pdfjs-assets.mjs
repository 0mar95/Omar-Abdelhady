// Copies pdf.js runtime assets (decoders, fonts, character maps) next to the
// renderer so they load locally, with no network access.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const from = path.join(root, "node_modules/pdfjs-dist");
const to = path.join(root, "src/renderer/public/pdfjs");
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  fs.cpSync(path.join(from, dir), path.join(to, dir), { recursive: true });
}
console.log("pdf.js assets copied to", path.relative(root, to));
