import { describe, expect, it } from "vitest";
import { ARUCO_CORNER_NAMES, formatMissingCorners } from "./captureWarnings";

describe("ARUCO_CORNER_NAMES", () => {
  it("maps each known ArUco ID to a corner name", () => {
    expect(ARUCO_CORNER_NAMES[1]).toBe("top-right");
    expect(ARUCO_CORNER_NAMES[2]).toBe("bottom-left");
    expect(ARUCO_CORNER_NAMES[3]).toBe("bottom-right");
  });
});

describe("formatMissingCorners", () => {
  it("returns empty string for empty list", () => {
    expect(formatMissingCorners([])).toBe("");
  });

  it("returns the bare name for a single ID", () => {
    expect(formatMissingCorners([1])).toBe("top-right");
    expect(formatMissingCorners([2])).toBe("bottom-left");
  });

  it("uses 'and' for two IDs", () => {
    expect(formatMissingCorners([1, 2])).toBe("top-right and bottom-left");
  });

  it("uses Oxford comma + 'and' for three IDs", () => {
    expect(formatMissingCorners([1, 2, 3]))
      .toBe("top-right, bottom-left, and bottom-right");
  });

  it("falls back to 'marker N' for unknown IDs", () => {
    expect(formatMissingCorners([99])).toBe("marker 99");
  });
});
