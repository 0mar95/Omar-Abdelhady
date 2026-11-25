import { describe, expect, it } from "vitest";
import { clauses, spoken, voiceScore } from "./speech";

describe("spoken", () => {
  it("drops figure and table pointers", () => {
    expect(spoken("This is the pink esthetic score (Fig 1-2). Then (see Table 3) more.")).toBe("This is the pink esthetic score. Then more.");
  });
  it("says abbreviations and symbols as words", () => {
    expect(spoken("Common findings, e.g., tenderness, affect 70% of patients aged 20–40.")).toBe("Common findings, for example, tenderness, affect 70 percent of patients aged 20 to 40.");
    expect(spoken("Meijer et al proposed it, as Fig. 3 shows, at 37 °C ± 2.")).toBe("Meijer and colleagues proposed it, as Figure 3 shows, at 37 degrees Celsius plus or minus 2.");
    expect(spoken("Migraine vs tension-type")).toBe("Migraine versus tension-type");
  });
});

describe("clauses", () => {
  it("keeps short sentences whole", () => {
    expect(clauses("A short sentence.")).toEqual(["A short sentence."]);
  });
  it("splits a long sentence at a clause near its middle, as substrings", () => {
    const s =
      "Tension-type headache is the most prevalent headache disorder, with a lifetime prevalence that may exceed seventy percent in some populations; it is typically bilateral, pressing or tightening in quality, and of mild to moderate intensity.";
    const parts = clauses(s, 140);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(s.includes(p)).toBe(true);
    expect(parts.join(" ")).toBe(s);
  });
});

describe("voiceScore", () => {
  it("hides novelty voices and prefers premium ones", () => {
    expect(voiceScore({ name: "Zarvox", lang: "en-US" })).toBeLessThan(0);
    expect(voiceScore({ name: "Bad News", lang: "en-US" })).toBeLessThan(0);
    expect(voiceScore({ name: "Ava (Premium)", lang: "en-US" })).toBeGreaterThan(voiceScore({ name: "Samantha", lang: "en-US" }));
    expect(voiceScore({ name: "Samantha", lang: "en-US" })).toBeGreaterThan(voiceScore({ name: "Rishi", lang: "en-IN" }));
  });
});
