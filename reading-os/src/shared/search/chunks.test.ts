import { describe, expect, it } from "vitest";
import { ftsQuery, fuse } from "./chunks.ts";

describe("ftsQuery", () => {
  it("quotes words and adds a prefix match to the last one", () => {
    expect(ftsQuery("Trigeminal neuralg")).toBe('"trigeminal" "neuralg"*');
    expect(ftsQuery("pain OR (drop)", "or")).toBe('"pain" OR "drop"*');
    expect(ftsQuery("What are the red flags for secondary headaches?")).toBe('"red" "flags" "secondary" "headaches"*');
  });
  it("neutralizes FTS syntax", () => {
    expect(ftsQuery('"NEAR(a b)" col:x -y *')).toBe('"near" "col"*');
    expect(ftsQuery("   ")).toBeNull();
  });
});

describe("fuse", () => {
  it("ranks items found by both lists first", () => {
    const s = fuse([
      [
        { key: 1, rank: 0 },
        { key: 2, rank: 1 },
      ],
      [
        { key: 2, rank: 0 },
        { key: 3, rank: 1 },
      ],
    ]);
    const order = [...s.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    expect(order[0]).toBe(2);
  });
});
