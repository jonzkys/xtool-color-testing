import { useEffect, useRef } from "react";
import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  type ActiveFilters, type FilterableParam, type ParamRange,
  type SourceKind,
} from "./exposureFilters";

const PARAM_KEY: Record<FilterableParam, string> = {
  power: "p", speed: "s", frequency: "f",
  pulse_width: "pw", density: "d", passes: "r",
  scan_angle: "sa",
};

const KEY_PARAM: Record<string, FilterableParam> = Object.fromEntries(
  Object.entries(PARAM_KEY).map(([k, v]) => [v, k as FilterableParam])
) as Record<string, FilterableParam>;

function encodeRange(r: ParamRange): string | null {
  if (r.min == null && r.max == null) return null;
  return `${r.min ?? ""}..${r.max ?? ""}`;
}

function decodeRange(s: string): ParamRange | null {
  const m = s.match(/^(-?\d*\.?\d*)\.\.(-?\d*\.?\d*)$/);
  if (!m) return null;
  const min = m[1] === "" ? null : Number(m[1]);
  const max = m[2] === "" ? null : Number(m[2]);
  if ((min != null && !Number.isFinite(min)) ||
      (max != null && !Number.isFinite(max))) return null;
  if (min == null && max == null) return null;
  return { min, max };
}

const ALL_SOURCES = new Set<SourceKind>(["averaged", "single_result", "manual"]);

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function encodeFilters(f: ActiveFilters): string {
  const parts: string[] = [];

  // Param ranges
  for (const k of FILTERABLE_PARAMS) {
    const r = f.paramRanges[k];
    if (!r) continue;
    const encoded = encodeRange(r);
    if (encoded) parts.push(`${PARAM_KEY[k]}=${encoded}`);
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
  if (f.brushRange) {
    parts.push(`brush=${f.brushRange[0]}..${f.brushRange[1]}`);
  }
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
    paramRanges: {},
  };

  for (const [key, value] of params.entries()) {
    if (key in KEY_PARAM) {
      const r = decodeRange(value);
      if (r) (out.paramRanges as Record<FilterableParam, ParamRange>)[KEY_PARAM[key]] = r;
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
      // Accept both new comma-list format and legacy single-id format.
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
    if (key === "brush") {
      const r = decodeRange(value);
      if (r && r.min != null && r.max != null) {
        out.brushRange = [r.min, r.max];
      }
      continue;
    }
    if (key === "trim") {
      out.trimOutliers = value !== "0";
      continue;
    }
    // unknown keys: silently ignored
  }

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

  // Read once on mount.
  useEffect(() => {
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const decoded = decodeFilters(hash.slice(qIdx + 1));
      setState(decoded);
    }
    initialised.current = true;
    // We deliberately ignore setState's identity below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write on every state change after mount.
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
