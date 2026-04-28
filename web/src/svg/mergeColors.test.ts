// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import {
  applyMatchedExport,
  mergeColorsInSvg,
  computeColorMergeGroups,
  computeParamMergeGroups,
  type MergeGroup,
} from "./mergeColors";
import type { LayerSpec } from "../types";
import { defaultHatchPass } from "../defaults";

const wrap = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`;

function extractFills(svg: string): string[] {
  const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
  return [...dom.querySelectorAll<SVGElement>("*")]
    .map((el) => el.getAttribute("fill"))
    .filter((f): f is string => f !== null);
}

describe("mergeColorsInSvg", () => {
  test("rewrites fill attribute matching a source color", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000", "#fb0002"], representativeColor: "#ff0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="#ff0000"/><rect fill="#fb0002"/><rect fill="#00ff00"/>`),
      groups,
    );
    expect(extractFills(out)).toEqual(["#ff0000", "#ff0000", "#00ff00"]);
  });

  test("rewrites stroke attribute matching a source color", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#0000ff"], representativeColor: "#1111ff" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<path stroke="#0000ff" d="M0 0L1 1"/>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(dom.querySelector("path")!.getAttribute("stroke")).toBe("#1111ff");
  });

  test("rewrites inline style fill: declaration", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect style="fill: #ff0000; stroke: black"/>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    const style = dom.querySelector("rect")!.getAttribute("style") ?? "";
    expect(style).toMatch(/fill:\s*#aa0000/);
    expect(style).toMatch(/stroke:\s*black/);
  });

  test("normalises 3-digit hex to 6-digit before matching", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#ff0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="#f00"/>`),
      groups,
    );
    expect(extractFills(out)).toEqual(["#ff0000"]);
  });

  test("leaves fill=none untouched", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="none" stroke="#ff0000"/>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    const rect = dom.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("none");
    expect(rect.getAttribute("stroke")).toBe("#aa0000");
  });

  test("leaves currentColor and url(#...) untouched", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="currentColor"/><rect fill="url(#grad)"/>`),
      groups,
    );
    expect(extractFills(out)).toEqual(["currentColor", "url(#grad)"]);
  });

  test("rewrites colour on a <g> ancestor too (inherited fill)", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<g fill="#ff0000"><rect/></g>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(dom.querySelector("g")!.getAttribute("fill")).toBe("#aa0000");
  });

  test("preserves <defs> content untouched", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<defs><linearGradient id="g"><stop stop-color="#ff0000"/></linearGradient></defs><rect fill="#ff0000"/>`),
      groups,
    );
    // Rect's fill rewrites; the <stop> uses stop-color not fill/stroke so it stays.
    expect(out).toContain('stop-color="#ff0000"');
    expect(out).toContain('fill="#aa0000"');
  });

  test("returns original SVG unchanged when groups is empty", () => {
    const input = wrap(`<rect fill="#ff0000"/>`);
    const out = mergeColorsInSvg(input, []);
    expect(extractFills(out)).toEqual(["#ff0000"]);
  });

  test("throws on malformed SVG", () => {
    expect(() => mergeColorsInSvg("<svg><not-closed>", [])).toThrow();
  });
});

function layerWithColor(color: string): LayerSpec {
  return {
    color,
    name: color,
    enabled: true,
    processing_type: "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: {
      laser: "red",
      power: 50, speed: 100, frequency: 20000,
      density: 40, passes: 1, pulse_width: 100,
      scan_angle: 90,
    },
    angle_mode: "fixed",
    material_id: null,
    hatch_passes: [],
  };
}

