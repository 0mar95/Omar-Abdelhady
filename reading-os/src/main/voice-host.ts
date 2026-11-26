// The main process's side of the voice engine: starts its process on first
// use and passes requests to it. If the process dies it is started again.

import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import type { VoiceStatus } from "../shared/ipc";

let child: UtilityProcess | null = null;
let modelsDir = "";
let nextId = 1;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
let onStatus: (s: VoiceStatus) => void = () => {};

export function configure(dir: string, here: string, status: (s: VoiceStatus) => void): void {
  modelsDir = dir;
  workerPath = path.join(here, "voice-worker.js");
  onStatus = status;
}
let workerPath = "";

function worker(): UtilityProcess {
  if (child) return child;
  const c = utilityProcess.fork(workerPath, [], { serviceName: "Kenning voice", stdio: "inherit" });
  c.on("message", (m: { id?: number; type?: string; status?: VoiceStatus; result?: unknown; error?: string }) => {
    if (m.type === "status" && m.status) return onStatus(m.status);
    const w = m.id !== undefined ? waiting.get(m.id) : undefined;
    if (!w) return;
    waiting.delete(m.id!);
    if (m.error) w.reject(new Error(m.error));
    else w.resolve(m.result);
  });
  c.on("exit", () => {
    child = null;
    for (const w of waiting.values()) w.reject(new Error("The voice stopped unexpectedly."));
    waiting.clear();
  });
  c.postMessage({ type: "configure", dir: modelsDir });
  child = c;
  return c;
}

function ask<T>(msg: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker().postMessage({ ...msg, id });
  });
}

export const status = () => ask<VoiceStatus>({ type: "status" });
export const prepare = () => ask<VoiceStatus>({ type: "prepare" });
export const speak = (text: string, voice: string, speed: number) => ask<{ rate: number; pcm: Float32Array }>({ type: "speak", text, voice, speed });
export function cancel(): void {
  child?.postMessage({ type: "cancel" });
}
export function stop(): void {
  child?.kill();
  child = null;
}
