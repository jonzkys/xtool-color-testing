import { describe, expect, it } from "vitest";
import {
  pointInPolygon,
  findAnchor,
  type Polygon,
} from "./proposeTestMath";
import type { ExposureRow } from "./exposureCorrelations";

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const star: Polygon = [   // concave 5-point star
  [5, 0], [6, 4], [10, 4], [7, 6], [8, 10],
  [5, 7], [2, 10], [3, 6], [0, 4], [4, 4],
];

describe("pointInPolygon", () => {
  it("returns true for a point clearly inside a square", () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
  });
  it("returns false for a point clearly outside", () => {
    expect(pointInPolygon([20, 20], square)).toBe(false);
  });
  it("returns false for a point above the square", () => {
    expect(pointInPolygon([5, 15], square)).toBe(false);
  });
  it("handles concave polygons (star shape)", () => {
    expect(pointInPolygon([5, 5], star)).toBe(true);
    // Inside the bounding box but in a concave notch:
    expect(pointInPolygon([1, 8], star)).toBe(false);
  });
  it("handles polygons with < 3 vertices as always-outside", () => {
    expect(pointInPolygon([1, 1], [])).toBe(false);
    expect(pointInPolygon([1, 1], [[0, 0], [2, 2]])).toBe(false);
  });
});

function makeRow(id: number, x: number, y: number): ExposureRow {
  return {
    id,
    hex: "#000000",
    lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: x,
      line_spacing_mm: 0,
      pulse_energy_index: 0,
      pulse_intensity_index: y,
      total_exposure_index: 0,
      ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      formula_version: 3,
      density_model: "lpc",
      power_model: "controller_percent",
    },
  };
}

describe("findAnchor", () => {
  it("returns null for empty polygon", () => {
    expect(findAnchor(
      [],
      [makeRow(1, 5, 5)],
      "pulse_spacing_mm",
      "pulse_intensity_index",
    )).toBe(null);
  });
  it("returns null when no rows are inside", () => {
    expect(findAnchor(
      square,
      [makeRow(1, 20, 20)],
      "pulse_spacing_mm",
      "pulse_intensity_index",
    )).toBe(null);
  });
  it("returns the inside row closest to the polygon centroid", () => {
    // Centroid of the square is (5, 5). Of {(2,2), (4,4), (8,8)} → (4,4)
    // is closest.
    const rows = [makeRow(1, 2, 2), makeRow(2, 4, 4), makeRow(3, 8, 8)];
    const anchor = findAnchor(
      square, rows, "pulse_spacing_mm", "pulse_intensity_index",
    );
    expect(anchor?.id).toBe(2);
  });
  it("ignores rows outside polygon", () => {
    const rows = [makeRow(1, 20, 20), makeRow(2, 5, 5)];
    const anchor = findAnchor(
      square, rows, "pulse_spacing_mm", "pulse_intensity_index",
    );
    expect(anchor?.id).toBe(2);
  });
});
