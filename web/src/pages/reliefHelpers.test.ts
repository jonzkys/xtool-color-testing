import { describe, it, expect } from "vitest";
import { DEFAULT_RELIEF_PARAMS, previewRatio, scaleParamsForPreview } from "./reliefHelpers";

describe("previewRatio", () => {
  it("is 1 when already within maxEdge", () => {
    expect(previewRatio(400, 300, 800)).toBe(1);
  });
  it("is maxEdge/longest when larger", () => {
    expect(previewRatio(1600, 400, 800)).toBeCloseTo(0.5, 5);
  });
});

describe("scaleParamsForPreview", () => {
  it("scales strength by the ratio (>=1), leaves thresholds alone", () => {
    const p = { ...DEFAULT_RELIEF_PARAMS, strength: 8, edgeThreshold: 40 };
    const out = scaleParamsForPreview(p, 0.5);
    expect(out.strength).toBe(4);
    expect(out.edgeThreshold).toBe(40);
  });
  it("never drops strength below 1", () => {
    expect(scaleParamsForPreview({ ...DEFAULT_RELIEF_PARAMS, strength: 1 }, 0.1).strength).toBe(1);
  });
});
