import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, type MenuItemConstructorOptions } from "electron";
import { existsSync, promises as fs, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AiConfig, ChatRequest, DefineRequest, SearchParams } from "../shared/ipc";
import { EXTRACTOR_VERSION, type BookDoc } from "../shared/model";
import { DEFINITION_SCHEMA, LibraryIndex, NOTE_SCHEMA, definitionMessages, noteMessages, type NoteDraft } from "./library";
import * as ollama from "./ollama";

// One name everywhere, so settings and the book cache live in the same
// folder however the app is launched (~/Library/Application Support/Kenning).
app.setName("Kenning");

// The app used to be called "Reading OS": move its library, settings and
// cached books to the new folder the first time Kenning starts.
try {
  const appData = app.getPath("appData");
  const before = path.join(appData, "Reading OS");
  const now = path.join(appData, "Kenning");
  if (existsSync(before) && !existsSync(now)) renameSync(before, now);
} catch (e) {
  console.error("Couldn't move the old Reading OS data folder", e);
}

/** The app icon, for the Dock and window while running from source (installers embed it). */
const devIcon = () => path.join(app.getAppPath(), "build/icon.png");

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

/** Book files the renderer may ask to read back or reveal. */
const BOOK_FILE = /\.(pdf|epub|docx|html?|xhtml|md|markdown|txt)$/i;

const PAPER: Record<string, string> = { light: "#fbfaf7", sepia: "#f6efe2", dark: "#1c1b19", black: "#000000" };

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    show: false,
    // The saved theme's paper color, so the window never flashes another theme.
    backgroundColor: PAPER[(state.settings as { theme?: string } | undefined)?.theme ?? "sepia"] ?? PAPER.sepia,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(process.platform !== "darwin" && !app.isPackaged && existsSync(devIcon()) ? { icon: devIcon() } : {}),
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
        { label: "Open Book…", accelerator: "CmdOrCtrl+O", click: () => send("open") },
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

let library: LibraryIndex | null = null;
/** When the reader last scrolled (see userBusy below). */
let lastScroll = 0;

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

function openLibrary(): LibraryIndex {
  return new LibraryIndex(path.join(dataDir(), "library.sqlite"), {
    async loadBook(bookId) {
      try {
        const file = path.join(cacheDir(), `${safeKey(`book-${bookId}-v${EXTRACTOR_VERSION}`)}.json`);
        return JSON.parse(await fs.readFile(file, "utf8")) as BookDoc;
      } catch {
        return null;
      }
    },
    embed: (cfg, texts) => ollama.embed(cfg.baseUrl, cfg.embedModel, texts),
    writeNote: (cfg, book, section) => ollama.chatJson<NoteDraft>(cfg.baseUrl, cfg.chatModel, noteMessages(book, section), NOTE_SCHEMA),
    writeDefinition: (cfg, title, req) => ollama.chatJson<{ definition: string }>(cfg.baseUrl, cfg.chatModel, definitionMessages(title, req), DEFINITION_SCHEMA),
    emitGlossary: (e) => broadcast("glossary:event", e),
    // Background work also waits while the reader scrolls: on Apple silicon the
    // models share the GPU with the window, and scrolling would stutter.
    userBusy: () => ollama.userBusy() || Date.now() - lastScroll < 1500,
    emitStatus: (s) => broadcast("index:status", s),
    emitNote: (e) => broadcast("notes:event", e),
    isModelMissing: (e) => e instanceof ollama.ModelMissingError,
    isOffline: (e) => e instanceof ollama.OfflineError,
  });
}

function registerIpc(): void {
  ipcMain.handle("file:open-dialog", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: "Open a book",
      properties: ["openFile"],
      filters: [
        { name: "Books and documents", extensions: ["pdf", "epub", "docx", "html", "htm", "xhtml", "md", "markdown", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    return { path: file, name: path.basename(file), bytes: new Uint8Array(await fs.readFile(file)) };
  });
  ipcMain.handle("file:read", async (_e, file: string) => {
    if (typeof file !== "string" || !BOOK_FILE.test(file)) return null;
    try {
      return new Uint8Array(await fs.readFile(file));
    } catch {
      return null;
    }
  });
  ipcMain.handle("file:show", (_e, file: string) => {
    if (typeof file === "string" && BOOK_FILE.test(file)) shell.showItemInFolder(file);
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
  ipcMain.handle("ai:configure", (_e, cfg: AiConfig) => library?.configure(cfg));
  ipcMain.handle("index:book", (_e, bookId: string, title: string, blockIndex: number) => library!.indexBook(bookId, title, blockIndex));
  ipcMain.handle("search:query", (_e, p: SearchParams) => library!.search(p));
  ipcMain.handle("notes:list", (_e, bookId: string) => library!.notes(bookId));
  ipcMain.handle("glossary:definitions", (_e, bookId: string) => library!.definitions(bookId));
  ipcMain.handle("glossary:define", (_e, bookId: string, req: DefineRequest) => library!.requestDefinition(bookId, req));
  ipcMain.handle("glossary:mentions", (_e, phrases: string[], exclude: string) => library!.mentions(phrases, exclude));
  ipcMain.handle("reader:position", (_e, bookId: string, blockIndex: number) => library?.setPosition(bookId, blockIndex));
  ipcMain.on("reader:activity", () => {
    lastScroll = Date.now();
  });
}

void app.whenReady().then(async () => {
  if (process.platform === "darwin" && !app.isPackaged && existsSync(devIcon())) app.dock?.setIcon(devIcon());
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
  library = openLibrary();
  registerIpc();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => library?.close());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
