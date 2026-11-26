// The home screen: a top bar (search every book, AI status, add a book), the
// book you're reading front and centre, and the shelf with covers.

import { useEffect, useMemo, useRef, useState } from "react";
import { coverColor, removeCover, useCover } from "../covers";
import { platform } from "../platform";
import { useLibrary, type LibraryEntry } from "../state/library";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { IconOpen, IconSearch, IconTrash } from "../ui/icons";
import { ReviewPanel } from "./ReviewPanel";

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
              <section aria-label="Today" className={`mb-12 grid items-stretch gap-8 ${current ? "lg:grid-cols-[minmax(0,1fr)_320px]" : "lg:grid-cols-[minmax(0,420px)]"}`}>
                {current && <ContinueCard e={current} onOpen={() => void openEntry(current)} />}
                <ReviewPanel entries={entries} />
              </section>

              {also.length > 0 && (
                <section aria-label="Also in progress" className="mb-14">
                  <div className="mb-4 flex items-baseline gap-3 border-b border-rule pb-2.5">
                    <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">Also in progress</h2>
                  </div>
                  <div className="grid gap-x-8 gap-y-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                    {also.map((e) => (
                      <button key={e.id} type="button" onClick={() => void openEntry(e)} className="group flex items-center gap-4 text-left">
                        <Cover e={e} className="h-[78px] w-[54px] shrink-0 transition group-hover:-translate-y-0.5" mini />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[15.5px] font-semibold leading-snug text-ink font-title group-hover:text-[var(--accent)]">{e.title}</span>
                          <span className="mt-1 block truncate text-[12px] text-ink-3">
                            {e.chapterTitle ? e.chapterTitle : FORMAT_NAMES[fmt(e)]} · {Math.round(e.progress * 100)}%
                          </span>
                          <Progress value={e.progress} className="mt-2" />
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section aria-label="Your library">
                <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-rule pb-3">
                  <h2 className="m-0 mr-3 text-[24px] font-semibold text-ink font-title">On the shelf</h2>
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
      <div className="flex shrink-0 items-center gap-2.5">
        <img src="icon.png" alt="" className="size-7" draggable={false} />
        <span className="text-[24px] font-semibold tracking-[-0.02em] text-ink font-title">kenning</span>
        <span className="hidden text-[10.5px] uppercase tracking-[0.16em] text-ink-3 lg:inline">your library</span>
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={() => useReader.getState().setOverlay("palette")}
          className="flex h-[38px] w-full max-w-[520px] items-center gap-2.5 rounded-full bg-paper-2/70 px-4 text-left text-[13.5px] text-ink-3 ring-1 ring-rule hover:text-ink-2 [-webkit-app-region:no-drag]"
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
        className="flex h-[38px] shrink-0 items-center gap-2 rounded-full bg-ink px-4 text-[13.5px] font-medium text-paper hover:brightness-125 [-webkit-app-region:no-drag]"
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
  const title = e.chapterTitle && !/^(chapter\s*)?\d+$/i.test(e.chapterTitle.trim()) ? e.chapterTitle : null;
  const chapter = title ? `${e.chapterNumber ? `Chapter ${e.chapterNumber} · ` : ""}${title}` : e.chapterNumber ? `Chapter ${e.chapterNumber}` : null;
  return (
    <div className="flex min-w-0 items-center gap-9 rounded-md border border-rule px-7 py-7 sm:px-9">
      <button type="button" onClick={onOpen} aria-label={`Open ${e.title}`} className="hidden shrink-0 transition hover:-translate-y-0.5 sm:block">
        <Cover e={e} className="h-[236px] w-[165px] shadow-[inset_5px_0_0_rgb(0_0_0/0.18),0_20px_34px_rgb(60_40_20/0.22)]" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Continue reading</div>
        <h2 className="m-0 mt-2.5 line-clamp-3 text-[38px] font-semibold leading-[1.06] tracking-[-0.015em] text-ink font-title">{e.title}</h2>
        {e.author && <div className="mt-2 truncate text-[13.5px] text-ink-3">{e.author}</div>}
        {chapter && <div className="mt-3 truncate font-title text-[18px] italic text-ink-2">{chapter}</div>}
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button type="button" onClick={onOpen} className="h-[44px] rounded-full bg-[var(--accent)] px-6 text-[14px] font-medium text-paper hover:brightness-110">
            Resume reading
          </button>
          <div className="min-w-[200px] max-w-[320px] flex-1">
            <div className="flex justify-between gap-3 text-[12px] text-ink-3">
              <span>{Math.round(e.progress * 100)}% of the book</span>
              {e.minutesLeft !== undefined && <span>{e.minutesLeft > 0 ? `${e.minutesLeft} min left in chapter` : "End of chapter"}</span>}
            </div>
            <Progress value={e.progress} className="mt-1.5 h-[3px]" />
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
  const [confirming, setConfirming] = useState(false);
  const remove = () => {
    useLibrary.getState().remove(e.id);
    removeCover(e.id);
  };
  const finder = isMac ? "Show in Finder" : "Show file";
  return (
    <div className="group flex flex-col gap-2.5" onMouseLeave={() => setConfirming(false)}>
      <div className="relative">
        <button type="button" onClick={onOpen} aria-label={`Open ${e.title}`} className="block w-full transition group-hover:-translate-y-0.5">
          <Cover e={e} className="aspect-[2/3] w-full" />
        </button>
        {/* Status badges make way for the actions on hover. */}
        <span className="pointer-events-none absolute right-2 top-2 transition group-focus-within:opacity-0 group-hover:opacity-0">
          {fresh && <span className="rounded-full bg-[#f2ebdf] px-2 py-0.5 text-[10px] font-semibold text-[#7a2a1f]">New</span>}
          {finished && (
            <span className="grid size-[22px] place-items-center rounded-full bg-paper text-[var(--accent)]" title="Finished">
              <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="m5 12 5 5 9-10" />
              </svg>
            </span>
          )}
        </span>
        {/* Two round icon buttons in the corner, each labelled on hover. */}
        <div className="absolute right-2 top-2 flex -translate-y-0.5 gap-1.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          {platform.showFile && e.path && (
            <CoverAction label={finder} onClick={() => platform.showFile!(e.path!)}>
              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </CoverAction>
          )}
          <CoverAction label="Remove from library" danger onClick={() => setConfirming(true)}>
            <IconTrash size={15} />
          </CoverAction>
        </div>
        {confirming && (
          <div
            role="alertdialog"
            aria-label={`Remove ${e.title} from library?`}
            className="absolute inset-x-2 bottom-2 rounded-xl bg-card p-3 text-[12.5px] leading-snug text-ink-2 shadow-[var(--shadow)] ring-1 ring-rule"
          >
            <p className="m-0">
              <strong className="font-semibold text-ink">Remove from library?</strong> The file stays on your {isMac ? "Mac" : "computer"}.
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <button type="button" autoFocus onClick={() => setConfirming(false)} className="h-8 flex-1 rounded-lg bg-paper-2 font-medium text-ink hover:bg-rule">
                Cancel
              </button>
              <button type="button" onClick={remove} className="h-8 flex-1 rounded-lg bg-[#a33a2b] font-semibold text-white hover:brightness-110">
                Remove
              </button>
            </div>
          </div>
        )}
      </div>
      <Progress value={e.progress} />
      <div className="text-[12px] leading-snug text-ink-3">
        <span className="mb-0.5 line-clamp-2 font-title text-[14.5px] font-semibold leading-snug text-ink">{e.title}</span>
        {fresh ? "New" : finished ? "Finished" : `${pct}%`} · {fmt(e) === "pdf" ? `${e.pageCount} pages` : readingTime(e.words)} · {ago(e.openedAt)}
      </div>
    </div>
  );
}

