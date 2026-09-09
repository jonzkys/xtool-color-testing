import { describe, expect, test } from "vitest";
import {
  mapLayersStable,
  paletteParamsToLayerPatch,
  pickStalledValidation,
} from "./SvgLayersPage";
import type { LayerSpec } from "../types";

/* Regression coverage for the previously-silent bug where the SVG
 * layer auto-match dropped ``crosshatch``, ``angle_mode`` and
 * ``scan_angle`` from palette entries (they live on LayerSpec, not
 * BaseParams). A user noticed engraves didn't match the validated
 * swatch even though the auto-match ran clean — root cause was the
 * helper returning only the BaseParams slice, so an entry burned
 * with crosshatch=1 got applied to the layer with crosshatch=false.
 */

describe("paletteParamsToLayerPatch", () => {
  test("base_params slice carries the standard burn knobs", () => {
    const patch = paletteParamsToLayerPatch({
      power: 12,
      speed: 564,
      frequency: 240,
      density: 5000,
      passes: 2,
      pulse_width: 80,
      laser: "red",
    });
    expect(patch.base_params).toMatchObject({
      power: 12,
      speed: 564,
      frequency: 240,
      density: 5000,
      passes: 2,
      pulse_width: 80,
      laser: "red",
    });
  });

  test("crosshatch=1 surfaces as a top-level boolean", () => {
    // The validation flow stores the crosshatch flag as a number
    // (cell.params.crosshatch = 0 or 1). Anything truthy must end up
    // as ``crosshatch: true`` on the layer patch.
    const patch = paletteParamsToLayerPatch({
      power: 12, speed: 564, frequency: 240, density: 5000,
      passes: 2, pulse_width: 80, laser: "red",
      crosshatch: 1,
    });
    expect(patch.crosshatch).toBe(true);
  });

  test("crosshatch=0 surfaces as false (no false negatives)", () => {
    const patch = paletteParamsToLayerPatch({
      power: 12, speed: 564, frequency: 240, density: 5000,
      passes: 2, pulse_width: 80, laser: "red",
      crosshatch: 0,
    });
    expect(patch.crosshatch).toBe(false);
  });

  test("crosshatch tolerates string forms a future writer might use", () => {
    expect(paletteParamsToLayerPatch({
      power: 1, speed: 1, frequency: 1, density: 1, passes: 1, pulse_width: 1, laser: "red",
      crosshatch: "1",
    }).crosshatch).toBe(true);
    expect(paletteParamsToLayerPatch({
      power: 1, speed: 1, frequency: 1, density: 1, passes: 1, pulse_width: 1, laser: "red",
      crosshatch: "true",
    }).crosshatch).toBe(true);
  });

  test("angle_mode carries through verbatim", () => {
    expect(paletteParamsToLayerPatch({
      power: 1, speed: 1, frequency: 1, density: 1, passes: 1, pulse_width: 1, laser: "red",
      angle_mode: "incremental",
    }).angle_mode).toBe("incremental");
    expect(paletteParamsToLayerPatch({
      power: 1, speed: 1, frequency: 1, density: 1, passes: 1, pulse_width: 1, laser: "red",
      angle_mode: "fixed",
    }).angle_mode).toBe("fixed");
  });

  test("scan_angle lands at top-level AND on base_params", () => {
    // ``scan_angle`` is duplicated on LayerSpec + BaseParams; the
    // exporter reads the top-level field, but base_params is what
    // round-trips back through the test serialisation, so writing
    // both keeps the two views consistent.
    const patch = paletteParamsToLayerPatch({
      power: 1, speed: 1, frequency: 1, density: 1, passes: 1, pulse_width: 1, laser: "red",
      scan_angle: 45,
    });
    expect(patch.scan_angle).toBe(45);
    expect(patch.base_params.scan_angle).toBe(45);
  });

  test("missing optional fields produce undefined (no spurious overwrites)", () => {
    // Without crosshatch / angle_mode in the source params, the
    // patch must NOT carry them — otherwise applying the patch would
    // overwrite a layer's existing setting with ``undefined`` /
    // ``false``, surprising the user.
    const patch = paletteParamsToLayerPatch({
      power: 12, speed: 564, frequency: 240, density: 5000,
      passes: 2, pulse_width: 80, laser: "red",
    });
    expect(patch.crosshatch).toBeUndefined();
    expect(patch.angle_mode).toBeUndefined();
    expect(patch.scan_angle).toBeUndefined();
  });

  test("laser falls back to red for any non-blue input", () => {
    const red = paletteParamsToLayerPatch({
      power: 1, speed: 1, frequency: 1, density: 1, passes: 1, pulse_width: 1, laser: "ir",
    });
    expect(red.base_params.laser).toBe("red");
    const blue = paletteParamsToLayerPatch({
      power: 1, speed: 1, frequency: 1, density: 1, passes: 1, pulse_width: 1, laser: "blue",
    });
    expect(blue.base_params.laser).toBe("blue");
  });
});

/* The empty-palette hint on the layers page points at the validation
 * test that stalled short of the two runs the save gate needs. Real
 * case that prompted it: a freshly validated material read "no palette
 * entries" because its only test had a single uploaded run, so every
 * cell skipped as insufficient_runs and nothing was ever written.
 */

