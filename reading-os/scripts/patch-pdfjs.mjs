// Small fixes to pdf.js for PDFs found in the wild. Applied after every
// `npm install` and before `npm run dev`; safe to run repeatedly.
//
// 1. Glyph names like "u006b" (lowercase hex) are read as the characters they
//    name. pdf.js only accepts "u006B"; some PDFs (often re-saved by sharing
//    tools) name every glyph in lowercase and have an empty ToUnicode table,
//    so their text came out scrambled ("radiati'3" for "radiation").
// 2. A broken entry in a PDF's list of pages (one that isn't a page) is
//    skipped. pdf.js stopped at it, so every page after it failed to load
//    ("Page dictionary kid reference points to wrong type of object").
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = ["build/pdf.worker.mjs", "build/pdf.worker.min.mjs", "legacy/build/pdf.worker.mjs", "legacy/build/pdf.worker.min.mjs"];

const patches = [
  {
    marker: "/*readingos-hex*/",
    // In getUnicodeForGlyph: `if (hexStr === hexStr.toUpperCase())` → accept any hex digits.
    re: /(substring\(1\)[^]{0,90}?if\s*\()([\w$]+)\s*===\s*\2\.toUpperCase\(\)/,
    to: (_m, pre, v) => `${pre}/*readingos-hex*//^[0-9A-Fa-f]+$/.test(${v})`,
  },
  {
    marker: "/*readingos-kids*/",
    // In Catalog.getPageDict: skip a kid that isn't a page or page node, instead of failing.
    re: /throw new [\w$]+\("Page dictionary kid reference points to wrong type of object\."\);/,
    to: () => "/*readingos-kids*/continue;",
  },
];

let patched = 0;
for (const f of files) {
  const p = path.join(root, "node_modules/pdfjs-dist", f);
  if (!fs.existsSync(p)) continue;
  let src = fs.readFileSync(p, "utf8");
  let changed = false;
  for (const { marker, re, to } of patches) {
    if (src.includes(marker)) continue;
    if (!re.test(src)) {
      console.warn(`pdf.js patch ${marker}: pattern not found in ${f} (pdf.js may have changed)`);
      continue;
    }
    src = src.replace(re, to);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(p, src);
    patched++;
  }
}
if (patched) console.log(`pdf.js patched in ${patched} file(s)`);
