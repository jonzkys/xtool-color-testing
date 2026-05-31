import { describe, it, expect } from "vitest";
import { descentDepthMm } from "./depth";

describe("descentDepthMm", () => {
  it("total depth = (layers / everyN) * byMm", () => {
    expect(descentDepthMm(256, 10, 0.08)).toBeCloseTo(2.048, 3);
    expect(descentDepthMm(100, 1, 0.01)).toBeCloseTo(1.0, 3);
  });
  it("returns 0 for a non-positive interval (no divide-by-zero)", () => {
    expect(descentDepthMm(256, 0, 0.08)).toBe(0);
    expect(descentDepthMm(256, -1, 0.08)).toBe(0);
  });
});
