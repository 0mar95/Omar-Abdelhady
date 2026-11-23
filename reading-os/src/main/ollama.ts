// Talks to a local Ollama server. Runs in the main process so the renderer
// never needs network access, and streams tokens back over IPC.

import type { AiStatus, ChatChunk, ChatRequest } from "../shared/ipc";

const running = new Map<string, AbortController>();

/** True while the reader is waiting on an answer: background work yields. */
export function userBusy(): boolean {
  return running.size > 0;
}

export function normalizeBase(baseUrl: string): string {
  const url = new URL(baseUrl || "http://127.0.0.1:11434");
  // Only local servers: this app never sends book text off the machine.
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) throw new Error("Only a local Ollama server is allowed");
  return url.origin;
}

export async function status(baseUrl: string): Promise<AiStatus> {
  try {
    const res = await fetch(`${normalizeBase(baseUrl)}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { ok: false, models: [], error: `Ollama answered ${res.status}` };
    const body = (await res.json()) as { models?: { name: string }[] };
    return { ok: true, models: (body.models ?? []).map((m) => m.name).sort() };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function chat(id: string, req: ChatRequest, send: (c: ChatChunk) => void): Promise<void> {
  const ctrl = new AbortController();
  running.set(id, ctrl);
  try {
    const res = await fetch(`${normalizeBase(req.baseUrl)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        // Inline helpers should answer right away, without a reasoning phase.
        think: false,
        keep_alive: "30m",
        options: { temperature: req.temperature ?? 0.3, num_ctx: req.numCtx ?? 8192 },
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      send({ id, error: friendlyError(res.status, text, req.model), done: true });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
        if (msg.error) send({ id, error: msg.error, done: true });
        else if (msg.message?.content) send({ id, text: msg.message.content });
        if (msg.done) send({ id, done: true });
      }
    }
    send({ id, done: true });
  } catch (e) {
    if (ctrl.signal.aborted) send({ id, done: true });
    else send({ id, error: e instanceof Error ? e.message : String(e), done: true });
  } finally {
    running.delete(id);
  }
}

export function abort(id: string): void {
  running.get(id)?.abort();
}

function friendlyError(status: number, body: string, model: string): string {
  if (status === 404 || /not found/i.test(body)) return `The model "${model}" isn't installed. Run: ollama pull ${model}`;
  return `Ollama error ${status}${body ? `: ${body.slice(0, 200)}` : ""}`;
}

export class ModelMissingError extends Error {}
export class OfflineError extends Error {}

async function post(baseUrl: string, path: string, body: unknown, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(`${normalizeBase(baseUrl)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new OfflineError(e instanceof Error ? e.message : String(e));
  }
}

/** Embeds a batch of texts; returns unit-length vectors. */
export async function embed(baseUrl: string, model: string, input: string[]): Promise<Float32Array[]> {
  const res = await post(baseUrl, "/api/embed", { model, input, truncate: true, keep_alive: "30m" }, 120_000);
  if (res.status === 404) throw new ModelMissingError(model);
  if (!res.ok) throw new Error(`Ollama embed error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { embeddings?: number[][] };
  return (body.embeddings ?? []).map((v) => {
    const f = Float32Array.from(v);
    let n = 0;
    for (const x of f) n += x * x;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < f.length; i++) f[i] /= n;
    return f;
  });
}

/** One non-streaming chat turn that must answer in JSON matching a schema. */
export async function chatJson<T>(baseUrl: string, model: string, messages: ChatRequest["messages"], schema: object): Promise<T> {
  const res = await post(
    baseUrl,
    "/api/chat",
    { model, messages, stream: false, think: false, format: schema, keep_alive: "30m", options: { temperature: 0.2, num_ctx: 8192 } },
    180_000,
  );
  if (res.status === 404) throw new ModelMissingError(model);
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { message?: { content?: string } };
  const content = body.message?.content ?? "";
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return JSON.parse(json) as T;
}
