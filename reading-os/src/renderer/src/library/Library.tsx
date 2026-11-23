// The home screen: a top bar (search every book, AI status, add a book), the
// book you're reading front and centre, and the shelf with covers.

import { useEffect, useMemo, useRef, useState } from "react";
import { coverColor, removeCover, useCover } from "../covers";
import { platform } from "../platform";
import { useLibrary, type LibraryEntry } from "../state/library";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { IconOpen, IconSearch } from "../ui/icons";

const isMac = navigator.platform.toLowerCase().includes("mac");

const FORMAT_NAMES: Record<string, string> = { epub: "EPUB", docx: "Word", html: "Web page", markdown: "Markdown", text: "Text", pdf: "PDF" };
const BADGE: Record<string, string> = { epub: "EPUB", docx: "WORD", html: "WEB", markdown: "MD", text: "TEXT", pdf: "PDF" };
const fmt = (e: LibraryEntry) => e.format ?? "pdf";

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "12 min read", "4 h read". */
function readingTime(words: number): string {
  const min = Math.max(1, Math.round(words / 230));
  return min < 60 ? `${min} min read` : `${Math.round(min / 60)} h read`;
}

const inProgress = (e: LibraryEntry) => e.progress > 0.005 && e.progress < 0.99;

type Filter = "all" | "pdf" | "epub" | "docs";
type Sort = "recent" | "title" | "progress";
const inFilter = (e: LibraryEntry, f: Filter) => f === "all" || (f === "pdf" ? fmt(e) === "pdf" : f === "epub" ? fmt(e) === "epub" : fmt(e) !== "pdf" && fmt(e) !== "epub");

