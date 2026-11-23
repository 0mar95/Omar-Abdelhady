// Patches pdf.js so it reads glyph names like "u006b" (lowercase hex) as the
// characters they name. pdf.js only accepts "u006B"; some PDFs (often ones
// re-saved by sharing tools) name every glyph in lowercase and have an empty
// ToUnicode table, so without this their text comes out scrambled
// ("radiati'3" for "radiation"). Safe to run repeatedly.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = ["build/pdf.worker.mjs", "build/pdf.worker.min.mjs", "legacy/build/pdf.worker.mjs", "legacy/build/pdf.worker.min.mjs"];
// In getUnicodeForGlyph: `if (hexStr === hexStr.toUpperCase())` → accept any hex digits.
const re = /(substring\(1\)[^]{0,90}?if\s*\()([\w$]+)\s*===\s*\2\.toUpperCase\(\)/;
let patched = 0;
for (const f of files) {
  const p = path.join(root, "node_modules/pdfjs-dist", f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  if (src.includes("/*readingos-hex*/")) continue;
  if (!re.test(src)) {
    console.warn(`pdf.js patch: pattern not found in ${f} (pdf.js may have changed)`);
    continue;
  }
  fs.writeFileSync(p, src.replace(re, (_m, pre, v) => `${pre}/*readingos-hex*//^[0-9A-Fa-f]+$/.test(${v})`));
  patched++;
}
if (patched) console.log(`pdf.js patched (lowercase glyph names) in ${patched} file(s)`);
