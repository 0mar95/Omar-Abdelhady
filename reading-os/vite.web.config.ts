// Browser-only build of the renderer. Used for fast UI iteration and automated
// browser tests; the desktop app uses electron.vite.config.ts.
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true },
});
