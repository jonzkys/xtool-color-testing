import { describe, it, expect } from "vitest";
import { renderText, textWidth } from "./textPaths";

describe("textPaths", () => {
  it("renders a digit to >=1 ring of roughly sizeMm height", () => {
    const rings = renderText("0", 4, { x: 0, y: 0 });
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const ys = rings.flat().map((p) => p.y);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(h).toBeGreaterThan(2); // ~cap height of size 4
    expect(h).toBeLessThan(5);
  });
  it("'O' has a counter — at least 2 rings", () => {
    expect(renderText("O", 6, { x: 0, y: 0 }).length).toBeGreaterThanOrEqual(2);
  });
  it("textWidth grows with length and matches the advance sum", () => {
    expect(textWidth("AA", 4)).toBeCloseTo(2 * textWidth("A", 4), 5);
    expect(textWidth("", 4)).toBe(0);
  });
  it("upper-cases input and advances unknown chars", () => {
    expect(renderText("a", 4, { x: 0, y: 0 }).length).toBe(renderText("A", 4, { x: 0, y: 0 }).length);
    expect(textWidth("\t", 4)).toBeGreaterThan(0); // unknown → space advance
  });
});
