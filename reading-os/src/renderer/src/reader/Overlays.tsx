// Transient overlays: table of contents, typography, figure zoom. They appear
// on demand and close with Esc; the page itself never shares space with them.

import { useEffect, useMemo, useRef, useState } from "react";
import { platform } from "../platform";
import { useNotes } from "../state/notes";
import { useReader } from "../state/reader";
import { FONTS, useSettings, type FontChoice, type Theme } from "../state/settings";
import { IconX } from "../ui/icons";

export function TocSheet() {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const current = useReader((s) => s.currentBlock);
  const { jumpTo, setOverlay } = useReader.getState();
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const currentIdx = current ? ix.byId.get(current) ?? 0 : 0;
  const activeId = useMemo(() => {
    let id: string | null = null;
    for (const t of book.toc) if ((ix.byId.get(t.blockId) ?? 0) <= currentIdx) id = t.id;
    return id;
  }, [book, ix, currentIdx]);
  const entries = book.toc.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex" onMouseDown={() => setOverlay(null)}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />
      <nav
        aria-label="Contents"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex h-full w-[min(380px,90vw)] flex-col bg-card font-ui shadow-[var(--shadow)] ring-1 ring-rule"
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 pb-3 pt-12">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Contents</div>
            <div className="truncate text-[14px] font-semibold">{book.title}</div>
          </div>
          <button type="button" onClick={() => setOverlay("glossary")} className="rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink">
            Glossary
          </button>
          <button type="button" aria-label="Close" onClick={() => setOverlay(null)} className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-paper-2">
            <IconX size={16} />
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter sections…"
          className="mx-4 mt-3 rounded-lg bg-paper-2 px-3 py-2 text-[13px] outline-none placeholder:text-ink-3"
        />
        <div ref={listRef} className="scroll-quiet mt-2 flex-1 overflow-y-auto px-2 pb-6">
          {entries.map((t) => {
            const active = t.id === activeId;
            return (
              <button
                key={t.id}
                type="button"
                data-active={active}
                onClick={() => {
                  jumpTo({ blockId: t.blockId });
                  setOverlay(null);
                }}
                className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-paper-2 ${active ? "bg-accent-soft text-ink" : ""}`}
                style={{ paddingLeft: 8 + (t.level - 1) * 14 }}
              >
                <span className={`min-w-0 flex-1 ${t.level === 1 ? "text-[13.5px] font-semibold" : t.level === 2 ? "text-[13px] text-ink" : "text-[12.5px] text-ink-2"}`}>{t.title}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{book.pages[t.page]?.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

const THEMES: { id: Theme; label: string; bg: string; fg: string }[] = [
  { id: "light", label: "Light", bg: "#fbfaf7", fg: "#1f1d1a" },
  { id: "sepia", label: "Sepia", bg: "#f6efe2", fg: "#3a2f23" },
  { id: "dark", label: "Dark", bg: "#1c1b19", fg: "#e6e1d8" },
  { id: "black", label: "Black", bg: "#000000", fg: "#d9d6d0" },
];

const SPACING = [
  { label: "Tight", value: 1.45 },
  { label: "Normal", value: 1.65 },
  { label: "Airy", value: 1.9 },
];
const MEASURE = [
  { label: "Narrow", value: 56 },
  { label: "Medium", value: 66 },
  { label: "Wide", value: 80 },
];
type Tab = "text" | "page" | "ai";
const TAB_KEY = "readingos.settingsTab";

/** The preset closest to a value saved before presets existed (or set elsewhere). */
const nearest = (list: { value: number }[], v: number) => list.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a)).value;

export function TypePanel() {
  const setOverlay = useReader((r) => r.setOverlay);
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || "text";
    } catch {
      return "text";
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* fine without remembering */
    }
  };
  return (
    <div className="fixed inset-0 z-50" onMouseDown={() => setOverlay(null)}>
      <div
        role="dialog"
        aria-label="Reading settings"
        onMouseDown={(e) => e.stopPropagation()}
        className="scroll-quiet absolute right-4 top-14 max-h-[calc(100vh-6.75rem)] w-[348px] overflow-y-auto rounded-[18px] bg-card p-3.5 font-ui text-[13px] text-ink shadow-[var(--shadow)] ring-1 ring-rule"
      >
        <div role="tablist" aria-label="Settings" className="grid grid-cols-3 gap-1 rounded-[10px] bg-paper-2 p-[3px]">
          {(["text", "page", "ai"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-[30px] rounded-lg text-[12.5px] ${tab === t ? "bg-card font-semibold text-ink shadow-sm" : "font-medium text-ink-3 hover:text-ink"}`}
            >
              {{ text: "Text", page: "Page", ai: "AI" }[t]}
            </button>
          ))}
        </div>
        <div className="mt-3.5" role="tabpanel">
          {tab === "text" ? <TextTab /> : tab === "page" ? <PageTab /> : <AiTab />}
        </div>
      </div>
    </div>
  );
}

