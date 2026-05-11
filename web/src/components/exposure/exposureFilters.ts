import type { PaletteEntry } from "../../types";
import type { ExposureRow } from "./exposureCorrelations";
import type { VaryingAxis } from "./recipeFamilies";

export type SourceKind = "averaged" | "single_result" | "manual";

/**
 * Filter clauses
 * ──────────────
 * Each filterable parameter can carry zero or more clauses. Semantics:
 *
 *   - **Positive** clauses (`eq`, `lt`, `lte`, `gt`, `gte`, `range`)
 *     are OR'd together. A row passes if it satisfies at least one
 *     positive clause for the param.
 *   - **Negative** clauses (`neq`) are AND'd against the positive
 *     result. A row must satisfy every `neq` clause (none of the
 *     excluded values appear).
 *   - **No clauses** for a param ⇒ no filter for that param.
 *   - **Across params** the result is AND'd.
 *
 * Float equality uses a small relative tolerance so `power = 14.6`
 * survives JSON round-trips that produce 14.599999… etc.
 */
export type ClauseKind = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "range";

export interface ParamClause {
  kind: ClauseKind;
  value: number;
  /** Only set when kind === "range". */
  valueHi?: number;
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
  family: { axis: VaryingAxis; anchorRowId: number } | null;
  /** Multi-select test ids. Empty = no test filter. Each selected id
   *  is independently extended by `testLineage` (single-step). */
  testIds: ReadonlySet<number>;
  /** Single-step lineage extensions applied to each selected test —
   *  not transitive. */
  testLineage: ReadonlySet<"source" | "parent">;
  testKind: "sweep" | "validation" | "all";
  /** Per-param clause lists. Absent param = no filter. */
  paramClauses: Partial<Record<FilterableParam, readonly ParamClause[]>>;
  /** Burn-setting filters. "any" means no filter (default). */
  crosshatch: TriStateFlag;
  unidirectional: TriStateFlag;
  angleMode: AngleModeFilter;
}

export const DEFAULT_FILTERS: ActiveFilters = {
  sources: new Set<SourceKind>(["averaged", "single_result", "manual"]),
  validatedOnly: false,
  trimOutliers: true,
  family: null,
  testIds: new Set(),
  testLineage: new Set(),
  testKind: "all",
  paramClauses: {},
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
  const v = e.params?.[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** Loose equality. Avoids surprising misses for floats like
 *  14.6 vs 14.599999999999998. */
const EPS = 1e-9;
export function eqApprox(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) < EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

export function clauseMatches(c: ParamClause, v: number): boolean {
  switch (c.kind) {
    case "eq":  return eqApprox(v, c.value);
    case "neq": return !eqApprox(v, c.value);
    case "lt":  return v < c.value;
    case "lte": return v <= c.value || eqApprox(v, c.value);
    case "gt":  return v > c.value;
    case "gte": return v >= c.value || eqApprox(v, c.value);
    case "range": {
      const hi = c.valueHi ?? c.value;
      return (v >= c.value || eqApprox(v, c.value))
          && (v <= hi || eqApprox(v, hi));
    }
  }
}

/** Evaluate a param's clause list against a row's value.
 *  Returns true when the row passes the filter for this param. */
export function paramPasses(
  clauses: readonly ParamClause[],
  v: number | null,
): boolean {
  if (clauses.length === 0) return true;
  // The row has no value for this param yet a filter is set: drop it.
  if (v == null) return false;

  let hasPositive = false;
  let anyPositiveMatched = false;
  for (const c of clauses) {
    if (c.kind === "neq") {
      if (!clauseMatches(c, v)) return false;  // exclude hit
    } else {
      hasPositive = true;
      if (clauseMatches(c, v)) anyPositiveMatched = true;
    }
  }
  if (!hasPositive) return true;  // only neq clauses, and none hit
  return anyPositiveMatched;
}

/** Format a clause for display. */
export function formatClause(c: ParamClause): string {
  switch (c.kind) {
    case "eq":  return `= ${c.value}`;
    case "neq": return `≠ ${c.value}`;
    case "lt":  return `< ${c.value}`;
    case "lte": return `≤ ${c.value}`;
    case "gt":  return `> ${c.value}`;
    case "gte": return `≥ ${c.value}`;
    case "range": return `${c.value}–${c.valueHi ?? c.value}`;
  }
}

/** Add a clause to ActiveFilters; returns a new ActiveFilters. */
export function addClause(
  f: ActiveFilters, param: FilterableParam, clause: ParamClause,
): ActiveFilters {
  const existing = f.paramClauses[param] ?? [];
  // Idempotent: don't add a duplicate eq/neq for the same value.
  if (
    (clause.kind === "eq" || clause.kind === "neq") &&
    existing.some((c) => c.kind === clause.kind && eqApprox(c.value, clause.value))
  ) {
    return f;
  }
  return {
    ...f,
    paramClauses: { ...f.paramClauses, [param]: [...existing, clause] },
  };
}

/** Remove a clause at `idx` from a param. */
export function removeClauseAt(
  f: ActiveFilters, param: FilterableParam, idx: number,
): ActiveFilters {
  const existing = f.paramClauses[param] ?? [];
  const next = existing.filter((_, i) => i !== idx);
  const nextClauses = { ...f.paramClauses };
  if (next.length === 0) delete nextClauses[param];
  else nextClauses[param] = next;
  return { ...f, paramClauses: nextClauses };
}

/** Toggle an `eq` clause for (param, value). Adds if absent, removes
 *  if present. Used by the Recipe apply-filter buttons. */
export function toggleEqClause(
  f: ActiveFilters, param: FilterableParam, value: number,
): ActiveFilters {
  const existing = f.paramClauses[param] ?? [];
  const matchIdx = existing.findIndex(
    (c) => c.kind === "eq" && eqApprox(c.value, value),
  );
  if (matchIdx >= 0) return removeClauseAt(f, param, matchIdx);
  return addClause(f, param, { kind: "eq", value });
}

/** True when an `eq` clause exists for (param, value). */
export function hasEqClause(
  f: ActiveFilters, param: FilterableParam, value: number,
): boolean {
  const clauses = f.paramClauses[param] ?? [];
  return clauses.some((c) => c.kind === "eq" && eqApprox(c.value, value));
}

/** Pure derivation: rows + filters + tests corpus → ExposureRow[]. */
export function applyFilters(
  rows: readonly PaletteEntry[],
  f: ActiveFilters,
  testsById: ReadonlyMap<number, TestSummary>,
): ExposureRow[] {
  const acceptedTestIds = f.testIds.size === 0
    ? null
    : (() => {
        const acc = new Set<number>();
        for (const id of f.testIds) {
          for (const v of lineageTestIds(id, f.testLineage, testsById)) acc.add(v);
        }
        return acc as ReadonlySet<number>;
      })();

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
    let outOfClauses = false;
    for (const k of FILTERABLE_PARAMS) {
      const clauses = f.paramClauses[k];
      if (!clauses || clauses.length === 0) continue;
      if (!paramPasses(clauses, paramValue(e, k))) { outOfClauses = true; break; }
    }
    if (outOfClauses) continue;

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

  return out;
}

/** Per-param min/max across the current rows (raw param values). */
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