/** A round icon button on a cover, with its name shown below it on hover. */
function CoverAction({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <span className="group/action relative">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`grid size-[30px] place-items-center rounded-full bg-[#f6efe2]/95 shadow-[0_2px_6px_rgb(0_0_0/0.2)] hover:bg-white ${danger ? "text-[#a33a2b]" : "text-[#3a2f23]"}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute right-0 top-[36px] z-10 whitespace-nowrap rounded-md bg-[#3a2f23] px-2 py-1 text-[11.5px] text-[#f6efe2] opacity-0 transition group-hover/action:opacity-100 group-focus-within/action:opacity-100">
        {label}
      </span>
    </span>
  );
}

/** The book's real cover when it has one; otherwise a cover drawn from the title. */
function Cover({ e, className, mini }: { e: LibraryEntry; className: string; mini?: boolean }) {
  const url = useCover(e.id);
  const shape = "rounded-[3px_7px_7px_3px] shadow-[inset_4px_0_0_rgb(0_0_0/0.16),0_6px_14px_rgb(58_47_35/0.16)]";
  if (url)
    return (
      <div className={`${className} ${shape} relative overflow-hidden bg-white after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]`}>
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      </div>
    );
  return (
    <div className={`${className} ${shape} relative flex flex-col justify-end gap-2 overflow-hidden text-left text-[#f6efe2] ${mini ? "p-1" : "p-3.5"}`} style={{ background: coverColor(e.title) }}>
      {!mini && (
        <>
          <span className="absolute left-3 top-2.5 rounded bg-white/15 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.1em]">{BADGE[fmt(e)]}</span>
          <span className="line-clamp-4 text-[16px] font-semibold leading-[1.15] font-title">{e.title}</span>
          {e.author && <span className="truncate text-[10px] opacity-75">{e.author}</span>}
          <span className="h-px w-7 bg-[#f2ebdf]/70" />
        </>
      )}
    </div>
  );
}

function Progress({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-[2px] overflow-hidden bg-rule ${className}`}>
      <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function EmptyShelf({ onOpenFile }: { onOpenFile(): void }) {
  return (
    <div className="pt-10">
      <h1 className="m-0 max-w-[620px] text-[36px] font-semibold leading-tight tracking-tight text-ink font-title">
        Hard-to-read PDFs, turned into books you enjoy reading.
      </h1>
      <p className="mb-0 mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-2">
        Open a textbook and Kenning rebuilds it as clean, reflowable text — with explanations, search and summaries right in the page. Everything stays on this computer.
      </p>
      <button
        type="button"
        onClick={onOpenFile}
        className="mt-8 flex h-72 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-ink-3/50 bg-paper-2/40 text-ink-3 hover:border-[var(--accent)]"
      >
        <IconOpen size={34} className="text-[var(--accent)]" />
        <span className="text-[17px] font-semibold text-ink">Drop a book here, or click to choose one</span>
        <span className="text-[13.5px]">PDF · EPUB · Word · HTML · Markdown · Text</span>
      </button>
    </div>
  );
}
