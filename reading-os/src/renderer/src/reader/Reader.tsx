import { useEffect, useMemo, useRef, useState } from "react";
import { useCards } from "../ai";
import { CommandPalette } from "../command/CommandPalette";
import { platform } from "../platform";
import { useNotes } from "../state/notes";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { IconBook, IconLibrary, IconPage, IconSearch, IconToc, IconType } from "../ui/icons";
import { CleanView } from "./CleanView";
import { Hovercards } from "./Hovercards";
import { GlossarySheet } from "./GlossarySheet";
import { TocSheet, TypePanel, ZoomOverlay } from "./Overlays";
import { PageView } from "./PageView";
import { RecapPanel } from "./RecapPanel";
import { openRecap } from "../state/recap";
import { SelectionMenu } from "./SelectionMenu";

const WPM = 230;
const isMac = navigator.platform.toLowerCase().includes("mac");

export function Reader({ onOpenFile, onLibrary }: { onOpenFile(): void; onLibrary(): void }) {
  // No subscription to the reading position here: the title and footer follow
  // it on their own, so scrolling never re-renders the book.
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const view = useReader((s) => s.view);
  const overlay = useReader((s) => s.overlay);
  const { setOverlay, setView, jumpTo } = useReader.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [chrome, setChrome] = useState(true);

  useEffect(() => {
    void useCards.getState().load(book.id);
  }, [book.id]);

  // Bars hide while reading forward and come back on scroll up or near the top.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastY = el.scrollTop;
    let lastPing = 0;
    const onScroll = () => {
      const y = el.scrollTop;
      if (y < 80 || y < lastY - 8) setChrome(true);
      else if (y > lastY + 8) setChrome(false);
      lastY = y;
      // Tell the background worker to hold off while scrolling (see main).
      const now = performance.now();
      if (now - lastPing > 400) {
        lastPing = now;
        platform.readerActivity();
      }
    };
    const onMove = (e: MouseEvent) => e.clientY < 64 && setChrome(true);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // Keyboard: ⌘K palette, T contents, G glossary, R recap, V view, [ ] chapters, ⌘+/⌘- size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay(useReader.getState().overlay === "palette" ? null : "palette");
        return;
      }
      if (e.key === "Escape" && useReader.getState().overlay) {
        setOverlay(null);
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        useSettings.getState().set({ size: Math.min(28, useSettings.getState().size + 1) });
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        useSettings.getState().set({ size: Math.max(14, useSettings.getState().size - 1) });
        return;
      }
      if (typing || mod || e.altKey || useReader.getState().overlay) return;
      // preventDefault keeps the letter out of the filter box the overlay focuses.
      if (e.key === "t") {
        e.preventDefault();
        setOverlay("toc");
      } else if (e.key === "g") {
        e.preventDefault();
        setOverlay("glossary");
      } else if (e.key === "r") {
        e.preventDefault();
        openRecap();
      } else if (e.key === "v") setView(useReader.getState().view === "clean" ? "page" : "clean");
      else if (e.key === "]" || e.key === "[") {
        const cur = ix.byId.get(useReader.getState().currentBlock ?? "") ?? 0;
        const ch = book.blocks[cur]?.chapter ?? 0;
        // "[" goes to the start of this chapter, or the previous one if already there.
        const next = e.key === "]" ? ch + 1 : cur > book.chapters[ch].start + 1 ? ch : ch - 1;
        const target = book.chapters[Math.max(0, Math.min(book.chapters.length - 1, next))];
        const b = target && book.blocks[target.start];
        if (b) jumpTo({ blockId: b.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book, ix, setOverlay, setView, jumpTo]);

  // Keep position when switching between clean text and original pages.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const cur = useReader.getState().currentBlock;
    if (cur) jumpTo({ blockId: cur });
  }, [view, jumpTo]);

  const showChrome = chrome || !!overlay;
  return (
    <div className="relative h-full">
      <header
        className={`fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-1 border-b border-rule/70 bg-paper px-3 font-ui transition-transform duration-300 [-webkit-app-region:drag] ${showChrome ? "translate-y-0" : "-translate-y-full"} ${isMac && window.readingOS ? "pl-20" : ""}`}
      >
        <BarButton label="Library" onClick={onLibrary}>
          <IconLibrary />
        </BarButton>
        <BarButton label="Contents (T)" onClick={() => setOverlay("toc")}>
          <IconToc />
        </BarButton>
        <ReaderTitle />
        <button
          type="button"
          onClick={() => setOverlay("palette")}
          className="mr-1 hidden items-center gap-2 rounded-lg bg-paper-2 px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink sm:flex [-webkit-app-region:no-drag]"
        >
          <IconSearch size={14} /> Search or ask
          <kbd className="rounded border border-rule px-1 text-[10.5px]">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <div className="flex rounded-lg bg-paper-2 p-0.5 [-webkit-app-region:no-drag]" role="group" aria-label="View">
          <ViewButton active={view === "clean"} label="Clean text" onClick={() => setView("clean")}>
            <IconBook size={16} />
          </ViewButton>
          <ViewButton active={view === "page"} label="Original pages" onClick={() => setView("page")}>
            <IconPage size={16} />
          </ViewButton>
        </div>
        <BarButton label="Reading settings" onClick={() => setOverlay(overlay === "type" ? null : "type")}>
          <IconType />
        </BarButton>
      </header>

      <div ref={scrollRef} className="scroll-quiet h-full overflow-y-auto" data-testid="reader-scroll">
        {view === "clean" ? <CleanView scrollRef={scrollRef} /> : <PageView scrollRef={scrollRef} />}
      </div>

      <ReaderFooter visible={showChrome} />

      <SelectionMenu scrollRoot={scrollRef} />
      <Hovercards root={scrollRef} />
      {overlay === "toc" && <TocSheet />}
      {overlay === "glossary" && <GlossarySheet />}
      {overlay === "type" && <TypePanel />}
      {overlay === "recap" && <RecapPanel />}
      {overlay === "palette" && <CommandPalette onOpenFile={onOpenFile} onLibrary={onLibrary} />}
      <ZoomOverlay />
    </div>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-paper-2 hover:text-ink [-webkit-app-region:no-drag]"
    >
      {children}
    </button>
  );
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid h-7 w-8 place-items-center rounded-md ${active ? "bg-card text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/** Where the reader is, from the current block: chapter, progress, time left. */
function useProgress() {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const currentBlock = useReader((s) => s.currentBlock);
  return useMemo(() => {
    const i = currentBlock ? ix.byId.get(currentBlock) ?? 0 : 0;
    const b = book.blocks[i];
    const ch = book.chapters[b?.chapter ?? 0];
    const chEnd = Math.min(ch?.end ?? book.blocks.length, book.blocks.length);
    const wordsLeft = (chEnd < book.blocks.length ? ix.wordsBefore[chEnd] : ix.totalWords) - ix.wordsBefore[i];
    return {
      chapter: ch,
      percent: ix.totalWords ? Math.round((ix.wordsBefore[i] / ix.totalWords) * 100) : 0,
      minutesLeft: Math.max(0, Math.round(wordsLeft / WPM)),
      page: b ? book.pages[b.page]?.label : "",
    };
  }, [currentBlock, book, ix]);
}

function ReaderTitle() {
  const title = useReader((s) => s.book!.title);
  const { chapter } = useProgress();
  // Front matter is often "chapter 0" named after the book itself: don't repeat it.
  const same = chapter?.title && chapter.title.trim().toLowerCase() === title.trim().toLowerCase();
  return (
    <div className="mx-2 min-w-0 flex-1 truncate text-center text-[12.5px]">
      <span className="font-semibold text-ink">{title}</span>
      {chapter?.title && !same && (
        <span className="text-ink-3">
          {" "}
          · {chapter.number ? `${chapter.number}. ` : ""}
          {chapter.title}
        </span>
      )}
    </div>
  );
}

function ReaderFooter({ visible }: { visible: boolean }) {
  const info = useProgress();
  return (
    <footer
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 font-ui transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <div className="flex items-center justify-between px-5 pb-2 text-[11.5px] tabular-nums text-ink-3">
        <span>
          {info.minutesLeft > 0 ? `${info.minutesLeft} min left in chapter` : "End of chapter"}
          {info.page ? ` · page ${info.page}` : ""}
        </span>
        <span>
          <IndexProgress />
          {info.percent}%
        </span>
      </div>
      <div className="h-[3px] bg-rule/60">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${info.percent}%` }} />
      </div>
    </footer>
  );
}

/** "Preparing search 40% ·" while the book is being embedded in the background. */
function IndexProgress() {
  const st = useNotes((n) => n.status);
  if (!st || st.state !== "embedding" || !st.chunks) return null;
  return <span className="mr-2">Preparing search {Math.round((st.embedded / st.chunks) * 100)}% ·</span>;
}
