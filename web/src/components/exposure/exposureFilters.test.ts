import { describe, expect, it } from "vitest";
import {
  applyFilters,
  DEFAULT_FILTERS,
  dataRanges,
  lineageTestIds,
  type ActiveFilters,
  type TestSummary,
} from "./exposureFilters";
import type { PaletteEntry } from "../../types";

function entry(over: Partial<PaletteEntry> & { id: number }): PaletteEntry {
  return {
    test_id: over.test_id ?? null,
    machine_id: "F2Ultra",
    material_id: 1,
    x_value: null, y_value: null,
    hex: "#000000",
    lab: [50, 0, 0],
    params: { speed: 600, power: 50, density: 100,
              frequency: 30, pulse_width: 200, passes: 1 },
    sigma: 0,
    source: "averaged",
    source_result_id: null,
    notes: "",
    favorited: false,
    created_at: "",
    indices: {
      pulse_spacing_mm: 0.02, line_spacing_mm: 0.1,
      pulse_energy_index: 1.67, pulse_intensity_index: 0.0083,
      total_exposure_index: 8.33, ablation_aggression_index: 0.069,
      delivery_smoothness_index: 1004,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
    ...over,
  } as PaletteEntry;
}

const TESTS: ReadonlyMap<number, TestSummary> = new Map([
  [10, { id: 10, name: "sweep-A", kind: "sweep",
         source_test_id: null, parent_test_id: null }],
  [20, { id: 20, name: "validate-A", kind: "validation",
         source_test_id: 10, parent_test_id: null }],
  [30, { id: 30, name: "iter-A", kind: "sweep",
         source_test_id: null, parent_test_id: 10 }],
]);

describe("applyFilters", () => {
  it("default filters return every row", () => {
    const rows = [entry({ id: 1 }), entry({ id: 2, source: "manual" })];
    expect(applyFilters(rows, DEFAULT_FILTERS, TESTS).map(r => r.id))
      .toEqual([1, 2]);
  });

  it("source set excludes other sources", () => {
    const rows = [
      entry({ id: 1, source: "averaged" }),
      entry({ id: 2, source: "manual" }),
      entry({ id: 3, source: "single_result" }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["averaged"]) };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("validatedOnly drops non-validated entries", () => {
    const rows = [
      entry({ id: 1, is_validated: true }),
      entry({ id: 2, is_validated: false }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("range filter excludes rows whose param is outside [min, max]", () => {
    const rows = [
      entry({ id: 1, params: { ...entry({id:1}).params, power: 20 } }),
      entry({ id: 2, params: { ...entry({id:2}).params, power: 50 } }),
      entry({ id: 3, params: { ...entry({id:3}).params, power: 90 } }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 30, max: 70 } } };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([2]);
  });

  it("range with missing param drops the row", () => {
    const rows = [
      entry({ id: 1, params: {} as Record<string, number | string> }),
      entry({ id: 2, params: { ...entry({id:2}).params, power: 50 } }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 30, max: 70 } } };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([2]);
  });

  it("test_id filter restricts to that test's entries", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),
      entry({ id: 2, test_id: 20 }),
      entry({ id: 3, test_id: null }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testId: 10 };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("test_id + source lineage extends to the source test's entries", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),     // source of test 20
      entry({ id: 2, test_id: 20 }),     // selected test
      entry({ id: 3, test_id: 30 }),     // unrelated
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testId: 20,
      testLineage: new Set(["source"]) };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1, 2]);
  });

  it("test_id + parent lineage extends to the parent test's entries", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),     // parent of test 30
      entry({ id: 2, test_id: 30 }),     // selected test
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testId: 30,
      testLineage: new Set(["parent"]) };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1, 2]);
  });

  it("kind filter narrows to sweeps or validations", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),     // sweep
      entry({ id: 2, test_id: 20 }),     // validation
      entry({ id: 3, test_id: null }),   // manual entry
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testKind: "sweep" };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("manual entries (test_id=null) survive a kind filter when kind=all", () => {
    const rows = [
      entry({ id: 1, test_id: null }),
      entry({ id: 2, test_id: 20 }),
    ];
    expect(applyFilters(rows, DEFAULT_FILTERS, TESTS).map(r => r.id))
      .toEqual([1, 2]);
  });

  it("regression: source set is honoured without re-fetching", () => {
    // Reproduces the bug from the existing page: applying a source
    // filter on a fixed `rows` array yields the right subset, no
    // server roundtrip required.
    const rows = [
      entry({ id: 1, source: "averaged" }),
      entry({ id: 2, source: "manual" }),
    ];
    const f1: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["averaged"]) };
    const f2: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["manual"]) };
    expect(applyFilters(rows, f1, TESTS).map(r => r.id)).toEqual([1]);
    expect(applyFilters(rows, f2, TESTS).map(r => r.id)).toEqual([2]);
  });
});

describe("lineageTestIds", () => {
  it("returns just the test id when no lineage extensions", () => {
    expect(lineageTestIds(20, new Set(), TESTS)).toEqual(new Set([20]));
  });
  it("adds source_test_id when 'source' lineage requested", () => {
    expect(lineageTestIds(20, new Set(["source"]), TESTS))
      .toEqual(new Set([10, 20]));
  });
  it("adds parent_test_id when 'parent' lineage requested", () => {
    expect(lineageTestIds(30, new Set(["parent"]), TESTS))
      .toEqual(new Set([10, 30]));
  });
  it("ignores lineage when source/parent_test_id is null", () => {
    expect(lineageTestIds(10, new Set(["source", "parent"]), TESTS))
      .toEqual(new Set([10]));
  });
});

describe("dataRanges", () => {
  it("returns min/max for each param across rows", () => {
    const rows = [
      entry({ id: 1, params: { speed: 200, power: 10, density: 50,
                               frequency: 30, pulse_width: 100, passes: 1 } }),
      entry({ id: 2, params: { speed: 800, power: 80, density: 200,
                               frequency: 60, pulse_width: 400, passes: 4 } }),
    ];
    const r = dataRanges(rows);
    expect(r.speed).toEqual({ min: 200, max: 800 });
    expect(r.power).toEqual({ min: 10, max: 80 });
    expect(r.density).toEqual({ min: 50, max: 200 });
  });

  it("returns null for params that no row carries", () => {
    const rows = [entry({ id: 1, params: { power: 50 } })];
    const r = dataRanges(rows);
    expect(r.speed).toBeNull();
  });
});
