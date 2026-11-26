// Listen: the book read aloud a sentence at a time, each sentence highlighted
// as it's read and kept in view. Figures, tables, captions, code and reference
// lists are skipped.
//
// The voices are Kokoro, a neural voice model running on this computer
// (downloaded once, then offline). Sentences are made a little ahead of where
// you are and played through Web Audio.

import { create } from "zustand";
import type { Block, BookDoc } from "../../../shared/model";
import { findText } from "./highlights";
import { useReader } from "./reader";
import { platform } from "../platform";
import type { VoiceStatus } from "../../../shared/ipc";
import { clauses, spoken } from "../../../shared/speech";
import type { BookUnits } from "../../../shared/units";

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
  /** "natural:<id>"; null is the default voice. */
  voice: string | null;
  /** Natural voices' state; null where they aren't available (browser build). */
  natural: VoiceStatus | null;
  /** Loading the voice for the sentence about to be read. */
  waiting: boolean;
  /** The page follows the voice; false once you scroll away yourself. */
  following: boolean;
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
  /** Loads already-downloaded voices in the background (never downloads). */
  warm(): void;
  /** Scrolls back to the sentence being read and follows it again. */
  follow(): void;
}


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

function queueFrom(book: BookDoc, texts: string[], start: number, units?: BookUnits): Line[] {
  const out: Line[] = [];
  // The folded front and back matter aren't read aloud — unless reading starts inside them.
  const startUnit = units?.unitOf[start];
  for (let i = start; i < book.blocks.length && out.length < 4000; i++) {
    const k = units?.unitOf[i];
    if (units && k !== undefined && k !== startUnit && units.units[k]?.kind !== "read") continue;
    out.push(...linesOf(book.blocks[i], texts[i]));
  }
  return out;
}

/** The voice to read with: the saved choice, or the default. */
const chosen = () => {
  const v = useListen.getState().voice;
  return (v && NATURAL_VOICES.some((n) => `natural:${n.id}` === v) ? v : DEFAULT_NATURAL).slice("natural:".length);
};

const ready = (n: VoiceStatus | null) => !!n && n.state !== "missing" && n.state !== "error";

export const useListen = create<ListenStore>((set, get) => ({
  active: false,
  playing: false,
  rate: 1,
  voice: null,
  natural: null,
  waiting: false,
  following: true,
  at: 0,
  queue: [],
  error: null,
  start(fromBlockId) {
    const { book, ix, currentBlock } = useReader.getState();
    if (!book || !ix) return;
    if (!platform.voices) {
      set({ active: true, playing: false, error: "Reading aloud needs the Kenning app." });
      return;
    }
    const from = ix.byId.get(fromBlockId ?? currentBlock ?? "") ?? 0;
    const queue = queueFrom(book, ix.texts, from, ix.units);
    player.reset();
    // Before the voices are downloaded the bar offers the download; reading starts when it's done.
    const go = ready(get().natural) && queue.length > 0;
    set({ active: true, playing: go, following: true, queue, at: 0, error: queue.length ? null : "Nothing to read from here." });
    mark();
    if (go) player.play(0);
  },
  toggle() {
    if (!get().active) return get().start();
    if (get().playing) {
      player.pause();
      set({ playing: false, waiting: false });
    } else {
      set({ playing: true, error: null });
      player.resume(get().at);
    }
  },
  skip(by) {
    const at = Math.max(0, Math.min(get().queue.length - 1, get().at + by));
    set({ at, following: true });
    mark();
    if (get().playing) player.play(at);
    else player.reset(false);
  },
  stop() {
    player.reset();
    clearMark();
    set({ active: false, playing: false, waiting: false, queue: [], at: 0 });
  },
  setRate(rate) {
    set({ rate });
    save();
    player.forget();
    if (get().playing) player.play(get().at);
  },
  setVoice(voice) {
    set({ voice, error: null });
    save();
    player.forget();
    if (get().playing) player.play(get().at);
  },
  warm() {
    const v = platform.voices;
    if (!v || get().natural?.state !== "downloaded") return;
    void v.prepare().then((natural) => set({ natural }));
  },
  async getNatural() {
    const v = platform.voices;
    if (!v) return;
    set({ natural: { state: "loading", progress: 0 } });
    const s = await v.prepare();
    set({ natural: s });
    if (s.state !== "ready") return;
    if (!get().voice) set({ voice: `natural:${chosen()}` });
    // Start reading right away.
    if (get().active && !get().playing) {
      set({ playing: true, error: null });
      player.play(get().at);
    }
  },
  follow() {
    set({ following: true });
    mark(true);
  },
}));

function save() {
  const { rate, voice } = useListen.getState();
  void platform.stateSet("listen", { rate, voice });
}

// Saved speed and voice (system voices chosen before the natural ones existed are forgotten).
void platform.stateGet<{ rate?: number; voice?: string }>("listen").then((s) => {
  if (!s) return;
  useListen.setState({ rate: s.rate ?? 1, voice: s.voice?.startsWith("natural:") ? s.voice : null });
});

// The natural voices' state, kept current (download progress, ready).
if (platform.voices) {
  void platform.voices.status().then((natural) => useListen.setState({ natural }));
  platform.voices.onStatus((natural) => useListen.setState({ natural }));
}

// Scrolling yourself stops the page following the voice (it never pulls you
// back mid-scroll); "Back to the voice" or reaching the sentence resumes it.
if (typeof window !== "undefined") {
  const away = () => {
    if (useListen.getState().active && useListen.getState().following) useListen.setState({ following: false });
  };
  window.addEventListener("wheel", away, { passive: true });
  window.addEventListener("touchmove", away, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(e.key) && !(e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) away();
  });
}

