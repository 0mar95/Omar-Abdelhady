// The voice engine's own process. Making speech is heavy, steady work: kept
// out of the app's main process (which relays the window's messages) and run
// at a lower priority, so scrolling and typing never wait on it.

import { setPriority } from "node:os";
import * as voice from "./voice";

type Msg =
  | { type: "configure"; dir: string }
  | { type: "status"; id: number }
  | { type: "prepare"; id: number }
  | { type: "speak"; id: number; text: string; voice: string; speed: number }
  | { type: "cancel" };

const port = process.parentPort;

try {
  setPriority(process.pid, 10);
} catch {
  /* not allowed here: normal priority */
}

port.on("message", (e: { data: Msg }) => {
  const m = e.data;
  switch (m.type) {
    case "configure":
      voice.configure(m.dir);
      break;
    case "status":
      port.postMessage({ id: m.id, result: voice.status() });
      break;
    case "prepare":
      void voice.prepare((s) => port.postMessage({ type: "status", status: s })).then((r) => port.postMessage({ id: m.id, result: r }));
      break;
    case "speak":
      voice.speak(m.text, m.voice, m.speed).then(
        (r) => port.postMessage({ id: m.id, result: r }),
        (err: unknown) => port.postMessage({ id: m.id, error: String((err as Error)?.message ?? err) }),
      );
      break;
    case "cancel":
      voice.cancel();
      break;
  }
});
