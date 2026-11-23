import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, type MenuItemConstructorOptions } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ChatRequest } from "../shared/ipc";
import * as ollama from "./ollama";

// The packaged UI is served from app://reading-os/ (a standard, secure origin)
// so ES-module workers such as pdf.js work exactly as they do in development.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(here, "../renderer");
const dataDir = () => app.getPath("userData");
const cacheDir = () => path.join(dataDir(), "books");
const statePath = () => path.join(dataDir(), "state.json");

let state: Record<string, unknown> = {};
let stateWrite: Promise<void> = Promise.resolve();

async function loadState(): Promise<void> {
  try {
    state = JSON.parse(await fs.readFile(statePath(), "utf8"));
  } catch {
    state = {};
  }
}

function saveState(): Promise<void> {
  // Serialize writes so concurrent updates never interleave.
  stateWrite = stateWrite.then(async () => {
    const tmp = `${statePath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state));
    await fs.rename(tmp, statePath());
  });
  return stateWrite;
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#f7f3ea",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Links in book text open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://") && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "\0")) e.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadURL("app://reading-os/index.html");
  return win;
}

function buildMenu(): void {
  const send = (action: string) => BrowserWindow.getFocusedWindow()?.webContents.send("menu", action);
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open PDF…", accelerator: "CmdOrCtrl+O", click: () => send("open") },
        { label: "Library", accelerator: "CmdOrCtrl+L", click: () => send("library") },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Command Palette", accelerator: "CmdOrCtrl+K", click: () => send("palette") },
        { label: "Toggle Page View", accelerator: "CmdOrCtrl+Shift+V", click: () => send("toggle-view") },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle("file:open-dialog", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: "Open a PDF",
      properties: ["openFile"],
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    return { path: file, name: path.basename(file), bytes: new Uint8Array(await fs.readFile(file)) };
  });
  ipcMain.handle("file:read", async (_e, file: string) => {
    if (typeof file !== "string" || !file.toLowerCase().endsWith(".pdf")) return null;
    try {
      return new Uint8Array(await fs.readFile(file));
    } catch {
      return null;
    }
  });
  ipcMain.handle("cache:get", async (_e, key: string) => {
    try {
      return await fs.readFile(path.join(cacheDir(), `${safeKey(key)}.json`), "utf8");
    } catch {
      return null;
    }
  });
  ipcMain.handle("cache:set", async (_e, key: string, value: string) => {
    await fs.mkdir(cacheDir(), { recursive: true });
    await fs.writeFile(path.join(cacheDir(), `${safeKey(key)}.json`), value);
  });
  ipcMain.handle("state:get", (_e, key: string) => state[key] ?? null);
  ipcMain.handle("state:set", async (_e, key: string, value: unknown) => {
    state[key] = value;
    await saveState();
  });
  ipcMain.handle("ai:status", (_e, baseUrl: string) => ollama.status(baseUrl));
  ipcMain.handle("ai:chat", (e, id: string, req: ChatRequest) => {
    const sender = e.sender;
    void ollama.chat(id, req, (chunk) => {
      if (!sender.isDestroyed()) sender.send("ai:chunk", chunk);
    });
  });
  ipcMain.handle("ai:abort", (_e, id: string) => ollama.abort(id));
}

void app.whenReady().then(async () => {
  await fs.mkdir(dataDir(), { recursive: true });
  await loadState();
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const target = path.normalize(path.join(rendererDir, decodeURIComponent(pathname)));
    if (!target.startsWith(rendererDir)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
  if (!process.env.ELECTRON_RENDERER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'",
          ],
        },
      });
    });
  }
  registerIpc();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
