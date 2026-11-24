// The Listen controls: a small bar at the bottom while the book is read aloud.

import { useListen } from "../state/listen";
import { IconPause, IconPlay, IconSkipBack, IconSkipFwd, IconX } from "../ui/icons";

const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];

export function ListenBar() {
  const s = useListen();
  if (!s.active) return null;
  const line = s.queue[s.at];
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
      <span className="where">{s.error ?? (line ? `${s.at + 1} / ${s.queue.length}` : "")}</span>
      <select aria-label="Speed" value={s.rate} onChange={(e) => s.setRate(Number(e.target.value))}>
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
      {s.voices.length > 1 && (
        <select aria-label="Voice" className="voice" value={s.voice ?? ""} onChange={(e) => s.setVoice(e.target.value)}>
          <option value="">Default voice</option>
          {s.voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" aria-label="Stop" title="Stop" onClick={() => s.stop()}>
        <IconX size={15} />
      </button>
    </div>
  );
}
