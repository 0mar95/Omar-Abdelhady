import { describe, expect, it } from "vitest";
import { readingOrder, type PageLayout } from "./layout.ts";

const item = (id: string, x0: number, y0: number, x1: number, y1: number) => ({ id, rect: { x0, y0, x1, y1 } });

describe("readingOrder", () => {
  const twoCol: PageLayout = { columns: [{ x0: 70, x1: 253 }, { x0: 267, x1: 450 }], gutter: 260 };

  it("reads the left column before the right one", () => {
    const items = [item("R1", 267, 100, 450, 110), item("L1", 70, 100, 253, 110), item("L2", 70, 120, 253, 130), item("R2", 267, 120, 450, 130)];
    expect(readingOrder(items, twoCol).map((i) => i.id)).toEqual(["L1", "L2", "R1", "R2"]);
  });

  it("lets full-width items split the page into bands", () => {
    const items = [
      item("fig", 70, 70, 450, 240),
      item("L-below", 70, 260, 253, 270),
      item("R-below", 267, 260, 450, 270),
      item("L-above", 70, 40, 253, 50),
    ];
    expect(readingOrder(items, twoCol).map((i) => i.id)).toEqual(["L-above", "fig", "L-below", "R-below"]);
  });
});