describe("pickStalledValidation", () => {
  test("ignores tests with no uploaded runs", () => {
    expect(pickStalledValidation([
      { id: 1, name: "Never burned", runCount: 0 },
    ])).toBeNull();
    expect(pickStalledValidation([])).toBeNull();
  });

  test("prefers the test closest to saveable", () => {
    const pick = pickStalledValidation([
      { id: 3, name: "One shoot", runCount: 1 },
      { id: 2, name: "Two shoots", runCount: 2 },
    ]);
    expect(pick?.id).toBe(2);
  });

  test("breaks a run-count tie on the newest test", () => {
    const pick = pickStalledValidation([
      { id: 4, name: "Older", runCount: 1 },
      { id: 9, name: "Newer", runCount: 1 },
    ]);
    expect(pick?.id).toBe(9);
  });
});


/* ``request.layers`` array identity is load-bearing: ``enabledColors`` is
 * memoised on it, and the preview effect keys off that Set. Before this
 * helper existed, every layer-editor control allocated a fresh array — even
 * for a write that changed nothing — which minted a new Set and fired a
 * multi-second /api/svg-preview round trip for geometry that had not moved.
 */

function layer(color: string, power = 10): LayerSpec {
  return {
    color,
    name: color,
    enabled: true,
    processing_type: "COLOR_FILL_ENGRAVE",
    scan_angle: 90,
    base_params: { power } as LayerSpec["base_params"],
    angle_mode: "fixed",
    crosshatch: false,
    material_id: null,
    hatch_passes: [],
  };
}

describe("mapLayersStable", () => {
  test("returns the SAME array reference when nothing changed", () => {
    const layers = [layer("#aaa"), layer("#bbb")];
    const out = mapLayersStable(layers, (l) => l);
    expect(out).toBe(layers);
  });

  test("returns a new array when any element changed", () => {
    const layers = [layer("#aaa"), layer("#bbb")];
    const out = mapLayersStable(layers, (l) =>
      l.color === "#bbb" ? { ...l, enabled: false } : l,
    );
    expect(out).not.toBe(layers);
    expect(out[0]).toBe(layers[0]);
    expect(out[1].enabled).toBe(false);
  });

  test("a patch aimed at a colour that is not present is a no-op", () => {
    const layers = [layer("#aaa"), layer("#bbb")];
    const out = mapLayersStable(layers, (l) =>
      l.color === "#zzz" ? { ...l, enabled: false } : l,
    );
    expect(out).toBe(layers);
  });

  test("an empty layer list stays the same reference", () => {
    const layers: LayerSpec[] = [];
    expect(mapLayersStable(layers, (l) => l)).toBe(layers);
  });
});


/* A palette entry does not have to carry every burn parameter. Entries
 * produced by a 2D speed x frequency sweep hold only those two axes — 100 of
 * 1429 entries in a real database. ``paletteParamsToLayerPatch`` used to run
 * every field through ``Number(...)`` unconditionally, so an absent key became
 * NaN, ``JSON.stringify`` turned that into ``null``, and /api/svg-layers
 * rejected the whole request with a validation error per null field. The user
 * saw "a long exception" on Generate.
 *
 * Absent keys must be OMITTED, so the layer keeps whatever it already had —
 * the patch is applied as ``{...layer.base_params, ...patch.base_params}``.
 */
describe("paletteParamsToLayerPatch with partial entries", () => {
  test("omits keys the entry does not carry, rather than emitting NaN", () => {
    const patch = paletteParamsToLayerPatch({
      speed: 2073.7191768265,
      frequency: 249.87046870252885,
    });
    expect(patch.base_params).toEqual({ speed: 2074, frequency: 250 });
    for (const [k, v] of Object.entries(patch.base_params)) {
      expect(Number.isNaN(v as number), `${k} is NaN`).toBe(false);
    }
  });

  test("survives a JSON round-trip without producing nulls", () => {
    const patch = paletteParamsToLayerPatch({ speed: 1585, frequency: 197 });
    const merged = { power: 12, speed: 1000, frequency: 125, density: 5000,
      passes: 1, pulse_width: 80, laser: "red", scan_angle: 90,
      ...patch.base_params };
    const round = JSON.parse(JSON.stringify(merged));
    for (const [k, v] of Object.entries(round)) {
      expect(v, `${k} serialised to null`).not.toBeNull();
    }
    // The entry's values win; everything else keeps the layer's existing value.
    expect(round.speed).toBe(1585);
    expect(round.power).toBe(12);
    expect(round.pulse_width).toBe(80);
  });

  test("an empty entry produces an empty patch, not a wall of NaN", () => {
    expect(paletteParamsToLayerPatch({}).base_params).toEqual({});
  });

  test("still reads a complete entry exactly as before", () => {
    const patch = paletteParamsToLayerPatch({
      power: 12, speed: 564, frequency: 240, density: 5000,
      passes: 2, pulse_width: 80, laser: "blue",
    });
    expect(patch.base_params).toEqual({
      power: 12, speed: 564, frequency: 240, density: 5000,
      passes: 2, pulse_width: 80, laser: "blue",
    });
  });
});
