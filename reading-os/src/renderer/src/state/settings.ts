import { create } from "zustand";
import { platform } from "../platform";

export type Theme = "light" | "sepia" | "dark" | "black";
export type FontChoice = "literata" | "source-serif" | "newsreader" | "inter" | "atkinson";

export const FONTS: Record<FontChoice, { label: string; css: string; note: string }> = {
  literata: { label: "Literata", css: '"Literata Variable", Georgia, serif', note: "Designed for long reading" },
  "source-serif": { label: "Source Serif", css: '"Source Serif 4 Variable", Georgia, serif', note: "Crisp, textbook feel" },
  newsreader: { label: "Newsreader", css: '"Newsreader Variable", Georgia, serif', note: "Kenning's own: calm, bookish" },
  inter: { label: "Inter", css: '"Inter Variable", system-ui, sans-serif', note: "Clean sans-serif" },
  atkinson: { label: "Atkinson", css: '"Atkinson Hyperlegible", system-ui, sans-serif', note: "Maximum legibility" },
};

export interface Settings {
  theme: Theme;
  font: FontChoice;
  size: number;
  leading: number;
  measure: number;
  justify: boolean;
  indent: boolean;
  model: string;
  embedModel: string;
  ollamaUrl: string;
  marginNotes: boolean;
  /** Dotted underline under glossary terms (hover for a definition). */
  glossaryMarks: boolean;
  /** Search and questions only use the book up to the reading position. */
  spoilerLimit: boolean;
  /** Offer a recap when a book is reopened after a break. */
  catchUp: boolean;
  /** Dim everything but the paragraph being read. */
  focus: boolean;
  /** Which design the saved reading settings belong to (see LOOK). */
  look?: number;
}

/** Bumped when Kenning's look changes: saved type and paper move to the new defaults once. */
export const LOOK = 2;

export const DEFAULT_SETTINGS: Settings = {
  theme: "sepia",
  font: "newsreader",
  size: 20,
  leading: 1.68,
  measure: 66,
  justify: false,
  indent: false,
  model: "qwen3.5:4b",
  embedModel: "qwen3-embedding:0.6b",
  ollamaUrl: "http://127.0.0.1:11434",
  marginNotes: true,
  glossaryMarks: true,
  spoilerLimit: false,
  catchUp: true,
  focus: false,
  look: LOOK,
};

interface SettingsStore extends Settings {
  loaded: boolean;
  set(patch: Partial<Settings>): void;
  load(): Promise<void>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  set(patch) {
    set(patch);
    const { loaded: _l, set: _s, load: _ld, ...rest } = { ...get(), ...patch };
    void platform.stateSet("settings", rest);
  },
  async load() {
    const saved = await platform.stateGet<Partial<Settings>>("settings");
    let merged: Settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
    if (saved && (saved.look ?? 0) < LOOK) {
      // A new look: carry over everything except the type and paper, which it redefines.
      const { theme, font, size, leading } = DEFAULT_SETTINGS;
      merged = { ...merged, font, size, leading, look: LOOK, theme: saved.theme === "dark" || saved.theme === "black" ? saved.theme : theme };
      void platform.stateSet("settings", merged);
    }
    set({ ...merged, loaded: true });
  },
}));
