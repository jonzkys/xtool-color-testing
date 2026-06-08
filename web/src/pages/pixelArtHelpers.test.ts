import { describe, it, expect } from "vitest";

import { paletteEntryToBaseParams } from "./pixelArtHelpers";
import type { PaletteEntry } from "../types";

function entry(params: Record<string, string | number>): PaletteEntry {
  return {
    id: 1,
    machine_id: "F2Ultra",
    test_id: null,
    material_id: 1,
    x_value: null,
    y_value: null,
    hex: "#aabbcc",
    lab: [50, 0, 0],
    params,
    sigma: 0,
    source: "averaged",
    source_result_id: null,
    notes: "",
    favorited: false,
    created_at: "2026-06-08T00:00:00Z",
  };
}

describe("paletteEntryToBaseParams", () => {
  // Averaged palette entries (source: "averaged") carry fractional means.
  // The backend BaseParams schema types speed/frequency/density/passes/
  // pulse_width as int and 422s on a fractional part, so the layer spec must
  // materialise them as whole numbers. Regression for the pixel-art 422.
  it("rounds fractional integer-typed params to whole numbers", () => {
    const bp = paletteEntryToBaseParams(
      entry({
        power: 50.5,
        speed: 1373.993354968488,
        frequency: 249.6384606696655,
        density: 200.5,
        passes: 2.4,
        pulse_width: 199.6,
        scan_angle: 90.2,
        laser: "red",
      }),
    );

    expect(bp.speed).toBe(1374);
    expect(bp.frequency).toBe(250);
    expect(bp.density).toBe(201); // Math.round(200.5) === 201
    expect(bp.passes).toBe(2);
    expect(bp.pulse_width).toBe(200);

    for (const k of [
      "speed",
      "frequency",
      "density",
      "passes",
      "pulse_width",
    ] as const) {
      expect(Number.isInteger(bp[k])).toBe(true);
    }

    // Float-typed fields stay untouched (the schema accepts these as float).
    expect(bp.power).toBeCloseTo(50.5);
    expect(bp.scan_angle).toBeCloseTo(90.2);
  });

  it("passes through already-integer params unchanged", () => {
    const bp = paletteEntryToBaseParams(
      entry({ speed: 1000, frequency: 65, density: 2000, passes: 2, pulse_width: 200 }),
    );
    expect(bp.speed).toBe(1000);
    expect(bp.frequency).toBe(65);
    expect(bp.passes).toBe(2);
  });
});
