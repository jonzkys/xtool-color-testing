import { describe, it, expect } from "vitest";
import { optimalScanAngle } from "./scanangle";
import type { Contour } from "./types";

const rect = (w: number, h: number): Contour => ({
  points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
  closed: true,
});

describe("optimalScanAngle", () => {
  it("scans along the long axis of a tall bar (≈90°)", () => {
    // 5 wide × 100 tall → fewest scan lines when lines run vertically (90°)
    expect(optimalScanAngle([rect(5, 100)])).toBe(90);
  });
  it("scans horizontally for a wide bar (≈0°)", () => {
    expect(optimalScanAngle([rect(100, 5)])).toBe(0);
  });
  it("returns 0 for empty input", () => {
    expect(optimalScanAngle([])).toBe(0);
    expect(optimalScanAngle([{ points: [], closed: true }])).toBe(0);
  });
});
