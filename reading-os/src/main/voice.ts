// Natural voices for Listen: Kokoro, a small neural text-to-speech model that
// runs on this computer. The model (~90 MB) is downloaded once into the app's
// data folder; after that, reading aloud works offline and nothing leaves the
// machine. Sentences are spoken one at a time, in order.

import { existsSync } from "node:fs";
import path from "node:path";
import type { VoiceStatus } from "../shared/ipc";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE = "q8";

type Tts = {
  generate(text: string, o: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
};

let modelsDir = "";
let tts: Tts | null = null;
let loading: Promise<Tts> | null = null;
let progress = 0;
let error: string | null = null;
let chain: Promise<unknown> = Promise.resolve();
let epoch = 0;

/** Drops sentences still waiting to be spoken (after a skip, pause or stop). */
export function cancel(): void {
  epoch++;
}

export function configure(dir: string): void {
  modelsDir = dir;
}

const modelFile = () => path.join(modelsDir, MODEL, "onnx", "model_quantized.onnx");

export function status(): VoiceStatus {
  if (tts) return { state: "ready" };
  if (loading) return { state: "loading", progress };
  if (error) return { state: "error", message: error };
  return { state: existsSync(modelFile()) ? "downloaded" : "missing" };
}

/** Downloads (first time) and loads the model. `onProgress` gets 0–1. */
export function prepare(onProgress: (s: VoiceStatus) => void): Promise<VoiceStatus> {
  if (tts) return Promise.resolve(status());
  if (!loading) {
    error = null;
    progress = 0;
    const sizes = new Map<string, { loaded: number; total: number }>();
    loading = (async () => {
      const { env } = await import("@huggingface/transformers");
      env.cacheDir = modelsDir;
      // Once the model is here, never go to the network for it.
      env.allowRemoteModels = !existsSync(modelFile());
      const { KokoroTTS } = await import("kokoro-js");
      const model = await KokoroTTS.from_pretrained(MODEL, {
        dtype: DTYPE,
        device: "cpu",
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status !== "progress" || !p.file || !p.total) return;
          sizes.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
          // The model file is nearly all of it: follow the biggest file so the figure only grows.
          const big = [...sizes.values()].reduce((a, b) => (b.total > a.total ? b : a));
          progress = Math.max(progress, big.loaded / big.total);
          onProgress({ state: "loading", progress });
        },
      });
      return model as unknown as Tts;
    })();
    loading.then(
      (m) => {
        tts = m;
        loading = null;
        onProgress(status());
      },
      (e: unknown) => {
        loading = null;
        error = /fetch|network|ENOTFOUND|ECONN/i.test(String(e)) ? "Couldn't download the voices. Check the internet connection and try again." : String((e as Error)?.message ?? e);
        onProgress(status());
      },
    );
  }
  return loading.then(
    () => status(),
    () => status(),
  );
}

/** Speaks one sentence: mono PCM samples and their rate. Requests run one after another. */
export function speak(text: string, voice: string, speed: number): Promise<{ rate: number; pcm: Float32Array }> {
  const mine = epoch;
  const run = async () => {
    if (mine !== epoch) throw new Error("cancelled");
    const model: Tts | null = tts ?? (loading ? await loading : null);
    if (!model) throw new Error("The natural voices aren't ready.");
    const out = await model.generate(text, { voice, speed });
    return { rate: out.sampling_rate, pcm: out.audio };
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}