describe("computeColorMergeGroups", () => {
  test("single cluster when all colours are within threshold", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
      layerWithColor("#f60404"),
    ];
    const counts = { "#ff0000": 100, "#fb0002": 50, "#f60404": 25 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceColors).toEqual(
      expect.arrayContaining(["#ff0000", "#fb0002", "#f60404"]),
    );
    // Dominant (highest shape_count) becomes the representative.
    expect(groups[0].representativeColor).toBe("#ff0000");
  });

  test("multiple clusters for distinct colour families", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
      layerWithColor("#0000ff"),
      layerWithColor("#0404fb"),
    ];
    const counts = {
      "#ff0000": 200, "#fb0002": 50, "#0000ff": 180, "#0404fb": 40,
    };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(2);
    const reps = groups.map((g) => g.representativeColor).sort();
    expect(reps).toEqual(["#0000ff", "#ff0000"]);
  });

  test("no groups when every colour is beyond threshold", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#00ff00"),
      layerWithColor("#0000ff"),
    ];
    const counts = { "#ff0000": 10, "#00ff00": 10, "#0000ff": 10 };
    // ΔE between primaries is way beyond 5.
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(0);
  });

  test("singleton layers omitted from output", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
      layerWithColor("#00ff00"),
    ];
    const counts = { "#ff0000": 100, "#fb0002": 50, "#00ff00": 80 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceColors).not.toContain("#00ff00");
  });

  test("dominant-first seeding: biggest shape_count becomes rep", () => {
    // Both reds within threshold but #fb0002 has more shapes.
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
    ];
    const counts = { "#ff0000": 20, "#fb0002": 500 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups[0].representativeColor).toBe("#fb0002");
  });

  test("missing shape count treated as zero (not dominant)", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
    ];
    // #ff0000 has a count, #fb0002 missing entirely -> falls back to 0.
    const counts = { "#ff0000": 10 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups[0].representativeColor).toBe("#ff0000");
  });
});

function baseParamsOf(overrides: Partial<LayerSpec["base_params"]> = {}): LayerSpec["base_params"] {
  return {
    laser: "red",
    power: 50, speed: 100, frequency: 20000,
    density: 40, passes: 1, pulse_width: 100,
    scan_angle: 90,
    ...overrides,
  };
}

function layer(overrides: Partial<LayerSpec> = {}): LayerSpec {
  return {
    color: "#ff0000",
    name: "layer",
    enabled: true,
    processing_type: "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: baseParamsOf(),
    angle_mode: "fixed",
    material_id: null,
    hatch_passes: [],
    ...overrides,
  };
}

