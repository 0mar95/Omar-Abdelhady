import { create } from "zustand";
import { platform } from "../platform";

export type Theme = "light" | "sepia" | "dark" | "black";
export type FontChoice = "literata" | "source-serif" | "newsreader" | "inter" | "atkinson";

export const FONTS: Record<FontChoice, { label: string; css: string; note: string }> = {
  literata: { label: "Literata", css: '"Literata Variable", Georgia, serif', note: "Designed for long reading" },
  "source-serif": { label: "Source Serif", css: '"Source Serif 4 Variable", Georgia, serif', note: "Crisp, textbook feel" },
  newsreader: { label: "Newsreader", css: '"Newsreader Variable", Georgia, serif', note: "Elegant, compact" },
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
  pageNumbers: boolean;
  model: string;
  ollamaUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "sepia",
  font: "literata",
  size: 19,
  leading: 1.65,
  measure: 66,
  justify: false,
  indent: false,
  pageNumbers: true,
  model: "qwen3.5:4b",
  ollamaUrl: "http://127.0.0.1:11434",
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
    set({ ...DEFAULT_SETTINGS, ...(saved ?? {}), loaded: true });
  },
}));
