// The Listen controls: a small bar at the bottom while the book is read aloud,
// with a voice picker that offers the natural voices first.

import { useEffect, useRef, useState } from "react";
import { NATURAL_VOICES, useListen } from "../state/listen";
import { IconPause, IconPlay, IconSkipBack, IconSkipFwd, IconX } from "../ui/icons";
import { platform } from "../platform";

const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];
const isMac = /Mac/i.test(navigator.platform);

export function ListenBar() {
  const s = useListen();
  const [picking, setPicking] = useState(false);
  if (!s.active) return null;
  const line = s.queue[s.at];
  const loading = s.natural?.state === "loading";
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
      <span className={`where ${s.waiting || loading ? "busy" : ""}`}>{status}</span>
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
  const { voice, natural, voices } = useListen.getState();
  const naturalOk = natural && natural.state !== "missing" && natural.state !== "error";
  if (naturalOk && (!voice || voice.startsWith("natural:"))) {
    const id = voice?.slice(8) ?? "af_heart";
    return NATURAL_VOICES.find((v) => v.id === id)?.name ?? "Natural";
  }
  const sys = voices.find((v) => `system:${v.voiceURI}` === voice) ?? voices[0];
  return sys ? cleanName(sys.name) : "Voice";
}

const cleanName = (n: string) => n.replace(/\s*\((?:English|en)[^)]*\)/i, "").replace(/^Microsoft\s+/, "");

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
  const current = s.voice;
  const n = s.natural;
  const naturalOk = n && n.state !== "missing" && n.state !== "error";
  const pick = (id: string) => {
    s.setVoice(id);
    onClose();
  };
  return (
    <div ref={ref} role="menu" aria-label="Voices" className="voice-menu">
      {platform.voices && (
        <section>
          <h4>Natural voices</h4>
          {naturalOk ? (
            NATURAL_VOICES.map((v) => {
              const id = `natural:${v.id}`;
              const on = current === id || (!current?.startsWith("natural:") && !current?.startsWith("system:") && v.id === "af_heart");
              return (
                <button key={v.id} type="button" role="menuitemradio" aria-checked={on} className={on ? "on" : ""} onClick={() => pick(id)}>
                  <span className="name">{v.name}</span>
                  <span className="note">{v.note}</span>
                </button>
              );
            })
          ) : (
            <div className="offer">
              <p>Lifelike voices that run on this {isMac ? "Mac" : "computer"} — private and offline once downloaded.</p>
              {n?.state === "error" && <p className="err">{n.message}</p>}
              <button type="button" className="get" disabled={n?.state === "loading"} onClick={() => void s.getNatural()}>
                {n?.state === "loading" ? `Downloading… ${Math.round(n.progress * 100)}%` : "Download natural voices · 90 MB"}
              </button>
            </div>
          )}
        </section>
      )}
      <section>
        <h4>{isMac ? "This Mac's voices" : "System voices"}</h4>
        {s.voices.slice(0, 8).map((v) => {
          const id = `system:${v.voiceURI}`;
          return (
            <button key={v.voiceURI} type="button" role="menuitemradio" aria-checked={current === id} className={current === id ? "on" : ""} onClick={() => pick(id)}>
              <span className="name">{cleanName(v.name)}</span>
              <span className="note">{v.lang}</span>
            </button>
          );
        })}
        {!s.voices.length && <p className="tip">No system voices found.</p>}
        {isMac && (
          <p className="tip">Better ones: System Settings → Accessibility → Spoken Content → System voice → Manage Voices, then pick a “Premium” voice.</p>
        )}
      </section>
    </div>
  );
}