describe("computeParamMergeGroups", () => {
  test("identical enabled layers collapse into one group", () => {
    const layers = [
      layer({ color: "#ff0000" }),
      layer({ color: "#fb0002" }),
      layer({ color: "#00ff00" }),
    ];
    // All three have identical params — only the color differs, so all three collapse.
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((l) => l.color).sort()).toEqual(
      ["#00ff00", "#fb0002", "#ff0000"],
    );
  });

  test("different scan_angle prevents collapse for non-hatched", () => {
    const layers = [
      layer({ color: "#ff0000", scan_angle: 90 }),
      layer({ color: "#fb0002", scan_angle: 45 }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("different angle_mode prevents collapse for non-hatched", () => {
    const layers = [
      layer({ color: "#ff0000", angle_mode: "fixed" }),
      layer({ color: "#fb0002", angle_mode: "crosshatch" }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("scan_angle and angle_mode ignored for HATCHED_LINES", () => {
    const layers = [
      layer({
        color: "#ff0000",
        processing_type: "HATCHED_LINES",
        scan_angle: 90,
        angle_mode: "fixed",
        hatch_passes: [defaultHatchPass(0)],
      }),
      layer({
        color: "#fb0002",
        processing_type: "HATCHED_LINES",
        scan_angle: 45,          // Differs, but ignored for hatched.
        angle_mode: "crosshatch",// Differs, but ignored for hatched.
        hatch_passes: [defaultHatchPass(0)],
      }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(1);
  });

  test("different hatch_passes prevents collapse for HATCHED_LINES", () => {
    const layers = [
      layer({
        color: "#ff0000",
        processing_type: "HATCHED_LINES",
        hatch_passes: [defaultHatchPass(0)],
      }),
      layer({
        color: "#fb0002",
        processing_type: "HATCHED_LINES",
        hatch_passes: [defaultHatchPass(0), defaultHatchPass(90)],
      }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("reordered hatch_passes prevents collapse for HATCHED_LINES", () => {
    const layers = [
      layer({
        color: "#ff0000",
        processing_type: "HATCHED_LINES",
        hatch_passes: [defaultHatchPass(0), defaultHatchPass(90)],
      }),
      layer({
        color: "#fb0002",
        processing_type: "HATCHED_LINES",
        hatch_passes: [defaultHatchPass(90), defaultHatchPass(0)],
      }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("different base params (power) prevents collapse", () => {
    const layers = [
      layer({ color: "#ff0000", base_params: baseParamsOf({ power: 50 }) }),
      layer({ color: "#fb0002", base_params: baseParamsOf({ power: 60 }) }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("disabled layers excluded from grouping", () => {
    const layers = [
      layer({ color: "#ff0000", enabled: true }),
      layer({ color: "#fb0002", enabled: false }),
      layer({ color: "#f60404", enabled: true }),
    ];
    const groups = computeParamMergeGroups(layers);
    // Two enabled layers with identical params -> one group of two.
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0].map((l) => l.color).sort()).toEqual(["#f60404", "#ff0000"]);
  });

  test("material_id and name do not affect grouping", () => {
    const layers = [
      layer({ color: "#ff0000", name: "alpha", material_id: "1" }),
      layer({ color: "#fb0002", name: "beta",  material_id: "2" }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(1);
  });

  test("representatives preserve request-list order", () => {
    const layers = [
      layer({ color: "#00ff00" }),  // index 0
      layer({ color: "#ff0000" }),  // index 1
      layer({ color: "#fb0002" }),  // index 2 — same params as #ff0000
    ];
    const groups = computeParamMergeGroups(layers);
    // First-occurrence rep = #00ff00 (appears first) since all three match.
    expect(groups[0][0].color).toBe("#00ff00");
  });
});

describe("applyMatchedExport", () => {
  const baseSvg = wrap(
    `<rect fill="#aa0000"/><rect fill="#bb0000"/><rect fill="#00ff00"/>`,
  );

  test("returns input unchanged when nothing has been matched", () => {
    const layers = [layer({ color: "#aa0000" }), layer({ color: "#bb0000" })];
    const out = applyMatchedExport({
      svgContent: baseSvg,
      layers,
      predictedByColor: {},
    });
    expect(out.svgContent).toBe(baseSvg);
    expect(out.layers).toEqual(layers);
  });

  test("self-mapped colours don't trigger a remap", () => {
    const layers = [layer({ color: "#aa0000" })];
    const out = applyMatchedExport({
      svgContent: baseSvg,
      layers,
      predictedByColor: { "#aa0000": "#aa0000" },
    });
    expect(out.svgContent).toBe(baseSvg);
    expect(out.layers).toEqual(layers);
  });

  test("remaps a single source colour to a different palette hex", () => {
    const layers = [layer({ color: "#aa0000" }), layer({ color: "#bb0000" })];
    const out = applyMatchedExport({
      svgContent: baseSvg,
      layers,
      predictedByColor: { "#aa0000": "#ff0000" },
    });
    expect(out.layers.map((l) => l.color)).toEqual(["#ff0000", "#bb0000"]);
    expect(extractFills(out.svgContent)).toEqual(
      ["#ff0000", "#bb0000", "#00ff00"],
    );
  });

  test("regression: two source colours mapped to a single new rep "
    + "leaves at least one layer (was 422 on /api/svg-layers)", () => {
    // ``#aa0000`` and ``#bb0000`` both map to ``#ff0000``, which is
    // NOT itself an existing layer. Pre-fix, the source layers got
    // filtered out as "losers" without any rep layer being added,
    // collapsing layers to []. The schema's ``min_length=1`` then
    // 422'd the request.
    const layers = [layer({ color: "#aa0000" }), layer({ color: "#bb0000" })];
    const out = applyMatchedExport({
      svgContent: baseSvg,
      layers,
      predictedByColor: {
        "#aa0000": "#ff0000",
        "#bb0000": "#ff0000",
      },
    });
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0].color).toBe("#ff0000");
    // First source's params win because mapping happens before dedupe
    // and the dedupe keeps the first occurrence.
    expect(extractFills(out.svgContent)).toEqual(
      ["#ff0000", "#ff0000", "#00ff00"],
    );
  });

  test("preserves an existing rep layer's params when sources also "
    + "map to that rep", () => {
    // Existing #ff0000 layer (with a distinct ``name`` so we can
    // assert it survived) plus #aa0000 mapping to #ff0000 → still
    // exactly one #ff0000 layer.
    const existing = layer({ color: "#ff0000", name: "rep-original" });
    const source = layer({ color: "#aa0000", name: "source" });
    const out = applyMatchedExport({
      svgContent: wrap(`<rect fill="#aa0000"/><rect fill="#ff0000"/>`),
      layers: [existing, source],
      predictedByColor: { "#aa0000": "#ff0000" },
    });
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0].color).toBe("#ff0000");
    // Existing rep comes first in the array → its params win the dedupe.
    expect(out.layers[0].name).toBe("rep-original");
  });
});
