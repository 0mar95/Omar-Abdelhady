// Runs before `npm run dev` / `npm run preview`:
//  1. Electron 45+ no longer downloads its binary during `npm install`, and
//     electron-vite refuses to start without it ("Electron uninstall"), so
//     fetch it here when it is missing.
//  2. Copy pdf.js runtime assets next to the renderer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const electronDir = path.join(root, "node_modules/electron");
const pathFile = path.join(electronDir, "path.txt");
const installed = fs.existsSync(pathFile) && fs.existsSync(path.join(electronDir, "dist", fs.readFileSync(pathFile, "utf8")));

if (!installed) {
  console.log("Downloading Electron (about 100 MB, one time only; this can take a few minutes on a slow connection)…");
  const r = spawnSync(process.execPath, [path.join(electronDir, "install.js")], { stdio: "inherit", cwd: root });
  if (r.status !== 0) {
    console.error("\nElectron didn't download. Check your internet connection and run `npm run dev` again.");
    process.exit(1);
  }
  console.log("Electron is ready.");
}

spawnSync(process.execPath, [path.join(root, "scripts/patch-pdfjs.mjs")], { stdio: "inherit", cwd: root });
const r = spawnSync(process.execPath, [path.join(root, "scripts/copy-pdfjs-assets.mjs")], { stdio: "inherit", cwd: root });
process.exit(r.status ?? 0);
