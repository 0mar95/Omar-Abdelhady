import { useCallback, useEffect, useState } from "react";
import { BOOK_EXTENSIONS } from "../../shared/formats";
import { CommandPalette } from "./command/CommandPalette";
import { Library } from "./library/Library";
import { platform } from "./platform";
import { Reader } from "./reader/Reader";
import { useLibrary } from "./state/library";
import { wireBackground } from "./state/notes";
import { useReader } from "./state/reader";
import { useSettings } from "./state/settings";

export function App() {
  const status = useReader((s) => s.status);
  const theme = useSettings((s) => s.theme);
  const loaded = useSettings((s) => s.loaded);
  const overlay = useReader((s) => s.overlay);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void useSettings.getState().load();
    void useLibrary.getState().load();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (loaded) wireBackground();
  }, [loaded]);

  const openFile = useCallback(async () => {
    const file = await platform.pickPdf();
    if (file) await useReader.getState().openFile(file);
  }, []);
  const toLibrary = useCallback(() => useReader.getState().close(), []);

  // Menu actions from the desktop app.
  useEffect(
    () =>
      platform.onMenu((action) => {
        const r = useReader.getState();
        if (action === "open") void openFile();
        else if (action === "library") toLibrary();
        else if (action === "palette") r.setOverlay(r.overlay === "palette" ? null : "palette");
        else if (action === "toggle-view" && r.book) r.setView(r.view === "clean" ? "page" : "clean");
      }),
    [openFile, toLibrary],
  );

  // ⌘K and ⌘O also work on the library screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openFile();
      }
      if (useReader.getState().status !== "ready" && mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useReader.getState().setOverlay("palette");
      }
      if (e.key === "Escape" && useReader.getState().status !== "ready") useReader.getState().setOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile]);

  // Drop a book anywhere to open it.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => BOOK_EXTENSIONS.includes(x.name.toLowerCase().split(".").pop() ?? ""));
      if (f) await useReader.getState().openFile(await platform.fileFromDrop(f));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  if (!loaded) return null;
  return (
    <div className="h-full">
      {status === "ready" ? (
        <Reader onOpenFile={openFile} onLibrary={toLibrary} />
      ) : status === "loading" ? (
        <Loading />
      ) : (
        <>
          <Library onOpenFile={openFile} />
          {status === "error" && <ErrorToast />}
          {overlay === "palette" && <CommandPalette onOpenFile={openFile} onLibrary={toLibrary} />}
        </>
      )}
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-[70] grid place-items-center rounded-3xl border-2 border-dashed border-[var(--accent)] bg-paper/80 font-ui text-[18px] font-medium text-ink backdrop-blur-sm">
          Drop to open
        </div>
      )}
    </div>
  );
}

function Loading() {
  const p = useReader((s) => s.progress);
  const pct = p ? (p.phase === "analyzing" ? 100 : Math.round((p.done / Math.max(1, p.total)) * 100)) : 0;
  return (
    <div className="grid h-full place-items-center font-ui">
      <div className="w-80 text-center">
        <div className="text-[15px] font-medium text-ink">{p?.phase === "analyzing" ? "Rebuilding the book…" : "Reading pages…"}</div>
        <div className="mt-1 text-[12.5px] text-ink-3">
          {p?.phase === "reading" && p.total > 1 ? `${p.done} of ${p.total} pages` : "Finding chapters, figures, tables and references"}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-rule">
          <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 text-[11.5px] text-ink-3">Only the first open takes a moment; after that it's instant.</div>
      </div>
    </div>
  );
}

function ErrorToast() {
  const error = useReader((s) => s.error);
  return (
    <div role="alert" className="fixed bottom-6 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-xl bg-card px-4 py-3 font-ui text-[13px] text-ink shadow-[var(--shadow)] ring-1 ring-rule">
      {error}
    </div>
  );
}
