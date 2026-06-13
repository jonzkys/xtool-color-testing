import { describe, it, expect } from "vitest";
import { buildSpiralSvg } from "./svgExport";
import type { GeneratedPath } from "./types";

function arm(points: { x: number; y: number }[]): GeneratedPath {
  return {
    sourceObjectId: "s",
    generatedClass: "spiral",
    groupName: "CUT_08_SPIRAL",
    layerStart: 0,
    layerEnd: 1,
    widthMultiplier: 1,
    offsetMm: 0.8,
    sideMode: "outside",
    operationOrder: 0,
    enabled: true,
    rings: [points],
  };
}

describe("buildSpiralSvg", () => {
  it("emits an svg with a mm viewBox and one path per arm", () => {
    const svg = buildSpiralSvg([
      arm([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }]),
      arm([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }]),
    ]);
    expect(svg).toContain("<svg");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // bbox 0..10 x 0..8 plus 1mm pad each side → 12 x 10
    expect(svg).toContain('viewBox="-1 -1 12 10"');
    expect(svg).toContain('width="12mm"');
    expect(svg).toContain('height="10mm"');
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    expect(svg).toContain('fill="none"');
  });

  it("returns empty string when there is nothing drawable", () => {
    expect(buildSpiralSvg([])).toBe("");
    expect(buildSpiralSvg([arm([{ x: 0, y: 0 }])])).toBe(""); // <2 points
  });
});
