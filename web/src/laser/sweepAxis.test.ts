import { describe, expect, it } from "vitest";
import { sweepAxisValues } from "./sweepAxis";
import { ALLOWED_PULSE_WIDTHS } from "./pulseWidths";

describe("sweepAxisValues", () => {
  it("interpolates a linear axis from min to max", () => {
    expect(sweepAxisValues("power", 10, 50, 5)).toEqual([10, 20, 30, 40, 50]);
  });

  it("collapses a single-step axis to its min", () => {
    expect(sweepAxisValues("speed", 300, 900, 1)).toEqual([300]);
  });

  it("steps a pulse_width axis through the machine presets, not a ramp", () => {
    // The bug: 2–500 over 16 rows read 2, 35.2, 68.4, … — but the burn
    // used the 16 presets.
    expect(sweepAxisValues("pulse_width", 2, 500, 16)).toEqual([...ALLOWED_PULSE_WIDTHS]);
  });

  it("takes the first N presets in range, like the generator", () => {
    expect(sweepAxisValues("pulse_width", 13, 500, 4)).toEqual([13, 20, 30, 45]);
  });

  it("returns fewer values than steps when the range holds fewer presets", () => {
    expect(sweepAxisValues("pulse_width", 2, 13, 9)).toEqual([2, 4, 6, 9, 13]);
  });

  it("falls back to the nearest preset when none sit in range", () => {
    expect(sweepAxisValues("pulse_width", 101, 149, 3)).toEqual([100]);
  });
});
