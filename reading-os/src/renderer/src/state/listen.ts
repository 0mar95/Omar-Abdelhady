// Listen: the book read aloud a sentence at a time, each sentence highlighted
// as it's read and kept in view. Figures, tables, captions, code and reference
// lists are skipped.
//
// Two engines. Natural voices (desktop): Kokoro, a neural voice model running
// on this computer; sentences are made a little ahead of where you are and
// played through Web Audio. System voices: the computer's own speech, ranked
// so the best installed voices come first and novelty voices never appear.

import { create } from "zustand";
import type { Block, BookDoc } from "../../../shared/model";
import { findText } from "./highlights";
import { useReader } from "./reader";
import { platform } from "../platform";
import type { VoiceStatus } from "../../../shared/ipc";
import { clauses, spoken, voiceScore } from "../../../shared/speech";

/** The natural voices offered, best first (Kokoro v1.0 English voices). */
export const NATURAL_VOICES = [
  { id: "af_heart", name: "Heart", note: "warm · US" },
  { id: "af_bella", name: "Bella", note: "bright · US" },
  { id: "af_nicole", name: "Nicole", note: "soft · US" },
  { id: "bf_emma", name: "Emma", note: "clear · UK" },
  { id: "am_michael", name: "Michael", note: "calm · US" },
  { id: "am_fenrir", name: "Fenrir", note: "deep · US" },
  { id: "bm_george", name: "George", note: "measured · UK" },
  { id: "bm_fable", name: "Fable", note: "storyteller · UK" },
] as const;
const DEFAULT_NATURAL = "natural:af_heart";

interface Line {
  blockId: string;
  /** As printed (to find and highlight it). */
  text: string;
  /** As spoken: without citation numbers and superscripts. */
  say: string;
  /** Headings get a pause after them. */
  heading: boolean;
}

interface ListenStore {
  active: boolean;
  playing: boolean;
  rate: number;
  /** "natural:<id>" or "system:<voiceURI>"; null picks the best available. */
  voice: string | null;
  /** System voices worth offering, best first. */
  voices: SpeechSynthesisVoice[];
  /** Natural voices' state; null where they aren't available (browser build). */
  natural: VoiceStatus | null;
  /** Loading the voice for the sentence about to be read. */
  waiting: boolean;
  at: number;
  queue: Line[];
  error: string | null;
  start(fromBlockId?: string | null): void;
  toggle(): void;
  skip(by: number): void;
  stop(): void;
  setRate(r: number): void;
  setVoice(id: string): void;
  /** Downloads the natural voices (first time) and switches to them. */
  getNatural(): Promise<void>;
}

