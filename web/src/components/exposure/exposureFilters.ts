import type { PaletteEntry } from "../../types";
import type { ExposureRow } from "./exposureCorrelations";
import type { VaryingAxis } from "./recipeFamilies";

export type SourceKind = "averaged" | "single_result" | "manual";

export interface ParamRange {
  /** Lower bound, inclusive. NULL = no lower bound. */
  min: number | null;
  /** Upper bound, inclusive. NULL = no upper bound. */
  max: number | null;
}

export type FilterableParam =
  | "power" | "speed" | "frequency"
  | "pulse_width" | "density" | "passes"
  | "scan_angle";

export const FILTERABLE_PARAMS: readonly FilterableParam[] = [
  "power", "speed", "frequency", "pulse_width", "density", "passes", "scan_angle",
];

export type TriStateFlag = "any" | "yes" | "no";
export type AngleModeFilter = "any" | "fixed" | "incremental";

export interface ActiveFilters {
  sources: ReadonlySet<SourceKind>;
  validatedOnly: boolean;
  trimOutliers: boolean;
  brushRange: readonly [number, number] | null;
  family: { axis: VaryingAxis; anchorRowId: number } | null;
  testId: number | null;
  /** Single-step lineage extensions — not transitive. */
  testLineage: ReadonlySet<"source" | "parent">;
  testKind: "sweep" | "validation" | "all";
  paramRanges: Partial<Record<FilterableParam, ParamRange>>;
  /** Burn-setting filters. "any" means no filter (default). */
  crosshatch: TriStateFlag;
  unidirectional: TriStateFlag;
  angleMode: AngleModeFilter;
}

export const DEFAULT_FILTERS: ActiveFilters = {
  sources: new Set<SourceKind>(["averaged", "single_result", "manual"]),
  validatedOnly: false,
  trimOutliers: true,
  brushRange: null,
  family: null,
  testId: null,
  testLineage: new Set(),
  testKind: "all",
  paramRanges: {},
  crosshatch: "any",
  unidirectional: "any",
  angleMode: "any",
};

export interface TestSummary {
  id: number;
  name: string;
  kind: "sweep" | "validation";
  source_test_id: number | null;
  parent_test_id: number | null;
}

/** Resolve which test ids are "in" given a base test + lineage flags.
 *  Single-step only — does not chase chains transitively. */
export function lineageTestIds(
  testId: number,
  lineage: ReadonlySet<"source" | "parent">,
  testsById: ReadonlyMap<number, TestSummary>,
): ReadonlySet<number> {
  const out = new Set<number>([testId]);
  const t = testsById.get(testId);
  if (!t) return out;
  if (lineage.has("source") && t.source_test_id != null) {
    out.add(t.source_test_id);
  }
  if (lineage.has("parent") && t.parent_test_id != null) {
    out.add(t.parent_test_id);
  }
  return out;
}

function paramValue(
  e: PaletteEntry, k: FilterableParam,
): number | null {
  // Backend stores numbers; the type permits string | number for
  // legacy laser/angle fields, but the six FilterableParam keys are
  // all numeric.
  const v = e.params?.[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function inRange(v: number, r: ParamRange): boolean {
  if (r.min != null && v < r.min) return false;
  if (r.max != null && v > r.max) return false;
  return true;
}

/** Pure derivation: rows + filters + tests corpus → ExposureRow[].
 *  Order: source/validated/kind/test+lineage drops first, range
 *  checks, then brush. trimOutliers is NOT applied here — it's a
 *  display-tuning flag the scatter consumes directly. Recipe-family
 *  filtering is also done at a higher layer (depends on the families
 *  map computed in ExposurePage). */
export function applyFilters(
  rows: readonly PaletteEntry[],
  f: ActiveFilters,
  testsById: ReadonlyMap<number, TestSummary>,
): ExposureRow[] {
  const acceptedTestIds = f.testId == null
    ? null
    : lineageTestIds(f.testId, f.testLineage, testsById);

  const out: ExposureRow[] = [];
  for (const e of rows) {
    if (e.indices == null) continue;
    if (!f.sources.has(e.source)) continue;
    if (f.validatedOnly && !e.is_validated) continue;
    if (f.testKind !== "all") {
      if (e.test_id == null) continue;
      const t = testsById.get(e.test_id);
      if (!t || t.kind !== f.testKind) continue;
    }
    if (acceptedTestIds && (e.test_id == null || !acceptedTestIds.has(e.test_id))) {
      continue;
    }
    let outOfRange = false;
    for (const k of FILTERABLE_PARAMS) {
      const r = f.paramRanges[k];
      if (!r) continue;
      if (r.min == null && r.max == null) continue;
      const v = paramValue(e, k);
      if (v == null) { outOfRange = true; break; }
      if (!inRange(v, r)) { outOfRange = true; break; }
    }
    if (outOfRange) continue;

    // Burn-setting filters. Boolean fields ("yes" / "no" / "any") look
    // at the raw value in params; missing keys treat as `false` so
    // legacy entries don't get filtered out by an active "no" filter.
    if (f.crosshatch !== "any") {
      const v = !!e.params?.crosshatch;
      if (f.crosshatch === "yes" && !v) continue;
      if (f.crosshatch === "no" && v) continue;
    }
    if (f.unidirectional !== "any") {
      const v = !!e.params?.unidirectional;
      if (f.unidirectional === "yes" && !v) continue;
      if (f.unidirectional === "no" && v) continue;
    }
    if (f.angleMode !== "any") {
      const v = e.params?.angle_mode === "incremental" ? "incremental" : "fixed";
      if (v !== f.angleMode) continue;
    }

    out.push({
      id: e.id,
      hex: e.hex,
      lab: [e.lab[0], e.lab[1], e.lab[2]],
      indices: e.indices,
      params: e.params,
      test_id: e.test_id,
    });
  }

  // brushRange is a band on total_exposure_index; drop rows outside it.
  if (f.brushRange) {
    const [lo, hi] = f.brushRange;
    return out.filter((r) => {
      const v = r.indices.total_exposure_index;
      return Number.isFinite(v) && v >= lo && v <= hi;
    });
  }

  return out;
}

/** Per-param min/max across the current rows (raw param values).
 *  Returns null when no row carries the param. */
export function dataRanges(
  rows: readonly PaletteEntry[],
): Record<FilterableParam, { min: number; max: number } | null> {
  const out: Record<FilterableParam, { min: number; max: number } | null> = {
    power: null, speed: null, frequency: null,
    pulse_width: null, density: null, passes: null, scan_angle: null,
  };
  for (const k of FILTERABLE_PARAMS) {
    let lo = Infinity, hi = -Infinity;
    for (const e of rows) {
      const v = e.params?.[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo !== Infinity) out[k] = { min: lo, max: hi };
  }
  return out;
}
