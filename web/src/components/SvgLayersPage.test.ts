import { describe, expect, test } from "vitest";
import { paletteParamsToLayerPatch, pickStalledValidation } from "./SvgLayersPage";

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
