import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  ExposureHelpSchematic,
  EXPOSURE_SCHEMATIC_IDS,
} from "./ExposureHelpSchematic";

describe("ExposureHelpSchematic", () => {
  it("exports five distinct schematic ids", () => {
    expect(new Set(EXPOSURE_SCHEMATIC_IDS).size).toBe(5);
  });

  for (const id of [
    "dot_pitch",
    "line_pitch",
    "pulse_shape",
    "accumulation",
    "combination",
  ] as const) {
    it(`renders the "${id}" family with a 140x80 viewBox`, () => {
      const { container } = render(<ExposureHelpSchematic schematic={id} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 140 80");
      expect(svg?.getAttribute("aria-hidden")).not.toBeNull();
    });
  }
});
