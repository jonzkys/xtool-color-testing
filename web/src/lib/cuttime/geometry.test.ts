import { describe, it, expect } from "vitest";
import { ringsBBox, ringsFillArea, ringsPerimeter } from "./geometry";

type Pt = { x: number; y: number };
const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe("ring geometry", () => {
  const band = [rect(0, 0, 30.2, 20.2), rect(0.1, 0.1, 30, 20)]; // 0.1mm kerf band
  const pocket = [rect(0, 0, 0.2, 0.2)];

  it("ringsBBox spans all ring points", () => {
    const b = ringsBBox(band);
    expect(b.w).toBeCloseTo(30.2, 6);
    expect(b.h).toBeCloseTo(20.2, 6);
  });

  it("ringsFillArea = outer minus inner for a band", () => {
    expect(ringsFillArea(band)).toBeCloseTo(30.2 * 20.2 - 30 * 20, 4); // 10.04
  });

  it("ringsFillArea = the loop area for a single-loop pocket", () => {
    expect(ringsFillArea(pocket)).toBeCloseTo(0.04, 6);
  });

  it("ringsPerimeter sums every ring's closed perimeter", () => {
    expect(ringsPerimeter(pocket)).toBeCloseTo(0.8, 6); // 4 * 0.2
  });

  it("empty input is zero, never NaN", () => {
    expect(ringsFillArea([])).toBe(0);
    expect(ringsBBox([])).toEqual({ w: 0, h: 0 });
  });
});
