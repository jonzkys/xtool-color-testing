import { describe, expect, it } from "vitest";
import {
  encodeFilters, decodeFilters,
} from "./exposureFiltersUrl";
import { DEFAULT_FILTERS, type ActiveFilters } from "./exposureFilters";

function roundTrip(f: ActiveFilters): ActiveFilters {
  return decodeFilters(encodeFilters(f));
}

describe("encodeFilters", () => {
  it("returns empty string for default filters", () => {
    expect(encodeFilters(DEFAULT_FILTERS)).toBe("");
  });

  it("encodes a single param range as p=10..40", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } } };
    expect(encodeFilters(f)).toBe("p=10..40");
  });

  it("encodes half-open ranges", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { density: { min: 100, max: null } } };
    expect(encodeFilters(f)).toBe("d=100..");
  });

  it("encodes test id + lineage + kind", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      testId: 42, testLineage: new Set(["source", "parent"]),
      testKind: "validation" };
    const q = encodeFilters(f);
    expect(q).toContain("test=42");
    expect(q).toContain("lin=source,parent");
    expect(q).toContain("kind=validation");
  });

  it("omits sources when all three are checked (default)", () => {
    expect(encodeFilters(DEFAULT_FILTERS)).not.toContain("src=");
  });

  it("encodes sources subset", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["averaged"]) };
    expect(encodeFilters(f)).toBe("src=averaged");
  });
});

describe("round-trip", () => {
  for (const [name, f] of [
    ["default", DEFAULT_FILTERS],
    ["range power", { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } } }],
    ["multi-param ranges", { ...DEFAULT_FILTERS,
      paramRanges: {
        power: { min: 10, max: 40 },
        density: { min: 100, max: null },
        speed: { min: null, max: 1000 },
      } }],
    ["test + lineage + kind", { ...DEFAULT_FILTERS,
      testId: 42, testLineage: new Set(["source"]),
      testKind: "sweep" }],
    ["sources subset + validated", { ...DEFAULT_FILTERS,
      sources: new Set(["averaged", "manual"]),
      validatedOnly: true }],
    ["brush", { ...DEFAULT_FILTERS,
      brushRange: [1.2, 18] }],
    ["trimOutliers off", { ...DEFAULT_FILTERS, trimOutliers: false }],
  ] as Array<[string, ActiveFilters]>) {
    it(`round-trips ${name}`, () => {
      const out = roundTrip(f);
      expect(out).toEqual(f);
    });
  }
});

describe("decodeFilters - liberal parsing", () => {
  it("ignores unknown keys", () => {
    expect(decodeFilters("foo=bar&p=10..40")).toEqual({
      ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } },
    });
  });

  it("malformed range falls back to no constraint", () => {
    expect(decodeFilters("p=garbage")).toEqual(DEFAULT_FILTERS);
  });

  it("unknown lineage value is dropped", () => {
    expect(decodeFilters("test=42&lin=garbage").testLineage)
      .toEqual(new Set());
  });

  it("unknown kind falls back to all", () => {
    expect(decodeFilters("kind=garbage").testKind).toBe("all");
  });
});
