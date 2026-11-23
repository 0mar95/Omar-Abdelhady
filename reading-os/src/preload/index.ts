import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ChatChunk, ChatRequest, ReadingOSApi } from "../shared/ipc";

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
  onMenu: (cb) => {
    const listener = (_: unknown, action: string) => cb(action);
    ipcRenderer.on("menu", listener);
    return () => ipcRenderer.removeListener("menu", listener);
  },
};

contextBridge.exposeInMainWorld("readingOS", api);
