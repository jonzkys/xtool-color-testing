import { describe, expect, test } from "vitest";
import {
  DEFAULT_TRACE_MAX_PX,
  TRACE_NATIVE,
  scaleFilterSpeckle,
  traceScaleFor,
} from "./resolution";

describe("traceScaleFor", () => {
  test("leaves an image already inside the cap untouched", () => {
    expect(traceScaleFor(800, 600, 1200)).toEqual({
      width: 800,
      height: 600,
      scale: 1,
      downscaled: false,
    });
  });

  test("TRACE_NATIVE disables the cap entirely", () => {
    const s = traceScaleFor(4032, 3024, TRACE_NATIVE);
    expect(s.downscaled).toBe(false);
    expect(s.width).toBe(4032);
  });

  test("caps the LONGEST edge and preserves aspect ratio", () => {
    const s = traceScaleFor(4032, 3024, 1200);
    expect(s.downscaled).toBe(true);
    expect(Math.max(s.width, s.height)).toBe(1200);
    expect(s.width / s.height).toBeCloseTo(4032 / 3024, 2);
  });

  test("caps on height when the image is portrait", () => {
    const s = traceScaleFor(1000, 3000, 1200);
    expect(s.height).toBe(1200);
    expect(s.width).toBe(400);
  });

  test("never collapses an axis to zero on an extreme aspect ratio", () => {
    // 8000x3 downscaled to 1200 wide would round the height to 0.
    const s = traceScaleFor(8000, 3, 1200);
    expect(s.width).toBe(1200);
    expect(s.height).toBeGreaterThanOrEqual(1);
  });

  test("a zero-sized image does not divide by zero", () => {
    expect(traceScaleFor(0, 0, 1200).downscaled).toBe(false);
  });
});

describe("scaleFilterSpeckle", () => {
  test("is a no-op when the image was not downscaled", () => {
    expect(scaleFilterSpeckle(8, 1)).toBe(8);
  });

  test("scales by the SQUARE of the linear factor (it is an area threshold)", () => {
    // 1200/1672 ~= 0.7177; 8 * 0.7177^2 ~= 4.12 -> 4. This is the value that
    // kept the reference image's small text legible at 1200 px; leaving it at
    // 8 destroyed it.
    expect(scaleFilterSpeckle(8, 1200 / 1672)).toBe(4);
    expect(scaleFilterSpeckle(8, 900 / 1672)).toBe(2);
  });

  test("floors at 1 rather than falling through to 0", () => {
    // Speckle 0 disables filtering, letting anti-alias noise back in — on the
    // reference image that produced 5639 paths at 350 px versus 458 with the
    // filter on, i.e. downscaling would have made things WORSE.
    expect(scaleFilterSpeckle(8, 350 / 1672)).toBe(1);
    expect(scaleFilterSpeckle(1, 0.01)).toBe(1);
  });

  test("respects a deliberate 0 from the user", () => {
    expect(scaleFilterSpeckle(0, 0.5)).toBe(0);
  });
});

describe("DEFAULT_TRACE_MAX_PX", () => {
  test("is the measured 1200 px compromise", () => {
    // Pinned deliberately: below ~900 the reference image's thin features stop
    // surviving even with speckle co-scaling; above 1200 cost climbs with no
    // visible return on the engraved result.
    expect(DEFAULT_TRACE_MAX_PX).toBe(1200);
  });
});