const supported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Sentences of a block worth hearing. */
function linesOf(b: Block, text: string): Line[] {
  if (b.kind === "heading") return [{ blockId: b.id, text, say: spoken(text), heading: true }];
  if (b.kind === "paragraph" && b.small) return [];
  if (b.kind !== "paragraph" && b.kind !== "list" && b.kind !== "callout") return [];
  // Citation numbers and superscripts are printed glued to words ("pain.12"): not spoken.
  const spans = b.kind === "paragraph" ? b.spans : b.items.flat();
  const quiet = [...new Set(spans.filter((s) => (s.cite || s.sup) && s.text.trim()).map((s) => s.text.trim()))];
  const say = (t: string) =>
    quiet.reduce((acc, q) => acc.replace(new RegExp(`(?<=[\\p{L}.,;:)\\]])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s.,;:)]|$)`, "gu"), ""), t);
  const out: Line[] = [];
  for (const part of text.split("\n")) {
    const clean = part
      .replace(/\s+/g, " ")
      .replace(/\[\d+(?:[,–-]\d+)*\]/g, "") // citation numbers aren't read
      .trim();
    if (!clean) continue;
    for (const s of clean.split(/(?<=[.!?…]["”’)]?\d{0,3})\s+(?=[A-Z“"(0-9])/))
      for (const piece of clauses(s.trim())) if (piece) out.push({ blockId: b.id, text: piece, say: spoken(say(piece)), heading: false });
  }
  return out;
}

function queueFrom(book: BookDoc, texts: string[], start: number): Line[] {
  const out: Line[] = [];
  for (let i = start; i < book.blocks.length && out.length < 4000; i++) out.push(...linesOf(book.blocks[i], texts[i]));
  return out;
}

let token = 0;

/** The engine a voice id belongs to. */
const isNatural = (id: string | null) => !!id?.startsWith("natural:");

/** The voice to use now: the saved choice when it can play, else the best available. */
function chosen(): string {
  const { voice, natural, voices } = useListen.getState();
  const naturalOk = natural && natural.state !== "missing" && natural.state !== "error";
  if (voice && isNatural(voice) && naturalOk) return voice;
  if (voice?.startsWith("system:") && voices.some((v) => `system:${v.voiceURI}` === voice)) return voice;
  if (naturalOk) return DEFAULT_NATURAL;
  return voices[0] ? `system:${voices[0].voiceURI}` : "system:";
}

export const useListen = create<ListenStore>((set, get) => ({
  active: false,
  playing: false,
  rate: 1,
  voice: null,
  voices: [],
  natural: null,
  waiting: false,
  at: 0,
  queue: [],
  error: null,
  start(fromBlockId) {
    const { book, ix, currentBlock } = useReader.getState();
    if (!book || !ix) return;
    if (!supported() && !platform.voices) {
      set({ active: true, playing: false, error: "Reading aloud isn't available here." });
      return;
    }
    loadVoices();
    const from = ix.byId.get(fromBlockId ?? currentBlock ?? "") ?? 0;
    const queue = queueFrom(book, ix.texts, from);
    halt();
    audio.clear();
    set({ active: true, playing: true, queue, at: 0, error: queue.length ? null : "Nothing to read from here." });
    if (queue.length) speak();
  },
  toggle() {
    if (!get().active) return get().start();
    if (get().playing) {
      halt();
      set({ playing: false, waiting: false });
    } else {
      set({ playing: true, error: null });
      speak();
    }
  },
  skip(by) {
    const at = Math.max(0, Math.min(get().queue.length - 1, get().at + by));
    halt();
    set({ at });
    if (get().playing) speak();
    else mark();
  },
  stop() {
    halt();
    audio.clear();
    clearMark();
    set({ active: false, playing: false, waiting: false, queue: [], at: 0 });
  },
  setRate(rate) {
    set({ rate });
    save();
    audio.clear();
    if (get().playing) get().skip(0);
  },
  setVoice(voice) {
    set({ voice, error: null });
    save();
    audio.clear();
    if (get().playing) get().skip(0);
  },
  async getNatural() {
    const v = platform.voices;
    if (!v) return;
    set({ natural: { state: "loading", progress: 0 } });
    const s = await v.prepare();
    set({ natural: s });
    if (s.state !== "ready") return;
    get().setVoice(get().voice && isNatural(get().voice) ? get().voice! : DEFAULT_NATURAL);
    // Start reading with the new voice right away.
    if (get().active && !get().playing) {
      set({ playing: true, error: null });
      speak();
    }
  },
}));

function save() {
  const { rate, voice } = useListen.getState();
  void platform.stateSet("listen", { rate, voice });
}

// Saved speed and voice (voices saved before the natural ones existed are system voices).
void platform.stateGet<{ rate?: number; voice?: string }>("listen").then((s) => {
  if (!s) return;
  const voice = s.voice ? (/^(natural|system):/.test(s.voice) ? s.voice : `system:${s.voice}`) : null;
  useListen.setState({ rate: s.rate ?? 1, voice });
});

// The natural voices' state, kept current (download progress, ready).
if (platform.voices) {
  void platform.voices.status().then((natural) => useListen.setState({ natural }));
  platform.voices.onStatus((natural) => useListen.setState({ natural }));
}

function loadVoices() {
  if (!supported()) return;
  const pick = () => {
    const all = speechSynthesis.getVoices();
    const english = all.filter((v) => /^en\b|^en-/i.test(v.lang));
    const ranked = (english.length ? english : all)
      .map((v) => ({ v, s: voiceScore(v) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
      .map((x) => x.v);
    useListen.setState({ voices: ranked });
  };
  pick();
  speechSynthesis.onvoiceschanged = pick;
}

/** Stops whatever is sounding and drops sentences still being made. */
function halt() {
  token++;
  if (supported()) speechSynthesis.cancel();
  audio.stopSource();
  platform.voices?.cancel();
}

/** Called when a sentence has finished: on to the next one. */
function next(my: number, line: Line) {
  if (my !== token) return;
  const n = useListen.getState().at + 1;
  if (n >= useListen.getState().queue.length) {
    useListen.setState({ playing: false });
    clearMark();
    return;
  }
  useListen.setState({ at: n });
  // A short breath after a heading.
  if (line.heading) setTimeout(() => my === token && speak(), 350);
  else speak();
}

function speak() {
  const my = ++token;
  const { queue, at } = useListen.getState();
  const line = queue[at];
  if (!line) {
    useListen.setState({ playing: false });
    clearMark();
    return;
  }
  mark();
  const voice = chosen();
  if (isNatural(voice)) void speakNatural(my, line, voice.slice("natural:".length));
  else speakSystem(my, line, voice.slice("system:".length));
}

function speakSystem(my: number, line: Line, uri: string) {
  if (!supported()) {
    useListen.setState({ playing: false, error: "No voice is available." });
    return;
  }
  const { rate, voices } = useListen.getState();
  const u = new SpeechSynthesisUtterance(line.say);
  u.rate = rate;
  const v = voices.find((x) => x.voiceURI === uri) ?? voices[0];
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.onend = () => next(my, line);
  u.onerror = (e) => {
    if (my !== token || e.error === "interrupted" || e.error === "canceled") return;
    const none = !speechSynthesis.getVoices().length;
    useListen.setState({ playing: false, error: none ? "No voice is installed on this computer." : "The voice stopped unexpectedly." });
  };
  speechSynthesis.speak(u);
}

async function speakNatural(my: number, line: Line, id: string) {
  const v = platform.voices!;
  try {
    if (useListen.getState().natural?.state !== "ready") {
      useListen.setState({ waiting: true });
      const s = await v.prepare();
      useListen.setState({ natural: s });
      if (s.state !== "ready") throw new Error(s.state === "error" ? s.message : "The natural voices aren't ready.");
    }
    if (my !== token) return;
    const { at, queue } = useListen.getState();
    const buffer = audio.get(at, line.say, id);
    // Make the next sentences while this one plays.
    for (let k = 1; k <= 2 && at + k < queue.length; k++) audio.get(at + k, queue[at + k].say, id);
    if (!audio.ready(at)) useListen.setState({ waiting: true });
    const buf = await buffer;
    if (my !== token) return;
    useListen.setState({ waiting: false });
    audio.play(buf, () => next(my, line));
  } catch (e) {
    if (my !== token || /cancelled/.test(String(e))) return;
    // Fall back to the system voice for this sentence rather than going silent.
    useListen.setState({ waiting: false, error: "Natural voice unavailable — using the system voice." });
    const { voices } = useListen.getState();
    speakSystem(my, line, voices[0]?.voiceURI ?? "");
  }
}

/** Natural-voice audio: made ahead per sentence, played through Web Audio. */
const audio = (() => {
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  const made = new Map<number, { key: string; p: Promise<AudioBuffer>; done: boolean }>();
  const context = () => (ctx ??= new AudioContext());
  return {
    get(at: number, text: string, voice: string): Promise<AudioBuffer> {
      const key = `${voice}|${useListen.getState().rate}|${text}`;
      const have = made.get(at);
      if (have && have.key === key) return have.p;
      const entry = { key, done: false, p: null as unknown as Promise<AudioBuffer> };
      entry.p = platform
        .voices!.speak(text, voice, useListen.getState().rate)
        .then(({ rate, pcm }) => {
          const c = context();
          const b = c.createBuffer(1, pcm.length, rate);
          b.copyToChannel(new Float32Array(pcm), 0);
          entry.done = true;
          return b;
        })
        .catch((e) => {
          if (made.get(at) === entry) made.delete(at);
          throw e;
        });
      made.set(at, entry);
      // Keep only what's near: earlier sentences are dropped.
      for (const k of made.keys()) if (k < at - 1) made.delete(k);
      return entry.p;
    },
    ready: (at: number) => !!made.get(at)?.done,
    play(buf: AudioBuffer, onEnd: () => void) {
      const c = context();
      void c.resume();
      const s = c.createBufferSource();
      s.buffer = buf;
      s.connect(c.destination);
      s.onended = () => {
        if (source === s) {
          source = null;
          onEnd();
        }
      };
      source = s;
      s.start();
    },
    stopSource() {
      const s = source;
      source = null;
      try {
        s?.stop();
      } catch {
        /* already stopped */
      }
      // Sentences cancelled in the main process won't arrive: forget them.
      for (const [k, e] of made) if (!e.done) made.delete(k);
    },
    clear() {
      made.clear();
    },
  };
})();

/** Highlights the sentence being read and keeps it in view. */
function mark() {
  const { queue, at } = useListen.getState();
  const line = queue[at];
  if (!line) return;
  const el = document.querySelector(`[data-block="${CSS.escape(line.blockId)}"]`);
  if (!el) return;
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const Ctor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  const range = findText(el, line.text.replace(/\s+/g, " "));
  if (registry && Ctor) {
    if (range) registry.set("listen", new Ctor(range));
    else registry.delete("listen");
  }
  const r = (range ?? el).getBoundingClientRect();
  if (r.top < 90 || r.bottom > window.innerHeight - 140) (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  useReader.getState().setPosition(line.blockId);
}

function clearMark() {
  (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete("listen");
}
