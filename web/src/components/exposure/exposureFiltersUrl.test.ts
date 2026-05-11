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

  it("encodes a single eq clause as p=eq:14.6", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramClauses: { power: [{ kind: "eq", value: 14.6 }] } };
    expect(encodeFilters(f)).toBe("p=eq:14.6");
  });

  it("encodes a range clause as p=range:10..40", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramClauses: { power: [{ kind: "range", value: 10, valueHi: 40 }] } };
    expect(encodeFilters(f)).toBe("p=range:10..40");
  });

  it("encodes multiple clauses with commas", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramClauses: {
        power: [
          { kind: "eq", value: 14.6 },
          { kind: "lt", value: 20 },
        ],
      } };
    expect(encodeFilters(f)).toBe("p=eq:14.6,lt:20");
  });

  it("encodes test ids + lineage + kind", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      testIds: new Set([42]), testLineage: new Set(["source", "parent"]),
      testKind: "validation" };
    const q = encodeFilters(f);
    expect(q).toContain("test=42");
    expect(q).toContain("lin=source,parent");
    expect(q).toContain("kind=validation");
  });

  it("encodes multi-select test ids as a comma list", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      testIds: new Set([5, 1, 42]) };
    expect(encodeFilters(f)).toContain("test=1,5,42");
  });

  it("encodes burn-setting tri-states", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      crosshatch: "yes", unidirectional: "no", angleMode: "incremental" };
    const q = encodeFilters(f);
    expect(q).toContain("xh=yes");
    expect(q).toContain("uni=no");
    expect(q).toContain("am=incremental");
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
    ["eq power", { ...DEFAULT_FILTERS,
      paramClauses: { power: [{ kind: "eq", value: 14.6 }] } }],
    ["range power", { ...DEFAULT_FILTERS,
      paramClauses: { power: [{ kind: "range", value: 10, valueHi: 40 }] } }],
    ["multi-clause power (eq + lt)", { ...DEFAULT_FILTERS,
      paramClauses: { power: [
        { kind: "eq", value: 14.6 }, { kind: "lt", value: 20 },
      ] } }],
    ["multi-param clauses", { ...DEFAULT_FILTERS,
      paramClauses: {
        power: [{ kind: "range", value: 10, valueHi: 40 }],
        density: [{ kind: "gte", value: 100 }],
        speed: [{ kind: "lte", value: 1000 }],
      } }],
    ["test + lineage + kind", { ...DEFAULT_FILTERS,
      testIds: new Set([42]), testLineage: new Set(["source"]),
      testKind: "sweep" }],
    ["multi-test", { ...DEFAULT_FILTERS,
      testIds: new Set([1, 5, 42]) }],
    ["sources subset + validated", { ...DEFAULT_FILTERS,
      sources: new Set(["averaged", "manual"]),
      validatedOnly: true }],
    ["burn settings", { ...DEFAULT_FILTERS,
      crosshatch: "yes", unidirectional: "no", angleMode: "fixed" }],
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
    expect(decodeFilters("foo=bar&p=eq:14.6")).toEqual({
      ...DEFAULT_FILTERS,
      paramClauses: { power: [{ kind: "eq", value: 14.6 }] },
    });
  });

  it("malformed clause falls back to no constraint", () => {
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
