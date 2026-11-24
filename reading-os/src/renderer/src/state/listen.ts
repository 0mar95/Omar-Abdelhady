// Listen: the book read aloud with the computer's own voices, a sentence at
// a time, each sentence highlighted as it's read and kept in view. Figures,
// tables, captions, code and reference lists are skipped.

import { create } from "zustand";
import type { Block, BookDoc } from "../../../shared/model";
import { findText } from "./highlights";
import { useReader } from "./reader";
import { platform } from "../platform";

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
  voice: string | null;
  voices: SpeechSynthesisVoice[];
  at: number;
  queue: Line[];
  error: string | null;
  start(fromBlockId?: string | null): void;
  toggle(): void;
  skip(by: number): void;
  stop(): void;
  setRate(r: number): void;
  setVoice(uri: string): void;
}

const supported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Sentences of a block worth hearing. */
function linesOf(b: Block, text: string): Line[] {
  if (b.kind === "heading") return [{ blockId: b.id, text, say: text, heading: true }];
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
    for (const s of clean.split(/(?<=[.!?…]["”’)]?\d{0,3})\s+(?=[A-Z“"(0-9])/)) if (s.trim()) out.push({ blockId: b.id, text: s.trim(), say: say(s.trim()), heading: false });
  }
  return out;
}

function queueFrom(book: BookDoc, texts: string[], start: number): Line[] {
  const out: Line[] = [];
  for (let i = start; i < book.blocks.length && out.length < 4000; i++) out.push(...linesOf(book.blocks[i], texts[i]));
  return out;
}

let token = 0;

export const useListen = create<ListenStore>((set, get) => ({
  active: false,
  playing: false,
  rate: 1,
  voice: null,
  voices: [],
  at: 0,
  queue: [],
  error: null,
  start(fromBlockId) {
    const { book, ix, currentBlock } = useReader.getState();
    if (!book || !ix) return;
    if (!supported()) {
      set({ active: true, playing: false, error: "Reading aloud isn't available here." });
      return;
    }
    loadVoices();
    const from = ix.byId.get(fromBlockId ?? currentBlock ?? "") ?? 0;
    const queue = queueFrom(book, ix.texts, from);
    speechSynthesis.cancel();
    set({ active: true, playing: true, queue, at: 0, error: queue.length ? null : "Nothing to read from here." });
    if (queue.length) speak();
  },
  toggle() {
    if (!get().active) return get().start();
    if (get().playing) {
      token++;
      speechSynthesis.cancel();
      set({ playing: false });
    } else {
      set({ playing: true });
      speak();
    }
  },
  skip(by) {
    const at = Math.max(0, Math.min(get().queue.length - 1, get().at + by));
    token++;
    speechSynthesis.cancel();
    set({ at });
    if (get().playing) speak();
    else mark();
  },
  stop() {
    token++;
    if (supported()) speechSynthesis.cancel();
    clearMark();
    set({ active: false, playing: false, queue: [], at: 0 });
  },
  setRate(rate) {
    set({ rate });
    void platform.stateSet("listen", { rate, voice: get().voice });
    if (get().playing) get().skip(0);
  },
  setVoice(voice) {
    set({ voice });
    void platform.stateSet("listen", { rate: get().rate, voice });
    if (get().playing) get().skip(0);
  },
}));

// Saved speed and voice.
void platform.stateGet<{ rate?: number; voice?: string }>("listen").then((s) => s && useListen.setState({ rate: s.rate ?? 1, voice: s.voice ?? null }));

function loadVoices() {
  const pick = () => {
    const all = speechSynthesis.getVoices().filter((v) => /^en\b|^en-/i.test(v.lang));
    useListen.setState({ voices: all.length ? all : speechSynthesis.getVoices() });
  };
  pick();
  speechSynthesis.onvoiceschanged = pick;
}

function speak() {
  const my = ++token;
  const { queue, at, rate, voice, voices } = useListen.getState();
  const line = queue[at];
  if (!line) {
    useListen.setState({ playing: false });
    clearMark();
    return;
  }
  mark();
  const u = new SpeechSynthesisUtterance(line.say);
  u.rate = rate;
  const v = voices.find((x) => x.voiceURI === voice) ?? voices.find((x) => x.default) ?? voices[0];
  if (v) u.voice = v;
  u.onend = () => {
    if (my !== token) return;
    const next = useListen.getState().at + 1;
    if (next >= useListen.getState().queue.length) {
      useListen.setState({ playing: false });
      clearMark();
      return;
    }
    useListen.setState({ at: next });
    // A short breath after a heading.
    if (line.heading) setTimeout(() => my === token && speak(), 350);
    else speak();
  };
  u.onerror = (e) => {
    if (my !== token || e.error === "interrupted" || e.error === "canceled") return;
    const none = !speechSynthesis.getVoices().length;
    useListen.setState({ playing: false, error: none ? "No voice is installed on this computer." : "The voice stopped unexpectedly." });
  };
  speechSynthesis.speak(u);
}

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