function TextTab() {
  const s = useSettings();
  const sample = usePreviewSentence();
  return (
    <div className="flex flex-col gap-3.5">
      {/* Live preview: the change shows here before you look back at the book. */}
      <div
        className="max-h-[132px] overflow-hidden rounded-xl bg-paper px-4 py-3 text-ink ring-1 ring-rule/60"
        style={{ fontFamily: FONTS[s.font].css, fontSize: Math.min(s.size, 22), lineHeight: s.leading }}
        aria-label="Preview"
      >
        {sample}
      </div>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={s.theme === t.id}
            aria-label={t.label}
            title={t.label}
            onClick={() => s.set({ theme: t.id })}
            className={`h-10 rounded-[10px] text-[14px] [font-family:'Literata_Variable',Georgia,serif] ${s.theme === t.id ? "outline-2 outline-offset-2 outline-[var(--accent)]" : "outline-none"}`}
            style={{ background: t.bg, color: t.fg, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.1)" }}
          >
            Aa
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Font">
        {(Object.keys(FONTS) as FontChoice[]).map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={s.font === f}
            title={FONTS[f].note}
            onClick={() => s.set({ font: f })}
            className={`h-[34px] rounded-[9px] px-3 text-[14px] text-ink ring-1 ${s.font === f ? "bg-accent-soft ring-[var(--accent)]" : "ring-rule hover:bg-paper-2"}`}
            style={{ fontFamily: FONTS[f].css }}
          >
            {FONTS[f].label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-ink-2">Size</span>
        <div className="flex items-center gap-1 rounded-[10px] bg-paper-2 p-[3px]">
          <button
            type="button"
            aria-label="Smaller text"
            disabled={s.size <= 14}
            onClick={() => s.set({ size: Math.max(14, s.size - 1) })}
            className="h-[30px] w-9 rounded-lg bg-card text-[12px] text-ink shadow-sm disabled:opacity-40 [font-family:'Literata_Variable',Georgia,serif]"
          >
            A
          </button>
          <span className="w-10 text-center tabular-nums">{s.size}</span>
          <button
            type="button"
            aria-label="Larger text"
            disabled={s.size >= 28}
            onClick={() => s.set({ size: Math.min(28, s.size + 1) })}
            className="h-[30px] w-9 rounded-lg bg-card text-[17px] text-ink shadow-sm disabled:opacity-40 [font-family:'Literata_Variable',Georgia,serif]"
          >
            A
          </button>
        </div>
      </div>
      <Segmented label="Line spacing" options={SPACING} value={nearest(SPACING, s.leading)} onChange={(v) => s.set({ leading: v })} />
      <Segmented label="Line length" options={MEASURE} value={nearest(MEASURE, s.measure)} onChange={(v) => s.set({ measure: v })} />
    </div>
  );
}

function PageTab() {
  const s = useSettings();
  const isPdf = useReader((r) => !r.book?.format || r.book.format === "pdf");
  return (
    <div className="flex flex-col">
      <Switch label="Indent paragraphs" hint="Book style: no gap between paragraphs" value={s.indent} onChange={(v) => s.set({ indent: v })} />
      <Switch label="Justify text" hint="Straight right edge" value={s.justify} onChange={(v) => s.set({ justify: v })} />
      {isPdf && <Switch label="Page numbers in margin" hint="The printed page numbers" value={s.pageNumbers} onChange={(v) => s.set({ pageNumbers: v })} />}
      <Switch label="Underline glossary terms" hint="Hover one for its definition" value={s.glossaryMarks} onChange={(v) => s.set({ glossaryMarks: v })} />
      <Switch label="Focus mode" hint="Dim everything but the paragraph you're reading · F" value={s.focus} onChange={(v) => s.set({ focus: v })} />
    </div>
  );
}

function AiTab() {
  const s = useSettings();
  const [models, setModels] = useState<string[] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  useEffect(() => {
    platform.aiStatus(s.ollamaUrl).then((r) => {
      setModels(r.ok ? r.models : []);
      setAiError(r.ok ? null : "Ollama isn't reachable on this computer.");
    });
  }, [s.ollamaUrl]);
  const ready = models && (models.includes(s.model) || models.some((m) => m.startsWith(`${s.model}:`)));
  return (
    <div className="flex flex-col">
      <div className={`mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px] leading-snug ${ready ? "bg-paper-2 text-ink-2" : "bg-accent-soft text-ink"}`}>
        <span className={`mt-[5px] size-2 shrink-0 rounded-full ${ready ? "bg-[#3f7d4f]" : models === null && !aiError ? "bg-ink-3" : "bg-[var(--accent)]"}`} />
        <span>
          {aiError
            ? `${aiError} Install it from ollama.com, then run “ollama pull ${s.model}”.`
            : models
              ? ready
                ? `Ready · runs on this computer · ${models.length} model${models.length === 1 ? "" : "s"} installed.`
                : `“${s.model}” isn't installed yet. Run “ollama pull ${s.model}”.`
              : "Checking Ollama…"}
        </span>
      </div>
      <label className="mb-1 block text-[12px] text-ink-2" htmlFor="ai-model">
        Reading model (explanations, notes, answers)
      </label>
      <input id="ai-model" list="ollama-models" value={s.model} onChange={(e) => s.set({ model: e.target.value })} className="w-full rounded-lg bg-paper-2 px-3 py-2 outline-none" />
      <datalist id="ollama-models">{models?.map((m) => <option key={m} value={m} />)}</datalist>
      {platform.hasIndex && (
        <>
          <label className="mb-1 mt-3 block text-[12px] text-ink-2" htmlFor="ai-embed">
            Search model (search by meaning)
          </label>
          <input id="ai-embed" list="ollama-models" value={s.embedModel} onChange={(e) => s.set({ embedModel: e.target.value })} className="w-full rounded-lg bg-paper-2 px-3 py-2 outline-none" />
          <IndexLine models={models} embedModel={s.embedModel} />
          <div className="mt-2">
            <Switch label="Margin notes" hint="A summary beside each section" value={s.marginNotes} onChange={(v) => s.set({ marginNotes: v })} />
          </div>
        </>
      )}
      <Switch label="Catch me up" hint="A recap when you come back to a book" value={s.catchUp} onChange={(v) => s.set({ catchUp: v })} />
    </div>
  );
}

/** A sentence from where the reader is, so the preview shows their own book. */
function usePreviewSentence(): string {
  const book = useReader((r) => r.book);
  const ix = useReader((r) => r.ix);
  const current = useReader((r) => r.currentBlock);
  return useMemo(() => {
    const fallback = "Reading should feel effortless: comfortable type, calm spacing, and lines that are easy to follow.";
    if (!book || !ix) return fallback;
    const start = current ? ix.byId.get(current) ?? 0 : 0;
    for (let i = start; i < Math.min(book.blocks.length, start + 40); i++) {
      const b = book.blocks[i];
      if (b.kind !== "paragraph" || b.small) continue;
      const t = ix.texts[i].replace(/\s+/g, " ").trim();
      if (t.length < 60) continue;
      const cut = t.slice(0, 150);
      const end = cut.lastIndexOf(" ");
      return t.length > 150 ? `${cut.slice(0, end)}…` : t;
    }
    return fallback;
  }, [book, ix, current]);
}

function Segmented({ label, options, value, onChange }: { label: string; options: { label: string; value: number }[]; value: number; onChange(v: number): void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-ink-2">{label}</span>
      <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-paper-2 p-[3px]" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`h-[30px] rounded-lg text-[12.5px] ${value === o.value ? "bg-card font-semibold text-ink shadow-sm" : "font-medium text-ink-3 hover:text-ink"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-3 rounded-lg py-2.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-ink-3">{hint}</span>}
      </span>
      <span className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${value ? "bg-[var(--accent)]" : "bg-rule"}`}>
        <span className={`absolute top-[3px] size-4 rounded-full bg-white shadow transition-[left] ${value ? "left-[19px]" : "left-[3px]"}`} />
      </span>
    </button>
  );
}

function IndexLine({ models, embedModel }: { models: string[] | null; embedModel: string }) {
  const st = useNotes((n) => n.status);
  if (!st) return null;
  const installed = !models || models.some((m) => m === embedModel || m.startsWith(`${embedModel}:`));
  const text =
    st.state === "no-embed-model" || !installed
      ? `Not installed — run “ollama pull ${embedModel}”. Exact-word search works meanwhile.`
      : st.state === "offline"
        ? "Ollama is off: exact-word search only for now."
        : st.state === "ready"
          ? `This book is ready for search by meaning · ${st.notes} margin notes so far.`
          : `Preparing this book: ${Math.round((st.embedded / Math.max(1, st.chunks)) * 100)}% · ${st.notes} margin notes so far.`;
  return <p className="mb-1 mt-2 text-[11.5px] leading-snug text-ink-3">{text}</p>;
}




