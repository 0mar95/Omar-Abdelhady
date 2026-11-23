// Transient overlays: table of contents, typography, figure zoom. They appear
// on demand and close with Esc; the page itself never shares space with them.

import { useEffect, useMemo, useRef, useState } from "react";
import { platform } from "../platform";
import { useNotes } from "../state/notes";
import { useReader } from "../state/reader";
import { FONTS, useSettings, type FontChoice, type Theme } from "../state/settings";
import { IconX } from "../ui/icons";
import { PageCrop, useZoom } from "./BlockView";

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

export function TypePanel() {
  const s = useSettings();
  const setOverlay = useReader((r) => r.setOverlay);
  const [models, setModels] = useState<string[] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  useEffect(() => {
    platform.aiStatus(s.ollamaUrl).then((r) => {
      setModels(r.ok ? r.models : []);
      setAiError(r.ok ? null : "Ollama isn't reachable on this computer.");
    });
  }, [s.ollamaUrl]);
  return (
    <div className="fixed inset-0 z-50" onMouseDown={() => setOverlay(null)}>
      <div
        role="dialog"
        aria-label="Reading settings"
        onMouseDown={(e) => e.stopPropagation()}
        className="scroll-quiet absolute right-4 top-14 max-h-[calc(100vh-5rem)] w-[340px] overflow-y-auto rounded-2xl bg-card p-4 font-ui text-[13px] shadow-[var(--shadow)] ring-1 ring-rule"
      >
        <Section title="Theme">
          <div className="grid grid-cols-4 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => s.set({ theme: t.id })}
                className={`flex h-14 flex-col items-center justify-center rounded-xl text-[11px] ring-2 ${s.theme === t.id ? "ring-[var(--accent)]" : "ring-transparent"}`}
                style={{ background: t.bg, color: t.fg, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.08)" }}
              >
                <span className="font-serif text-[17px] leading-none">Aa</span>
                {t.label}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Font">
          <div className="space-y-1">
            {(Object.keys(FONTS) as FontChoice[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => s.set({ font: f })}
                className={`flex w-full items-baseline justify-between rounded-lg px-3 py-2 text-left hover:bg-paper-2 ${s.font === f ? "bg-accent-soft" : ""}`}
              >
                <span style={{ fontFamily: FONTS[f].css }} className="text-[16px]">
                  {FONTS[f].label}
                </span>
                <span className="text-[11px] text-ink-3">{FONTS[f].note}</span>
              </button>
            ))}
          </div>
        </Section>
        <Section title="Layout">
          <Slider label="Size" value={s.size} min={14} max={28} step={1} fmt={(v) => `${v}px`} onChange={(v) => s.set({ size: v })} />
          <Slider label="Line spacing" value={s.leading} min={1.3} max={2.1} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => s.set({ leading: v })} />
          <Slider label="Line length" value={s.measure} min={45} max={95} step={1} fmt={(v) => `${v} ch`} onChange={(v) => s.set({ measure: v })} />
          <Toggle label="Justify text" value={s.justify} onChange={(v) => s.set({ justify: v })} />
          <Toggle label="Indent paragraphs (book style)" value={s.indent} onChange={(v) => s.set({ indent: v })} />
          <Toggle label="Original page numbers in margin" value={s.pageNumbers} onChange={(v) => s.set({ pageNumbers: v })} />
        </Section>
        <Section title="AI (on this computer)">
          <label className="mb-1 block text-[12px] text-ink-2">Model</label>
          <input
            list="ollama-models"
            value={s.model}
            onChange={(e) => s.set({ model: e.target.value })}
            className="w-full rounded-lg bg-paper-2 px-3 py-2 outline-none"
          />
          <datalist id="ollama-models">{models?.map((m) => <option key={m} value={m} />)}</datalist>
          {platform.hasIndex && (
            <>
              <label className="mb-1 mt-3 block text-[12px] text-ink-2">Search model (meaning-based search)</label>
              <input
                list="ollama-models"
                value={s.embedModel}
                onChange={(e) => s.set({ embedModel: e.target.value })}
                className="w-full rounded-lg bg-paper-2 px-3 py-2 outline-none"
              />
              <IndexLine models={models} embedModel={s.embedModel} />
              <Toggle label="Margin notes (section summaries)" value={s.marginNotes} onChange={(v) => s.set({ marginNotes: v })} />
            </>
          )}
          <p className="mb-0 mt-2 text-[11.5px] leading-snug text-ink-3">
            {aiError
              ? `${aiError} Install it from ollama.com, then run “ollama pull ${s.model}”.`
              : models
                ? models.includes(s.model) || models.some((m) => m.startsWith(`${s.model}:`))
                  ? `Ready · ${models.length} model${models.length === 1 ? "" : "s"} installed.`
                  : `“${s.model}” isn't installed yet. Run “ollama pull ${s.model}”.`
                : "Checking Ollama…"}
          </p>
        </Section>
      </div>
    </div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt(v: number): string; onChange(v: number): void }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 flex justify-between text-[12px] text-ink-2">
        {label}
        <span className="tabular-nums text-ink-3">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5 text-[12.5px] text-ink-2">
      {label}
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
    </label>
  );
}

export function ZoomOverlay() {
  const target = useZoom((s) => s.target);
  const set = useZoom((s) => s.set);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);
  if (!target) return null;
  const w = target.rect.x1 - target.rect.x0;
  const h = target.rect.y1 - target.rect.y0;
  const fit = Math.min((window.innerWidth - 80) / w, (window.innerHeight - 120) / h);
  return (
    <div className="fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center bg-black/75 p-8" onClick={() => set(null)} role="dialog" aria-label={target.title}>
      <div className="rounded-md bg-white p-3 shadow-2xl">
        <PageCrop page={target.page} rect={target.rect} alt={target.title} maxWidth={w * fit} scale={fit} />
      </div>
      <div className="mt-3 font-ui text-[13px] text-white/80">{target.title} · click or press Esc to close</div>
    </div>
  );
}
