import { describe, expect, it } from "vitest";
import { fromLegacy, nextLabel, retrievability, review } from "./fsrs";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);

describe("fsrs", () => {
  it("schedules a new card by how well it was known", () => {
    expect(review(undefined, 1, t0).due - t0).toBe(10 * 60_000);
    const hard = review(undefined, 2, t0).due - t0;
    const good = review(undefined, 3, t0).due - t0;
    const easy = review(undefined, 4, t0).due - t0;
    expect(good).toBe(3 * DAY);
    expect(hard).toBeLessThan(good);
    expect(easy).toBeGreaterThan(good);
  });

  it("spaces reviews further apart each time a card is remembered", () => {
    let c = review(undefined, 3, t0);
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const now = c.due;
      c = review(c, 3, now);
      gaps.push(Math.round((c.due - now) / DAY));
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    expect(gaps[0]).toBeGreaterThanOrEqual(7);
  });

  it("a lapse shrinks stability and raises difficulty", () => {
    let c = review(undefined, 3, t0);
    c = review(c, 3, c.due);
    const forgot = review(c, 1, c.due);
    expect(forgot.s).toBeLessThan(c.s);
    expect(forgot.d).toBeGreaterThan(c.d);
    expect(forgot.lapses).toBe(1);
    expect(forgot.due - c.due).toBe(10 * 60_000);
  });

  it("recall falls to 90% at the stability", () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 3);
    expect(retrievability(0, 10)).toBe(1);
  });

  it("labels and converts old reviews", () => {
    expect(nextLabel(undefined, 1, t0)).toBe("10 min");
    expect(nextLabel(undefined, 3, t0)).toBe("3 days");
    const c = fromLegacy({ due: t0, interval: 8, right: 3, wrong: 0, last: "right" });
    expect(c.s).toBe(8);
    expect(c.reps).toBe(3);
  });
});
