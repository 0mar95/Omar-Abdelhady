import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ChatChunk, ChatRequest, GlossaryEvent, IndexStatus, NoteEvent, ReadingOSApi } from "../shared/ipc";

const api: ReadingOSApi = {
  platform: process.platform,
  openPdfDialog: () => ipcRenderer.invoke("file:open-dialog"),
  readFile: (path) => ipcRenderer.invoke("file:read", path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  cacheGet: (key) => ipcRenderer.invoke("cache:get", key),
  cacheSet: (key, value) => ipcRenderer.invoke("cache:set", key, value),
  stateGet: (key) => ipcRenderer.invoke("state:get", key),
  stateSet: (key, value) => ipcRenderer.invoke("state:set", key, value),
  aiStatus: (baseUrl) => ipcRenderer.invoke("ai:status", baseUrl),
  aiChat: (id, req: ChatRequest) => ipcRenderer.invoke("ai:chat", id, req),
  aiAbort: (id) => ipcRenderer.invoke("ai:abort", id),
  onAiChunk: (cb) => {
    const listener = (_: unknown, chunk: ChatChunk) => cb(chunk);
    ipcRenderer.on("ai:chunk", listener);
    return () => ipcRenderer.removeListener("ai:chunk", listener);
  },
  aiConfigure: (cfg) => ipcRenderer.invoke("ai:configure", cfg),
  indexBook: (bookId, title, blockIndex) => ipcRenderer.invoke("index:book", bookId, title, blockIndex),
  onIndexStatus: (cb) => {
    const listener = (_: unknown, s: IndexStatus) => cb(s);
    ipcRenderer.on("index:status", listener);
    return () => ipcRenderer.removeListener("index:status", listener);
  },
  search: (p) => ipcRenderer.invoke("search:query", p),
  notesList: (bookId) => ipcRenderer.invoke("notes:list", bookId),
  onNoteEvent: (cb) => {
    const listener = (_: unknown, e: NoteEvent) => cb(e);
    ipcRenderer.on("notes:event", listener);
    return () => ipcRenderer.removeListener("notes:event", listener);
  },
  readingPosition: (bookId, blockIndex) => ipcRenderer.invoke("reader:position", bookId, blockIndex),
  readerActivity: () => ipcRenderer.send("reader:activity"),
  glossaryDefinitions: (bookId) => ipcRenderer.invoke("glossary:definitions", bookId),
  glossaryDefine: (bookId, req) => ipcRenderer.invoke("glossary:define", bookId, req),
  onGlossaryEvent: (cb) => {
    const listener = (_: unknown, e: GlossaryEvent) => cb(e);
    ipcRenderer.on("glossary:event", listener);
    return () => ipcRenderer.removeListener("glossary:event", listener);
  },
  glossaryMentions: (phrases, exclude) => ipcRenderer.invoke("glossary:mentions", phrases, exclude),
  onMenu: (cb) => {
    const listener = (_: unknown, action: string) => cb(action);
    ipcRenderer.on("menu", listener);
    return () => ipcRenderer.removeListener("menu", listener);
  },
};

contextBridge.exposeInMainWorld("readingOS", api);