export function Library({ onOpenFile }: { onOpenFile(): void }) {
  const entries = useLibrary((s) => s.entries);
  const openEntry = useReader((s) => s.openEntry);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");

  const byRecent = useMemo(() => [...entries].sort((a, b) => b.openedAt - a.openedAt), [entries]);
  const current = byRecent.find(inProgress);
  const also = byRecent.filter((e) => e !== current && inProgress(e)).slice(0, 3);
  const shelf = useMemo(() => {
    const list = entries.filter((e) => inFilter(e, filter));
    if (sort === "title") return list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "progress") return list.sort((a, b) => b.progress - a.progress);
    return list.sort((a, b) => b.openedAt - a.openedAt);
  }, [entries, filter, sort]);
  const counts = useMemo(
    () => ({
      all: entries.length,
      pdf: entries.filter((e) => inFilter(e, "pdf")).length,
      epub: entries.filter((e) => inFilter(e, "epub")).length,
      docs: entries.filter((e) => inFilter(e, "docs")).length,
    }),
    [entries],
  );

  return (
    <div className="flex h-full flex-col font-ui">
      <TopBar onOpenFile={onOpenFile} />
      <div className="scroll-quiet flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-8 sm:px-10">
          {entries.length === 0 ? (
            <EmptyShelf onOpenFile={onOpenFile} />
          ) : (
            <>
              {current && (
                <section aria-label="Continue reading" className="mb-10 flex flex-wrap gap-6">
                  <ContinueCard e={current} onOpen={() => void openEntry(current)} />
                  {also.length > 0 && (
                    <div className="flex w-full flex-col gap-2.5 lg:w-[300px]">
                      <div className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Also in progress</div>
                      {also.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => void openEntry(e)}
                          className="flex items-center gap-3.5 rounded-2xl bg-card p-3 text-left ring-1 ring-rule/60 hover:ring-rule"
                        >
                          <Cover e={e} className="h-14 w-10 shrink-0" mini />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14.5px] font-semibold text-ink [font-family:'Literata_Variable',Georgia,serif]">
                              {e.title}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                              {FORMAT_NAMES[fmt(e)]} · {Math.round(e.progress * 100)}%
                            </span>
                            <Progress value={e.progress} className="mt-2" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section aria-label="Your library">
                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <h2 className="m-0 mr-3 text-[22px] font-semibold text-ink [font-family:'Literata_Variable',Georgia,serif]">Your library</h2>
                  {(["all", "pdf", "epub", "docs"] as Filter[])
                    .filter((f) => f === "all" || counts[f] > 0)
                    .map((f) => (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={filter === f}
                        onClick={() => setFilter(f)}
                        className={`h-[30px] rounded-full px-3 text-[12.5px] font-medium ring-1 ${filter === f ? "bg-ink text-paper ring-ink" : "text-ink-2 ring-rule hover:ring-ink-3"}`}
                      >
                        {{ all: "All", pdf: "PDF", epub: "EPUB", docs: "Documents" }[f]} · {counts[f]}
                      </button>
                    ))}
                  <span className="flex-1" />
                  <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
                    Sort
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as Sort)}
                      className="h-[30px] rounded-lg bg-paper-2 px-2 text-[12.5px] font-medium text-ink-2 outline-none"
                    >
                      <option value="recent">Recently opened</option>
                      <option value="title">Title</option>
                      <option value="progress">Progress</option>
                    </select>
                  </label>
                </div>
                <div className="grid gap-x-7 gap-y-8 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                  {shelf.map((e) => (
                    <ShelfBook key={e.id} e={e} onOpen={() => void openEntry(e)} />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- top bar ----------

function TopBar({ onOpenFile }: { onOpenFile(): void }) {
  return (
    <header
      className={`flex h-16 shrink-0 items-center gap-3 border-b border-rule/70 bg-paper px-4 [-webkit-app-region:drag] sm:px-6 ${isMac && window.readingOS ? "pl-20 sm:pl-24" : ""}`}
    >
      <div className="shrink-0 text-[19px] font-semibold tracking-tight text-ink [font-family:'Literata_Variable',Georgia,serif]">Reading OS</div>
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={() => useReader.getState().setOverlay("palette")}
          className="flex h-[38px] w-full max-w-[520px] items-center gap-2.5 rounded-[10px] bg-paper-2 px-3 text-left text-[13.5px] text-ink-3 hover:text-ink-2 [-webkit-app-region:no-drag]"
        >
          <IconSearch size={16} />
          <span className="min-w-0 flex-1 truncate">Search all your books, or ask a question</span>
          <kbd className="hidden rounded border border-rule px-1.5 text-[11px] sm:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </div>
      <AiPill />
      <button
        type="button"
        onClick={onOpenFile}
        className="flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-[var(--accent)] px-4 text-[13.5px] font-semibold text-paper hover:brightness-110 [-webkit-app-region:no-drag]"
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="hidden sm:inline">Add a book</span>
      </button>
    </header>
  );
}

type AiState = "checking" | "ready" | "missing-model" | "offline";

function AiPill() {
  const { model, ollamaUrl } = useSettings();
  const [state, setState] = useState<AiState>("checking");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    platform.aiStatus(ollamaUrl).then((r) => {
      if (!r.ok) setState("offline");
      else setState(r.models.some((m) => m === model || m.startsWith(`${model}:`)) ? "ready" : "missing-model");
    });
  }, [model, ollamaUrl]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const label = { checking: "Checking AI…", ready: `AI ready on this ${isMac ? "Mac" : "computer"}`, "missing-model": "AI model missing", offline: "AI off" }[state];
  const dot = state === "ready" ? "bg-[#3f7d4f]" : state === "checking" ? "bg-ink-3" : "bg-[var(--accent)]";
  return (
    <div ref={ref} className="relative hidden shrink-0 md:block [-webkit-app-region:no-drag]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-full bg-paper-2 px-3 text-[12.5px] text-ink-2 hover:text-ink"
      >
        <span className={`size-2 rounded-full ${dot}`} />
        {label}
      </button>
      {open && (
        <div role="dialog" aria-label="Local AI" className="absolute right-0 top-10 z-40 w-[320px] rounded-2xl bg-card p-4 text-[13px] leading-relaxed text-ink-2 shadow-[var(--shadow)] ring-1 ring-rule">
          {state === "ready" ? (
            <p className="m-0">
              Explanations, margin notes and answers run on this computer with <strong className="font-semibold text-ink">{model}</strong>. Nothing is sent anywhere. Change the model in Reading settings.
            </p>
          ) : state === "missing-model" ? (
            <p className="m-0">
              Ollama is running, but the reading model isn't downloaded yet. In Terminal, run:
              <code className="mt-2 block rounded-lg bg-paper-2 px-2.5 py-1.5 text-[12px] text-ink">ollama pull {model}</code>
            </p>
          ) : (
            <p className="m-0">
              Reading and search work without AI. To turn on explanations, margin notes and answers, install Ollama from ollama.com, then run:
              <code className="mt-2 block rounded-lg bg-paper-2 px-2.5 py-1.5 text-[12px] text-ink">ollama pull {model}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- continue reading ----------

function ContinueCard({ e, onOpen }: { e: LibraryEntry; onOpen(): void }) {
  const chapter = e.chapterTitle ? `${e.chapterNumber ? `Chapter ${e.chapterNumber} · ` : ""}${e.chapterTitle}` : null;
  return (
    <div className="flex min-w-[320px] flex-1 gap-7 rounded-[18px] bg-card p-6 shadow-[var(--shadow)]">
      <button type="button" onClick={onOpen} aria-label={`Open ${e.title}`} className="hidden shrink-0 sm:block">
        <Cover e={e} className="h-[212px] w-[148px]" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">Continue reading</div>
        <h2 className="m-0 mt-1.5 text-[28px] font-semibold leading-tight tracking-tight text-ink [font-family:'Literata_Variable',Georgia,serif]">{e.title}</h2>
        {chapter && <div className="mt-1 truncate text-[13.5px] text-ink-3">{chapter}</div>}
        {!chapter && e.author && <div className="mt-1 truncate text-[13.5px] text-ink-3">{e.author}</div>}
        <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-6">
          <button type="button" onClick={onOpen} className="h-[42px] rounded-[10px] bg-[var(--accent)] px-5 text-[14px] font-semibold text-paper hover:brightness-110">
            Resume{e.pageLabel && fmt(e) === "pdf" ? ` · page ${e.pageLabel}` : ""}
          </button>
          <div className="min-w-[200px] max-w-[300px] flex-1">
            <div className="flex justify-between gap-3 text-[12px] text-ink-3">
              <span>{Math.round(e.progress * 100)}% of the book</span>
              {e.minutesLeft !== undefined && <span>{e.minutesLeft > 0 ? `${e.minutesLeft} min left in chapter` : "End of chapter"}</span>}
            </div>
            <Progress value={e.progress} className="mt-1.5 h-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- shelf ----------

function ShelfBook({ e, onOpen }: { e: LibraryEntry; onOpen(): void }) {
  const pct = Math.round(e.progress * 100);
  const finished = e.progress >= 0.99;
  const fresh = !e.position && pct === 0;
  const remove = () => {
    useLibrary.getState().remove(e.id);
    removeCover(e.id);
  };
  return (
    <div className="group flex flex-col gap-2.5">
      <div className="relative">
        <button type="button" onClick={onOpen} aria-label={`Open ${e.title}`} className="block w-full transition group-hover:-translate-y-0.5">
          <Cover e={e} className="aspect-[2/3] w-full" />
        </button>
        {fresh && <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-[#e08a5f] px-2 py-0.5 text-[10px] font-semibold text-[#2a1d16]">New</span>}
        {finished && (
          <span className="pointer-events-none absolute right-2 top-2 grid size-[22px] place-items-center rounded-full bg-paper text-[var(--accent)]" title="Finished">
            <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="m5 12 5 5 9-10" />
            </svg>
          </span>
        )}
        {/* Actions appear on hover (and keyboard focus) instead of a stray × button. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 rounded-b-[7px] bg-gradient-to-t from-black/80 via-black/60 to-transparent p-2.5 pt-12 opacity-0 transition group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <button type="button" onClick={onOpen} className="h-[30px] rounded-lg bg-[#f6efe2] text-[12px] font-semibold text-[#3a2f23] hover:bg-white">
            {pct > 0 && !finished ? "Continue" : "Open"}
          </button>
          <div className="flex gap-1.5">
            {platform.showFile && e.path && (
              <button
                type="button"
                onClick={() => platform.showFile!(e.path!)}
                className="h-7 flex-1 rounded-lg bg-white/20 text-[11px] text-[#f6efe2] hover:bg-white/30"
              >
                {isMac ? "Show in Finder" : "Show file"}
              </button>
            )}
            <button type="button" onClick={remove} className="h-7 flex-1 rounded-lg bg-white/20 text-[11px] text-[#f6efe2] hover:bg-white/30" aria-label={`Remove ${e.title} from library`}>
              Remove
            </button>
          </div>
        </div>
      </div>
      <Progress value={e.progress} />
      <div className="text-[12px] leading-snug text-ink-3">
        <span className="line-clamp-2 font-medium text-ink-2">{e.title}</span>
        {fresh ? "New" : finished ? "Finished" : `${pct}%`} · {fmt(e) === "pdf" ? `${e.pageCount} pages` : readingTime(e.words)} · {ago(e.openedAt)}
      </div>
    </div>
  );
}

/** The book's real cover when it has one; otherwise a cover drawn from the title. */
function Cover({ e, className, mini }: { e: LibraryEntry; className: string; mini?: boolean }) {
  const url = useCover(e.id);
  const shape = "rounded-[3px_7px_7px_3px] shadow-[inset_4px_0_0_rgb(0_0_0/0.16),0_6px_14px_rgb(58_47_35/0.16)]";
  if (url)
    return (
      <div className={`${className} ${shape} overflow-hidden bg-white`}>
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      </div>
    );
  return (
    <div className={`${className} ${shape} relative flex flex-col justify-end gap-2 overflow-hidden text-left text-[#f6efe2] ${mini ? "p-1" : "p-3.5"}`} style={{ background: coverColor(e.title) }}>
      {!mini && (
        <>
          <span className="absolute left-3 top-2.5 rounded bg-white/15 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.1em]">{BADGE[fmt(e)]}</span>
          <span className="line-clamp-4 text-[16px] font-semibold leading-[1.15] [font-family:'Literata_Variable',Georgia,serif]">{e.title}</span>
          {e.author && <span className="truncate text-[10px] opacity-75">{e.author}</span>}
          <span className="h-0.5 w-7 bg-[#e08a5f]" />
        </>
      )}
    </div>
  );
}

function Progress({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-[3px] overflow-hidden rounded-full bg-rule ${className}`}>
      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function EmptyShelf({ onOpenFile }: { onOpenFile(): void }) {
  return (
    <div className="pt-10">
      <h1 className="m-0 max-w-[620px] text-[36px] font-semibold leading-tight tracking-tight text-ink [font-family:'Literata_Variable',Georgia,serif]">
        Hard-to-read PDFs, turned into books you enjoy reading.
      </h1>
      <p className="mb-0 mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-2">
        Open a textbook and Reading OS rebuilds it as clean, reflowable text — with explanations, search and summaries right in the page. Everything stays on this computer.
      </p>
      <button
        type="button"
        onClick={onOpenFile}
        className="mt-8 flex h-72 w-full flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed border-rule bg-card text-ink-3 hover:border-[var(--accent)]"
      >
        <IconOpen size={34} className="text-[var(--accent)]" />
        <span className="text-[17px] font-semibold text-ink">Drop a book here, or click to choose one</span>
        <span className="text-[13.5px]">PDF · EPUB · Word · HTML · Markdown · Text</span>
      </button>
    </div>
  );
}
