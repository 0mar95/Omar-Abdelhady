// The Listen controls: a small bar at the bottom while the book is read aloud,
// with the natural voices to choose from (and their one-time download).

import { useEffect, useRef, useState } from "react";
import { NATURAL_VOICES, useListen } from "../state/listen";
import { IconPause, IconPlay, IconSkipBack, IconSkipFwd, IconX } from "../ui/icons";

const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];
const isMac = /Mac/i.test(navigator.platform);

export function ListenBar() {
  const s = useListen();
  const [picking, setPicking] = useState(false);
  if (!s.active) return null;
  const line = s.queue[s.at];
  const loading = s.natural?.state === "loading";
  const needed = s.natural && (s.natural.state === "missing" || s.natural.state === "error");
  if (needed || loading)
    return (
      <div className="listen-bar get-voices font-ui" role="region" aria-label="Listen">
        <span className="pitch">
          {s.natural?.state === "error" ? s.natural.message : `Kenning reads with lifelike voices that run on this ${isMac ? "Mac" : "computer"}, private and offline.`}
        </span>
        <button type="button" className="get" disabled={loading} onClick={() => void s.getNatural()}>
          {loading ? `Downloading… ${Math.round((s.natural as { progress: number }).progress * 100)}%` : "Download voices · 90 MB"}
        </button>
        <button type="button" aria-label="Close" title="Close" onClick={() => s.stop()}>
          <IconX size={15} />
        </button>
      </div>
    );
  const status = loading
    ? `Getting natural voices… ${Math.round((s.natural as { progress: number }).progress * 100)}%`
    : s.waiting
      ? "Preparing the voice…"
      : (s.error ?? (line ? `${s.at + 1} / ${s.queue.length}` : ""));
  return (
    <div className="listen-bar font-ui" role="region" aria-label="Listen">
      <button type="button" aria-label="Previous sentence" title="Previous sentence" onClick={() => s.skip(-1)}>
        <IconSkipBack size={16} />
      </button>
      <button type="button" className="play" aria-label={s.playing ? "Pause" : "Play"} title={s.playing ? "Pause (L)" : "Play (L)"} onClick={() => s.toggle()}>
        {s.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      </button>
      <button type="button" aria-label="Next sentence" title="Next sentence" onClick={() => s.skip(1)}>
        <IconSkipFwd size={16} />
      </button>
      {s.following || !s.playing ? (
        <span className={`where ${s.waiting || loading ? "busy" : ""}`}>{status}</span>
      ) : (
        <button type="button" className="back-to-voice" onClick={() => s.follow()} title="Scroll back to the sentence being read">
          ↓ Back to the voice
        </button>
      )}
      <select aria-label="Speed" value={s.rate} onChange={(e) => s.setRate(Number(e.target.value))}>
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
      <div className="relative">
        <button type="button" className="voice-btn" aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          {voiceLabel()}
        </button>
        {picking && <VoicePicker onClose={() => setPicking(false)} />}
      </div>
      <button type="button" aria-label="Stop" title="Stop" onClick={() => s.stop()}>
        <IconX size={15} />
      </button>
    </div>
  );
}

/** Name of the voice that will read. */
function voiceLabel(): string {
  const id = useListen.getState().voice?.slice("natural:".length) ?? "af_heart";
  return NATURAL_VOICES.find((v) => v.id === id)?.name ?? "Heart";
}

function VoicePicker({ onClose }: { onClose(): void }) {
  const s = useListen();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const current = s.voice ?? "natural:af_heart";
  return (
    <div ref={ref} role="menu" aria-label="Voices" className="voice-menu">
      <h4>Voices</h4>
      {NATURAL_VOICES.map((v) => {
        const id = `natural:${v.id}`;
        const on = current === id;
        return (
          <button
            key={v.id}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            className={on ? "on" : ""}
            onClick={() => {
              s.setVoice(id);
              onClose();
            }}
          >
            <span className="name">{v.name}</span>
            <span className="note">{v.note}</span>
          </button>
        );
      })}
    </div>
  );
}
