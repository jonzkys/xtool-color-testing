import { describe, it, expect } from "vitest";
import { toProfile, fromProfile } from "./textRegVocab";
import type { TextRegParamsBody } from "../types";

const tr: TextRegParamsBody = {
  power: 50, speed: 1000, density: 100, repeat: 2,
  pulse_width: 200, mopa_frequency: 60, processing_light_source: "red",
};

describe("textRegVocab", () => {
  it("renames to profile vocab", () => {
    expect(toProfile(tr)).toEqual({
      power: 50, speed: 1000, density: 100, passes: 2,
      pulse_width: 200, frequency: 60, laser: "red",
    });
  });
  it("round-trips to identity", () => {
    expect(fromProfile(toProfile(tr))).toEqual(tr);
  });
});