/**
 * The player. Sentences are made a good way ahead (about half a minute) and
 * each is scheduled on the audio clock to start exactly when the one before
 * ends — so playback runs on its own, unaffected by scrolling or anything else
 * the page is doing. A light ticker only moves the highlight along.
 */
const AHEAD_SECONDS = 30;
const AHEAD_SENTENCES = 8;

/** For checking playback: how often speech ran dry mid-reading. */
export const stats = { stalls: 0 };
if (typeof window !== "undefined") (window as unknown as { kenningListen?: unknown }).kenningListen = { stats, at: () => useListen.getState().at };

const player = (() => {
  let ctx: AudioContext | null = null;
  let gen = 0;
  let key = "";
  const made = new Map<number, Promise<AudioBuffer>>();
  let scheduled: { i: number; start: number; end: number; src: AudioBufferSourceNode }[] = [];
  let next = 0;
  let lastEnd = 0;
  let ticker: number | null = null;
  const context = () => (ctx ??= new AudioContext({ latencyHint: "playback" }));

  const want = () => `${chosen()}|${useListen.getState().rate}`;

  function fetch(i: number): Promise<AudioBuffer> {
    if (key !== want()) {
      made.clear();
      key = want();
    }
    let p = made.get(i);
    if (!p) {
      const { queue, rate } = useListen.getState();
      p = platform.voices!.speak(queue[i].say, chosen(), rate).then(({ rate: hz, pcm }) => {
        const b = context().createBuffer(1, pcm.length, hz);
        b.copyToChannel(new Float32Array(pcm), 0);
        return b;
      });
      p.catch(() => made.get(i) === p && made.delete(i));
      made.set(i, p);
    }
    return p;
  }

  function silence() {
    for (const s of scheduled) {
      s.src.onended = null;
      try {
        s.src.stop();
      } catch {
        /* not started */
      }
    }
    scheduled = [];
  }

  async function pump(g: number) {
    const c = context();
    while (g === gen) {
      const { queue } = useListen.getState();
      if (next >= queue.length) return;
      // Keep several sentences in the making, never more than half a minute ahead.
      for (let k = next; k < Math.min(queue.length, next + AHEAD_SENTENCES); k++) void fetch(k).catch(() => {});
      if (lastEnd - c.currentTime > AHEAD_SECONDS) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (lastEnd <= c.currentTime + 0.05) {
        const silent = !scheduled.some((s) => s.end > c.currentTime);
        if (silent && scheduled.length) stats.stalls++;
        useListen.setState({ waiting: silent });
      }
      let buf: AudioBuffer;
      try {
        buf = await fetch(next);
      } catch (e) {
        if (g !== gen || /cancelled/.test(String(e))) return;
        useListen.setState({ waiting: false, playing: false, error: "The voice stopped. Press play to try again." });
        return;
      }
      if (g !== gen) return;
      // A short breath after a heading.
      const gap = queue[next - 1]?.heading ? 0.35 : 0.04;
      const start = Math.max(c.currentTime + 0.05, lastEnd + gap);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(start);
      scheduled.push({ i: next, start, end: start + buf.duration, src });
      lastEnd = start + buf.duration;
      next++;
      useListen.setState({ waiting: false });
    }
  }

  function tick() {
    const c = ctx;
    if (!c) return;
    const t = c.currentTime;
    const st = useListen.getState();
    const now = scheduled.find((s) => s.start <= t + 0.02 && t < s.end);
    if (now && now.i !== st.at) {
      useListen.setState({ at: now.i });
      mark();
    }
    scheduled = scheduled.filter((s) => s.end > t - 2);
    // Made sentences well behind are let go.
    for (const k of made.keys()) if (k < st.at - 2) made.delete(k);
    if (next >= st.queue.length && t > lastEnd + 0.2 && st.playing) {
      useListen.setState({ playing: false });
      clearMark();
      stopTicker();
    }
  }

  const startTicker = () => {
    if (ticker === null) ticker = window.setInterval(tick, 150);
  };
  const stopTicker = () => {
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
  };

  return {
    /** Starts reading at sentence `at` (dropping anything scheduled). */
    play(at: number) {
      gen++;
      platform.voices?.cancel();
      silence();
      const c = context();
      void c.resume();
      next = at;
      lastEnd = c.currentTime;
      startTicker();
      void pump(gen);
    },
    /** Pausing freezes the audio clock: nothing is lost, resuming is instant. */
    pause() {
      void ctx?.suspend();
    },
    resume(at: number) {
      if (ctx && scheduled.length) {
        void ctx.resume();
        startTicker();
      } else this.play(at);
    },
    /** Voice or speed changed: what was made no longer fits. */
    forget() {
      made.clear();
      key = "";
    },
    reset(clearMade = true) {
      gen++;
      platform.voices?.cancel();
      silence();
      stopTicker();
      if (clearMade) made.clear();
      void ctx?.resume();
    },
  };
})();

/** Highlights the sentence being read and, while following, keeps it in view. */
function mark(force = false) {
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
  const visible = r.bottom > 60 && r.top < window.innerHeight - 100;
  // Reached the voice again by scrolling: follow it from here.
  if (visible && !useListen.getState().following && !force) useListen.setState({ following: true });
  if (!useListen.getState().following && !force) return;
  if (force || r.top < 90 || r.bottom > window.innerHeight - 140) {
    // Centre the sentence itself (a long paragraph or list is taller than the window).
    const scroller = el.closest<HTMLElement>("[data-testid=reader-scroll]");
    if (scroller) scroller.scrollBy({ top: r.top + r.height / 2 - window.innerHeight * 0.45, behavior: "smooth" });
    else (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  }
  useReader.getState().setPosition(line.blockId);
}

function clearMark() {
  (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete("listen");
}
