import { useEffect, useRef } from "react";
import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  type ActiveFilters, type ClauseKind, type FilterableParam,
  type ParamClause, type SourceKind,
} from "./exposureFilters";

const PARAM_KEY: Record<FilterableParam, string> = {
  power: "p", speed: "s", frequency: "f",
  pulse_width: "pw", density: "d", passes: "r",
  scan_angle: "sa",
};

const KEY_PARAM: Record<string, FilterableParam> = Object.fromEntries(
  Object.entries(PARAM_KEY).map(([k, v]) => [v, k as FilterableParam])
) as Record<string, FilterableParam>;

const ALLOWED_OPS: ReadonlySet<ClauseKind> = new Set<ClauseKind>([
  "eq", "neq", "lt", "lte", "gt", "gte", "range",
]);

function encodeClause(c: ParamClause): string {
  if (c.kind === "range") return `range:${c.value}..${c.valueHi ?? c.value}`;
  return `${c.kind}:${c.value}`;
}

function decodeClause(s: string): ParamClause | null {
  const m = s.match(/^([a-z]+):(.+)$/);
  if (!m) return null;
  const kind = m[1] as ClauseKind;
  if (!ALLOWED_OPS.has(kind)) return null;
  if (kind === "range") {
    const rm = m[2].match(/^(-?\d*\.?\d*)\.\.(-?\d*\.?\d*)$/);
    if (!rm) return null;
    const value = Number(rm[1]);
    const valueHi = Number(rm[2]);
    if (!Number.isFinite(value) || !Number.isFinite(valueHi)) return null;
    return { kind, value, valueHi };
  }
  const v = Number(m[2]);
  if (!Number.isFinite(v)) return null;
  return { kind, value: v };
}

const ALL_SOURCES = new Set<SourceKind>(["averaged", "single_result", "manual"]);

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function encodeFilters(f: ActiveFilters): string {
  const parts: string[] = [];

  for (const k of FILTERABLE_PARAMS) {
    const clauses = f.paramClauses[k];
    if (!clauses || clauses.length === 0) continue;
    parts.push(`${PARAM_KEY[k]}=${clauses.map(encodeClause).join(",")}`);
  }

  if (!setsEqual(f.sources, ALL_SOURCES)) {
    parts.push(`src=${[...f.sources].join(",")}`);
  }
  if (f.validatedOnly) parts.push("val=1");
  if (f.testIds.size > 0) {
    parts.push(`test=${[...f.testIds].sort((a, b) => a - b).join(",")}`);
  }
  if (f.testLineage.size > 0) {
    parts.push(`lin=${[...f.testLineage].join(",")}`);
  }
  if (f.testKind !== "all") parts.push(`kind=${f.testKind}`);
  if (f.crosshatch !== "any") parts.push(`xh=${f.crosshatch}`);
  if (f.unidirectional !== "any") parts.push(`uni=${f.unidirectional}`);
  if (f.angleMode !== "any") parts.push(`am=${f.angleMode}`);
  if (!f.trimOutliers) parts.push("trim=0");

  return parts.join("&");
}

export function decodeFilters(query: string): ActiveFilters {
  const params = new URLSearchParams(query);
  const out: ActiveFilters = {
    ...DEFAULT_FILTERS,
    sources: new Set(DEFAULT_FILTERS.sources),
    testIds: new Set(),
    testLineage: new Set(),
    paramClauses: {},
  };
  const mutableClauses: Partial<Record<FilterableParam, ParamClause[]>> = {};

  for (const [key, value] of params.entries()) {
    if (key in KEY_PARAM) {
      const param = KEY_PARAM[key];
      const clauses = value.split(",")
        .map(decodeClause)
        .filter((c): c is ParamClause => c !== null);
      if (clauses.length > 0) mutableClauses[param] = clauses;
      continue;
    }
    if (key === "src") {
      const kinds = value.split(",").filter(
        (v): v is SourceKind =>
          v === "averaged" || v === "single_result" || v === "manual",
      );
      if (kinds.length > 0) out.sources = new Set(kinds);
      continue;
    }
    if (key === "val") {
      out.validatedOnly = value === "1";
      continue;
    }
    if (key === "test") {
      const ids = value.split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length > 0) out.testIds = new Set(ids);
      continue;
    }
    if (key === "lin") {
      const flags = value.split(",").filter(
        (v): v is "source" | "parent" => v === "source" || v === "parent",
      );
      out.testLineage = new Set(flags);
      continue;
    }
    if (key === "kind") {
      if (value === "sweep" || value === "validation" || value === "all") {
        out.testKind = value;
      }
      continue;
    }
    if (key === "xh") {
      if (value === "any" || value === "yes" || value === "no") out.crosshatch = value;
      continue;
    }
    if (key === "uni") {
      if (value === "any" || value === "yes" || value === "no") out.unidirectional = value;
      continue;
    }
    if (key === "am") {
      if (value === "any" || value === "fixed" || value === "incremental") {
        out.angleMode = value;
      }
      continue;
    }
    if (key === "trim") {
      out.trimOutliers = value !== "0";
      continue;
    }
  }
  out.paramClauses = mutableClauses;
  return out;
}

/** Two-way sync between ActiveFilters state and the URL hash query
 *  string. Reads on mount; writes on every state change via
 *  history.replaceState. The router treats everything before the first
 *  `?` as the route, so this doesn't trigger renavigation. */
export function useFiltersUrlSync(
  state: ActiveFilters,
  setState: (f: ActiveFilters) => void,
): void {
  const initialised = useRef(false);

  useEffect(() => {
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const decoded = decodeFilters(hash.slice(qIdx + 1));
      setState(decoded);
    }
    initialised.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialised.current) return;
    const encoded = encodeFilters(state);
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    const route = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    const next = encoded ? `${route}?${encoded}` : route;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [state]);
}
