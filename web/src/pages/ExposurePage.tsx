import * as React from "react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { listMaterials } from "../api/library";
import { listPaletteEntries } from "../api/palette";
import { listTests, createTest, getTest } from "../api/tests";
import { patchValidationCells } from "../api/validationCells";
import { getValidationProfile, useCurrentMachine } from "../state/machine";
import { defaultBaseParams, defaultSpec } from "../defaults";
import type { Material } from "../library";
import type { BaseParams, ParamName, PaletteEntry, TestSpec } from "../types";
import {
  ExposureScatter,
  type ScaleKind,
  type ScatterMode,
  type ScatterViewport,
} from "../components/exposure/ExposureScatter";
import { ExposureCorrelationMatrix } from "../components/exposure/ExposureCorrelationMatrix";
import { ExposureFocusedCard } from "../components/exposure/ExposureFocusedCard";
import { ExposureNeighboursPanel } from "../components/exposure/ExposureNeighboursPanel";
import {
  buildCorrelationMatrix,
  buildRawParamCorrelationMatrix,
  INDEX_ROWS,
  RAW_PARAM_ROWS,
  type ChannelCol,
  type ExposureRow,
  type IndexRow,
  type RawParamRow,
} from "../components/exposure/exposureCorrelations";
import { pearson, spearman, logLinearRegression } from "../components/exposure/exposureMath";
import { buildFamilies, type FamilyMember } from "../components/exposure/recipeFamilies";
import {
  applyFilters, DEFAULT_FILTERS, FILTERABLE_PARAMS,
  hasEqClause, toggleEqClause, addClause,
  type ActiveFilters,
  type FilterableParam,
  type ParamClause,
  type TestSummary,
} from "../components/exposure/exposureFilters";
import { ExposureFilterStack } from "../components/exposure/ExposureFilterStack";
import { ExposureFilterPills } from "../components/exposure/ExposureFilterPills";
import { ExposureFocusedIndices } from "../components/exposure/ExposureFocusedIndices";
import { bumpMru } from "../components/exposure/exposureParamMru";
import { ExposureUnderGraphPills } from "../components/exposure/ExposureUnderGraphPills";
import { ExposureToolbar } from "../components/exposure/ExposureToolbar";
import { useFiltersUrlSync } from "../components/exposure/exposureFiltersUrl";
import {
  findAnchor, pickModeAndParams, computeCurve, clipPolylineToPolygon,
  sampleByArcLength, fillByInverseSolve, pointInPolygon,
  type Polygon, type ParamKey, type ModeChoice, type LaserLimits,
  type CurveSample, type FillCell,
} from "../components/exposure/proposeTestMath";
import {
  ExposureProposeRail,
  type RangeReadout,
  type ParamRow,
  type BurnSettings,
} from "../components/exposure/ExposureProposeRail";
import type { LaserParams } from "../laser/laserIndices";
import { HelpTip } from "../components/HelpTip";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_RAW_PARAM_HELP,
} from "../components/exposure/exposureHelpCopy";
import {
  IndexCardBody,
  RawParamCardBody,
} from "../components/exposure/ExposureHelpCardBody";
import { EmptyState, Button, MetalBar } from "../ui";

// ── types ──────────────────────────────────────────────────────────────────

export interface ExposurePageProps {
  materialId: number | null;
}

// ── helpers ────────────────────────────────────────────────────────────────

function fmtR(r: number): string {
  if (!Number.isFinite(r)) return "—";
  return r.toFixed(3);
}

function fmtR2(r2: number): string {
  if (!Number.isFinite(r2)) return "—";
  return r2.toFixed(3);
}

const INDEX_LABELS_MATRIX: Record<IndexRow, string> = {
  pulse_spacing_mm: "PSp",
  line_spacing_mm: "LSp",
  pulse_energy_index: "PEn",
  pulse_intensity_index: "PIn",
  total_exposure_index: "TEx",
  ablation_aggression_index: "AAg",
  delivery_smoothness_index: "DSm",
  duty_cycle_index: "Duty",
};

const RAW_PARAM_LABELS: Record<RawParamRow, string> = {
  power: "PWR",
  speed: "SPD",
  frequency: "FRQ",
  density: "DEN",
  passes: "PSS",
  pulse_width: "PWD",
};

// TODO: pull these from `state/machine.ts` per-machine when v2 ships
//       additional laser profiles. For v1 we hardcode the F2 MOPA
//       COLOR_ENGRAVE limits — the only profile this codebase targets.
const F2_MOPA_LIMITS: LaserLimits = {
  power:     { min: 1,  max: 100,   step: 1 },
  speed:     { min: 2,  max: 15000, step: 1 },
  frequency: { min: 60, max: 500,   step: 1 },
  density:   { min: 1,  max: 5000,  step: 1 },
};

/** Snap a free-precision value to the controller's step + clamp to
 *  [min, max]. The inverse solver in proposeTestMath returns floats
 *  like 249.87 kHz; the machine accepts integer kHz, so we snap
 *  before persisting cell.params. */
function snapToLimits(v: number, range: { min: number; max: number; step: number }): number {
  const snapped = Math.round(v / range.step) * range.step;
  const clamped = Math.min(range.max, Math.max(range.min, snapped));
  // Use toFixed to avoid float dust like 249.9999999999 when step is 1.
  const decimals = Math.max(0, -Math.floor(Math.log10(range.step)));
  return Number(clamped.toFixed(decimals));
}

const PROPOSE_PARAM_LABELS: Record<ParamKey, { name: string; unit: string }> = {
  power:     { name: "POWER",   unit: "%" },
  speed:     { name: "SPEED",   unit: "mm/s" },
  frequency: { name: "FREQ",    unit: "kHz" },
  density:   { name: "DENSITY", unit: "lpc" },
};

// Conservative fallback when the anchor has no source test (or fetch
// fails). Matches the defaults the backend stamps onto fresh validation
// tests. User overrides + source-test inheritance layer on top.
const STATIC_BURN_DEFAULTS: BurnSettings = {
  scan_angle: 90,
  crosshatch: false,
  angle_mode: "fixed",
  unidirectional: false,
};

// ── PARAMS editor (rail) — module-scope domain table ─────────────────────
type ParamRowKey = "power" | "speed" | "frequency" | "density" | "passes" | "pulse_width";

const ALLOWED_PULSE_WIDTHS = [2, 4, 8, 30, 60, 80, 100, 200] as const;

const PARAM_DOMAIN: Record<ParamRowKey, {
  min: number; max: number; step: number; unit: string; presets?: readonly number[];
}> = {
  power:       { min: 1,  max: 100,   step: 1,  unit: "%" },
  speed:       { min: 2,  max: 15000, step: 1,  unit: "mm/s" },
  frequency:   { min: 60, max: 500,   step: 1,  unit: "kHz" },
  density:     { min: 1,  max: 5000,  step: 1,  unit: "lpc" },
  passes:      { min: 1,  max: 99,    step: 1,  unit: "" },
  pulse_width: { min: 2,  max: 200,   step: 1,  unit: "ns", presets: ALLOWED_PULSE_WIDTHS },
};

function buildParamRows(
  base: LaserParams | null,
  effective: ModeChoice | null,
  cells: ReadonlyArray<CurveSample | FillCell>,
): ParamRow[] {
  if (!base) return [];
  const variedSet = new Set<string>(
    effective
      ? effective.mode === "curve"
        ? [effective.varyParam]
        : effective.varyParams
      : [],
  );
  return (Object.keys(PARAM_DOMAIN) as ParamRowKey[]).map((key): ParamRow => {
    const domain = PARAM_DOMAIN[key];
    const anchorValue = base[key as keyof LaserParams] as number;
    if (variedSet.has(key)) {
      const values = cells
        .map((c): number | null => {
          const fill = c as FillCell;
          if (fill.paramValues && key in fill.paramValues) {
            return (fill.paramValues as Record<string, number>)[key];
          }
          const curve = c as CurveSample;
          if (
            curve.paramValue !== undefined &&
            effective?.mode === "curve" &&
            effective.varyParam === key
          ) {
            return curve.paramValue;
          }
          return null;
        })
        .filter((v): v is number => typeof v === "number");
      const minV = values.length ? Math.min(...values) : anchorValue;
      const maxV = values.length ? Math.max(...values) : anchorValue;
      return {
        key,
        kind: "locked",
        resolved: { min: minV, max: maxV },
        anchorValue,
        unit: domain.unit,
      };
    }
    return {
      key,
      kind: "editable",
      value: anchorValue,
      min: domain.min,
      max: domain.max,
      step: domain.step,
      unit: domain.unit,
      presets: domain.presets,
    };
  });
}


// ── component ──────────────────────────────────────────────────────────────

export function ExposurePage({ materialId: propMaterialId }: ExposurePageProps) {
  // ── material + data state ──────────────────────────────────────────────
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialId, setMaterialId] = useState<number | null>(propMaterialId);
  const [rows, setRows] = useState<PaletteEntry[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);

  // ── axis / mode state ──────────────────────────────────────────────────
  const [xKey, setXKey] = useState<IndexRow>("total_exposure_index");
  const [mode, setMode] = useState<ScatterMode>("bivariate");
  const [yKeyUni, setYKeyUni] = useState<ChannelCol>("L");
  const [yKeyBi, setYKeyBi] = useState<IndexRow>("pulse_intensity_index");
  const [xScale, setXScale] = useState<ScaleKind>("log");
  const [yScale, setYScale] = useState<ScaleKind>("log");
  // Hover-preview overrides — set while the user is hovering an option
  // in the X/Y axis pickers, cleared on commit or mouseleave. When set
  // the scatter renders with the preview key in place of the committed
  // xKey/yKey, so the user sees the impact live.
  const [previewXKey, setPreviewXKey] = useState<IndexRow | null>(null);
  const [previewYKey, setPreviewYKey] = useState<ChannelCol | IndexRow | null>(null);
  const [viewport, setViewport] = useState<ScatterViewport | null>(null);
  const [colourField, setColourField] = useState<boolean>(false);
  const [contours, setContours] = useState<boolean>(false);
  const [fadeDots, setFadeDots] = useState<boolean>(false);
  const [cropMode, setCropMode] = useState<boolean>(false);

  // Reset zoom whenever the user changes WHICH axes are on the chart or
  // their scale. The viewport stores bounds in scale-space, so they have
  // no meaning against a new axis or after flipping log↔linear.
  useEffect(() => {
    setViewport(null);
  }, [mode, xKey, yKeyUni, yKeyBi, xScale, yScale, materialId]);

  // ── unified filter state ───────────────────────────────────────────────
  const [filters, setFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);
  useFiltersUrlSync(filters, setFilters);

  const [tests, setTests] = useState<TestSummary[]>([]);

  // ── matrix source tab ─────────────────────────────────────────────────
  const [matrixSource, setMatrixSource] = useState<"indices" | "raw">("indices");

  // ── focus state (mirrors StabilityPage transient/pinned pattern) ───────
  const [transientFocusId, setTransientFocusId] = useState<number | null>(null);
  const [pinnedFocusId, setPinnedFocusId] = useState<number | null>(null);

  const focusedId = transientFocusId ?? pinnedFocusId;

  const handleHover = useCallback((id: number) => {
    setTransientFocusId(id);
  }, []);

  const handleLeave = useCallback(() => {
    setTransientFocusId(null);
  }, []);

  const handleClick = useCallback((id: number) => {
    setTransientFocusId(null);
    setPinnedFocusId((prev) => (prev === id ? null : id));
  }, []);

  const handleBackgroundClear = useCallback(() => {
    setTransientFocusId(null);
    setPinnedFocusId(null);
  }, []);

  // ── derived ─────────────────────────────────────────────────────────────
  const yKey: ChannelCol | IndexRow = mode === "univariate" ? yKeyUni : yKeyBi;
  // Effective keys passed to the scatter. The hover preview wins until
  // the user commits a click or moves out of the picker.
  const effectiveXKey: IndexRow = previewXKey ?? xKey;
  const effectiveYKey: ChannelCol | IndexRow = previewYKey ?? yKey;

  // ── fetch: materials on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    listMaterials()
      .then((mats) => {
        if (cancelled) return;
        setMaterials(mats);
        // If no materialId prop, default to first material
        if (propMaterialId === null && mats.length > 0) {
          setMaterialId(mats[0].id);
        }
      })
      .catch(() => {
        // silently ignore — materials list failure is non-fatal
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep internal materialId in sync if prop changes
  useEffect(() => {
    if (propMaterialId !== null) {
      setMaterialId(propMaterialId);
    }
  }, [propMaterialId]);

  // ── fetch: palette entries + tests in parallel on materialId change ────
  useEffect(() => {
    if (materialId === null) return;
    let cancelled = false;
    setRowsLoading(true);
    setRowsError(null);

    Promise.all([
      listPaletteEntries({ material_id: materialId }),
      listTests({ material_id: materialId }),
    ])
      .then(([entries, fetchedTests]) => {
        if (cancelled) return;
        setRows(entries.filter((e) => e.indices != null));
        setTests(fetchedTests.map((t): TestSummary => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          source_test_id: t.source_test_id ?? null,
          parent_test_id: t.parent_test_id ?? null,
        })));
        setRowsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setRowsError(err instanceof Error ? err.message : "Failed to load palette entries");
        setRowsLoading(false);
      });
    return () => { cancelled = true; };
  }, [materialId]);

  // ── reset focus + filters when material changes ────────────────────────
  useEffect(() => {
    setPinnedFocusId(null);
    setTransientFocusId(null);
    if (materialId !== null) setFilters(DEFAULT_FILTERS);
  }, [materialId]);

  // ── bivariate same-index collapse guard ───────────────────────────────
  useEffect(() => {
    if (mode === "bivariate" && yKeyBi === xKey) {
      // Find the first INDEX_ROWS entry that isn't xKey.
      const next = INDEX_ROWS.find((k) => k !== xKey);
      if (next) setYKeyBi(next);
    }
  }, [mode, xKey, yKeyBi]);

  // ── derived filter chain ───────────────────────────────────────────────
  const testsById = useMemo(
    () => new Map(tests.map((t) => [t.id, t])),
    [tests],
  );

  const filteredRows = useMemo(
    () => applyFilters(rows, filters, testsById),
    [rows, filters, testsById],
  );


  // focusedRow looks up from filteredRows
  const focusedRow = focusedId == null ? null : filteredRows.find((r) => r.id === focusedId) ?? null;

  // Recipe families derived from filtered rows so a power range narrows
  // the families themselves.
  const families = useMemo(() => buildFamilies(filteredRows), [filteredRows]);

  const focusedFamily = useMemo<FamilyMember[] | null>(() => {
    if (focusedId == null) return null;
    let best: FamilyMember[] | null = null;
    for (const members of families.values()) {
      if (members.some((m) => m.row.id === focusedId)) {
        if (
          !best ||
          members.length > best.length ||
          (members.length === best.length &&
            members[0].varyingAxis < best[0].varyingAxis)
        ) {
          best = members;
        }
      }
    }
    return best;
  }, [families, focusedId]);

  // ── all families the focused entry belongs to (for filter buttons) ────
  const focusedAvailableFamilies = useMemo<FamilyMember[][]>(() => {
    if (focusedId == null) return [];
    return Array.from(families.values()).filter((m) =>
      m.some((fm) => fm.row.id === focusedId),
    );
  }, [families, focusedId]);

  // ── member set for the active family filter ────────────────────────────
  const visibleIdsViaFilter = useMemo<Set<number> | null>(() => {
    if (!filters.family) return null;
    for (const members of families.values()) {
      if (
        members.some((m) => m.row.id === filters.family!.anchorRowId) &&
        members[0].varyingAxis === filters.family.axis
      ) {
        return new Set(members.map((m) => m.row.id));
      }
    }
    return null;
  }, [families, filters.family]);

  // ── filtered rows for downstream panels ───────────────────────────────
  const displayRows = useMemo(
    () =>
      visibleIdsViaFilter
        ? filteredRows.filter((r) => visibleIdsViaFilter.has(r.id))
        : filteredRows,
    [filteredRows, visibleIdsViaFilter],
  );

  // ── correlation matrix (derived from displayRows) ─────────────────────
  const correlationMatrix = useMemo(
    () =>
      matrixSource === "indices"
        ? buildCorrelationMatrix(displayRows)
        : buildRawParamCorrelationMatrix(displayRows),
    [displayRows, matrixSource],
  );

  // ── per-axis stats for right-rail hero ────────────────────────────────
  const stats = useMemo(() => {
    const xs = filteredRows.map((r) => (r.indices[xKey] as number | null) ?? NaN);
    let ys: number[];
    if (mode === "univariate") {
      const ch = yKeyUni;
      ys = filteredRows.map((r) => {
        const [l, a, b] = r.lab;
        switch (ch) {
          case "L":      return l;
          case "a":      return a;
          case "b":      return b;
          case "hue":    return Math.atan2(b, a) * (180 / Math.PI);
          case "chroma": return Math.sqrt(a * a + b * b);
        }
      });
    } else {
      ys = filteredRows.map((r) => (r.indices[yKeyBi] as number | null) ?? NaN);
    }
    return {
      pearsonR: pearson(xs, ys),
      spearmanRho: spearman(xs, ys),
      fit: logLinearRegression(xs, ys),
    };
  }, [filteredRows, xKey, mode, yKeyUni, yKeyBi]);

  // ── (currentMaterial available for future use — not shown in top bar) ─

  // ── right-rail active tab (synced to the URL hash query). The four
  //    tabs collect what used to be stacked sections — Info, Filters,
  //    Stats, Color — into a single focused view. ──────────────────────

  // ── propose-test wizard state ─────────────────────────────────────────
  // off      — chip dormant, no overlays
  // drawing  — user is clicking polygon vertices on the scatter
  // panel    — polygon closed; right rail shows the wizard
  type ProposeMode = "off" | "drawing" | "panel";
  const [proposeMode, setProposeMode] = useState<ProposeMode>("off");
  const [polygon, setPolygon] = useState<Polygon>([]);
  const [proposeOverride, setProposeOverride] = useState<ModeChoice | null>(null);
  const [cellCount, setCellCount] = useState(16);
  const [paramOverrides, setParamOverrides] = useState<Partial<Record<ParamRowKey, number>>>({});

  // ── propose-test BURN SETTINGS state ──────────────────────────────────
  // Three-layer cascade like paramOverrides:
  //   static defaults  ◀  source-test defaults  ◀  user overrides
  // sourceBurnDefaults is populated by fetching anchor.test_id's source
  // test on anchor change; burnOverrides captures rail edits. The
  // effective settings flow into the preview memo's crosshatch arg and
  // into handleCreateTest's spec.
  const [sourceBurnDefaults, setSourceBurnDefaults] = useState<Partial<BurnSettings>>({});
  const [burnOverrides, setBurnOverrides] = useState<Partial<BurnSettings>>({});
  const effectiveBurnSettings: BurnSettings = useMemo(() => ({
    ...STATIC_BURN_DEFAULTS,
    ...sourceBurnDefaults,
    ...burnOverrides,
  }), [sourceBurnDefaults, burnOverrides]);

  const { registry, machineId } = useCurrentMachine();

  // ── propose-test derivations ──────────────────────────────────────────
  // The math helpers want IndexKey for both axes — only valid in
  // bivariate mode where yKey is an IndexRow. Cast is safe because the
  // PROPOSE TEST chip is gated on `mode === "bivariate"` and the reset
  // effect below clears polygon state when the user flips to univariate.
  const yKeyForMath = (mode === "bivariate" ? yKeyBi : xKey);

  const anchor = useMemo(
    () => (proposeMode === "off" ? null : findAnchor(polygon, displayRows, xKey, yKeyForMath)),
    [proposeMode, polygon, displayRows, xKey, yKeyForMath],
  );

  const smartDefault = useMemo(() => {
    if (!anchor) return null;
    return pickModeAndParams(anchor, polygon, xKey, yKeyForMath, F2_MOPA_LIMITS);
  }, [anchor, polygon, xKey, yKeyForMath]);

  const effective: ModeChoice | null = proposeOverride ?? smartDefault;

  // Anchor's raw params merged with the user's PARAMS-editor overrides.
  // Both the curve solver and inverse fill consume this — editing a non-
  // varied param rotates the curve / shifts the fill region live.
  const effectiveBaseParams = useMemo<LaserParams | null>(() => {
    if (!anchor || !anchor.params) return null;
    const base = anchor.params as unknown as LaserParams;
    return { ...base, ...paramOverrides } as LaserParams;
  }, [anchor, paramOverrides]);

  // Fetch the anchor's source test so the BURN SETTINGS section can
  // inherit its scan_angle / crosshatch / angle_mode / unidirectional as
  // starting defaults. The user's burnOverrides still win — this just
  // moves the baseline closer to "what generated the anchor sample" so
  // the predicted indices match the burn the user is iterating from.
  useEffect(() => {
    const testId = anchor?.test_id;
    if (testId == null) {
      setSourceBurnDefaults({});
      return;
    }
    let cancelled = false;
    getTest(testId).then((t) => {
      if (cancelled) return;
      const sBase = t.spec.base_params;
      setSourceBurnDefaults({
        scan_angle: typeof sBase?.scan_angle === "number" ? sBase.scan_angle : STATIC_BURN_DEFAULTS.scan_angle,
        crosshatch: !!t.spec.crosshatch,
        angle_mode: (t.spec.angle_mode === "incremental" ? "incremental" : "fixed") as BurnSettings["angle_mode"],
        unidirectional: !!t.spec.unidirectional,
      });
    }).catch(() => {
      // Network/auth failure — leave defaults empty (= static fallbacks apply).
      if (!cancelled) setSourceBurnDefaults({});
    });
    return () => { cancelled = true; };
  }, [anchor?.test_id]);

  // Palette entries currently inside the polygon — count is shown in the
  // rail; coords feed fillByInverseSolve so new cells avoid existing ones.
  const entriesInsidePolygonCoords = useMemo<readonly { x: number; y: number }[]>(() => {
    if (polygon.length < 3) return [];
    return displayRows
      .filter((r) => pointInPolygon(
        [r.indices[xKey] as number, r.indices[yKeyForMath] as number],
        polygon,
      ))
      .map((r) => ({
        x: r.indices[xKey] as number,
        y: r.indices[yKeyForMath] as number,
      }));
  }, [polygon, displayRows, xKey, yKeyForMath]);

  const preview = useMemo<{
    curve: ReadonlyArray<CurveSample> | null;
    cells: ReadonlyArray<CurveSample | FillCell>;
  }>(() => {
    if (!effective || !effectiveBaseParams) return { curve: null, cells: [] };
    if (effective.mode === "curve") {
      const curve = computeCurve(
        effectiveBaseParams, effective.varyParam, xKey, yKeyForMath,
        F2_MOPA_LIMITS, effectiveBurnSettings.crosshatch,
      );
      const segments = clipPolylineToPolygon(curve, polygon);
      const flat = segments.flat();
      if (flat.length === 0) return { curve, cells: [] };
      const sampled = sampleByArcLength(flat, cellCount);
      return { curve, cells: sampled };
    }
    const cells = fillByInverseSolve(
      effectiveBaseParams, effective.varyParams, polygon, xKey, yKeyForMath,
      F2_MOPA_LIMITS, cellCount, entriesInsidePolygonCoords,
      effectiveBurnSettings.crosshatch,
    );
    return { curve: null, cells };
  }, [effective, effectiveBaseParams, polygon, xKey, yKeyForMath, cellCount, entriesInsidePolygonCoords, effectiveBurnSettings.crosshatch]);

  const paramRows = useMemo(
    () => buildParamRows(effectiveBaseParams, effective, preview.cells),
    [effectiveBaseParams, effective, preview.cells],
  );

  const rangeReadout: RangeReadout[] = useMemo(() => {
    if (!effective || preview.cells.length === 0) return [];
    const params: ParamKey[] = effective.mode === "curve"
      ? [effective.varyParam]
      : [...effective.varyParams];
    return params.map((p) => {
      const values = preview.cells
        .map((c) => {
          if (effective.mode === "curve") return (c as CurveSample).paramValue;
          return (c as FillCell).paramValues[p] ?? Number.NaN;
        })
        .filter(Number.isFinite);
      const label = PROPOSE_PARAM_LABELS[p];
      return {
        paramName: label.name,
        min: values.length ? Math.min(...values) : Number.NaN,
        max: values.length ? Math.max(...values) : Number.NaN,
        unit: label.unit,
      };
    });
  }, [effective, preview.cells]);

  // Clear the wizard whenever the data scope or axes change — the
  // polygon was drawn against a specific xKey/yKey/mode/material, so
  // it'd be misleading to keep showing it once any of those flip.
  useEffect(() => {
    setProposeMode("off");
    setPolygon([]);
    setProposeOverride(null);
    setParamOverrides({});
    setBurnOverrides({});
    setSourceBurnDefaults({});
  }, [xKey, yKeyBi, mode, materialId]);

  const handleTogglePerParamFilter = useCallback(
    (param: FilterableParam, value: number) => {
      setFilters((prev) => toggleEqClause(prev, param, value));
      bumpMru(machineId, materialId, param, value);
    },
    [machineId, materialId],
  );

  const handleFilterFromNeighbour = useCallback(
    (row: ExposureRow) => {
      setFilters((prev) => {
        let next = prev;
        for (const k of FILTERABLE_PARAMS) {
          const v = row.params?.[k];
          if (typeof v !== "number" || !Number.isFinite(v)) continue;
          // Replace any existing clauses for the param with a single eq.
          const clauseList: ParamClause[] = [{ kind: "eq", value: v }];
          next = {
            ...next,
            paramClauses: { ...next.paramClauses, [k]: clauseList },
          };
          bumpMru(machineId, materialId, k, v);
        }
        return next;
      });
    },
    [machineId, materialId],
  );

  const hasParamValueFilter = useCallback(
    (param: FilterableParam, value: number) =>
      hasEqClause(filters, param, value),
    [filters],
  );

  // Suppress unused-import warning for addClause — held for future
  // direct-add paths (e.g. drag-to-filter on the chart).
  void addClause;

  const closeProposeWizard = useCallback(() => {
    setProposeMode("off");
    setPolygon([]);
    setProposeOverride(null);
    setParamOverrides({});
    setBurnOverrides({});
    setSourceBurnDefaults({});
  }, []);

  const handleToggleProposeMode = useCallback(() => {
    if (proposeMode === "off") {
      setProposeMode("drawing");
      setPolygon([]);
      setProposeOverride(null);
      setParamOverrides({});
      setBurnOverrides({});
      setSourceBurnDefaults({});
    } else {
      closeProposeWizard();
    }
  }, [proposeMode, closeProposeWizard]);

  const handleCreateTest = useCallback(async () => {
    if (!anchor || !anchor.params || preview.cells.length === 0 || !effective) return;
    if (materialId === null) return;
    if (!effectiveBaseParams) return;
    const baseParamsAnchor = effectiveBaseParams;

    // Build per-cell parameter overrides — a curve mode varies one
    // param along arc-length; a fill samples two params at once.
    //
    // Two cleanups vs. an earlier shape:
    //
    // 1. Write the FULL effective recipe per cell — power, speed,
    //    frequency, density, passes, pulse_width all present, with the
    //    varied params overlaid on the anchor's base. Matches how
    //    palette entries store their recipes, so a single
    //    `validation_cell.params` row is now a complete description of
    //    what the laser will burn. Previously we wrote only the varied
    //    keys, leaving the rest implicit (merged from base at burn
    //    time) — which made the data incomplete when read in isolation.
    //
    // 2. Snap every solved value to the controller's step. The inverse
    //    solver returns floats (e.g. freq=249.87 kHz, speed=2073.72 mm/s);
    //    the laser only accepts the stepped values, so the burn would
    //    round these anyway. Snapping now means the persisted recipe
    //    matches what actually gets burned.
    const fullBase: Record<string, number> = {
      power: baseParamsAnchor.power,
      speed: baseParamsAnchor.speed,
      frequency: baseParamsAnchor.frequency,
      density: baseParamsAnchor.density,
      passes: baseParamsAnchor.passes,
      pulse_width: baseParamsAnchor.pulse_width,
    };
    const validationCells = preview.cells.map((c, i) => {
      const raw: Record<string, number> = effective.mode === "curve"
        ? { [effective.varyParam]: (c as CurveSample).paramValue }
        : { ...(c as FillCell).paramValues } as Record<string, number>;
      const merged: Record<string, number> = { ...fullBase, ...raw };
      const cellParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(merged)) {
        const limit = (F2_MOPA_LIMITS as Record<string, { min: number; max: number; step: number } | undefined>)[k];
        cellParams[k] = limit ? snapToLimits(v, limit) : v;
      }
      return { params: cellParams, index: i };
    });

    const primaryVaryParam: ParamKey = effective.mode === "curve"
      ? effective.varyParam
      : effective.varyParams[0];
    const primaryValues = validationCells
      .map((vc) => vc.params[primaryVaryParam])
      .filter((v): v is number => Number.isFinite(v));
    if (primaryValues.length === 0) return;

    // Resolve a profile so the new test's base_params clamp into the
    // active machine/mode — same shape TestsPage uses for hand-rolled
    // validation tests.
    const machineModeId = machineId === "F2Ultra" ? "color_engrave" : "engrave";
    const profile = getValidationProfile(registry, machineId, machineModeId) ?? undefined;
    const seedSpec: TestSpec = defaultSpec(profile);
    const seedBase = defaultBaseParams(profile);
    const baseParams: BaseParams = {
      ...seedBase,
      power: baseParamsAnchor.power,
      speed: baseParamsAnchor.speed,
      frequency: baseParamsAnchor.frequency,
      density: baseParamsAnchor.density,
      passes: baseParamsAnchor.passes,
      pulse_width: baseParamsAnchor.pulse_width,
      scan_angle: effectiveBurnSettings.scan_angle,
      mode: machineModeId,
    };

    const spec: TestSpec = {
      ...seedSpec,
      x_param: primaryVaryParam as ParamName,
      x_min: Math.min(...primaryValues),
      x_max: Math.max(...primaryValues),
      x_steps: 1,
      y_param: null,
      y_min: null,
      y_max: null,
      y_steps: null,
      rows: 1,
      width_mm: 100,
      height_mm: 8,
      hide_axis_labels: true,
      cells_per_row: validationCells.length,
      crosshatch: effectiveBurnSettings.crosshatch,
      angle_mode: effectiveBurnSettings.angle_mode,
      unidirectional: effectiveBurnSettings.unidirectional,
      base_params: baseParams,
    };

    const labelParam = effective.mode === "curve"
      ? effective.varyParam
      : effective.varyParams.join("+");
    const name = `Propose · ${labelParam} · ${anchor.hex}`;

    try {
      const created = await createTest({
        name,
        material_id: materialId,
        spec,
        machine_id: machineId,
        kind: "validation",
      });
      // Persist the per-cell parameter overrides; the burn ordering is
      // the cells' arc-length order (curve) or stratified pick order
      // (fill) — not L*-sorted, so the visual preview matches the burn.
      await patchValidationCells(created.id, validationCells.map((vc, i) => ({
        cell_index: i,
        palette_entry_id: null,
        expected_hex: anchor.hex,
        expected_lab: anchor.lab as unknown as number[],
        params: vc.params,
      })));
      window.location.hash = `#/tests?new=${created.id}`;
    } catch (e) {
      // Surface this on a helperText slot in the rail in v2; for v1
      // the failure path is the dev console + Sentry.
      console.error("Create test failed:", e);
    }
  }, [anchor, preview.cells, effective, effectiveBaseParams, effectiveBurnSettings, materialId, registry, machineId]);

  // ── render ─────────────────────────────────────────────────────────────

  const currentMaterialName = materials.find((m) => m.id === materialId)?.name;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[color:var(--color-bg)]">

      {/* ── TOP BAR ───────────────────────────────────────────────────── */}
      <header className="shrink-0 px-4 py-2 bg-[color:var(--color-surface)] flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-[14px] font-semibold text-[color:var(--color-ink)] whitespace-nowrap">
          How does the burn relate to laser dose?
        </h1>
        <div className="font-mono text-[10.5px] tabular-nums tracking-[0.06em] text-[color:var(--color-ink-muted)] flex items-baseline gap-2">
          {currentMaterialName && (
            <>
              <span>{currentMaterialName}</span>
              <span className="text-[color:var(--color-ink-subtle)]">·</span>
            </>
          )}
          <span>n = {filteredRows.length}</span>
          <span className="text-[color:var(--color-ink-subtle)]">·</span>
          <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.18em]">v1</span>
        </div>
      </header>
      <MetalBar />

      {/* ── TOOLBAR ───────────────────────────────────────────────────── */}
      <ExposureToolbar
        materials={materials}
        materialId={materialId}
        onMaterialChange={setMaterialId}
        mode={mode}
        onModeChange={setMode}
        xKey={xKey}
        yKey={mode === "univariate" ? yKeyUni : yKeyBi}
        xScale={xScale}
        yScale={yScale}
        onXKeyChange={setXKey}
        onYKeyChange={(k) => {
          if (mode === "univariate") setYKeyUni(k as ChannelCol);
          else setYKeyBi(k as IndexRow);
        }}
        onXScaleChange={setXScale}
        onYScaleChange={setYScale}
        onXKeyPreview={(k) => setPreviewXKey(k as IndexRow | null)}
        onYKeyPreview={setPreviewYKey}
        proposeOpen={proposeMode !== "off"}
        onToggleProposeMode={handleToggleProposeMode}
        proposeAvailable={mode === "bivariate"}
      />

      {/* ── PILL BAR (active filter chips) ────────────────────────────── */}
      <div className="px-4 pt-2 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)]">
        <ExposureFilterPills
          filters={filters}
          entryCount={displayRows.length}
          onChange={setFilters}
          onClearAll={() => setFilters(DEFAULT_FILTERS)}
        />
      </div>

      {/* ── BODY ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden gap-4 px-4 py-4">

        {/* ── LEFT RAIL — Filter Stack ─────────────────────────────────── */}
        {!rowsLoading && !rowsError && filteredRows.length > 0 && proposeMode !== "panel" && (
          <aside
            style={{ width: 300 }}
            className="shrink-0 flex flex-col gap-4 border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto overflow-x-hidden"
          >
            <ExposureFilterStack
              filters={filters}
              onChange={setFilters}
              tests={tests}
              machineId={machineId}
              materialId={materialId}
              entryCount={displayRows.length}
              totalCount={rows.length}
            />
          </aside>
        )}

        {/* ── MAIN COLUMN ───────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto">
          {rowsLoading ? (
            <div className="flex items-center justify-center h-64">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] animate-pulse">
                Loading entries…
              </span>
            </div>
          ) : rowsError ? (
            <EmptyState
              title="Failed to load entries"
              description={rowsError}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setRowsError(null);
                    if (materialId !== null) {
                      setRowsLoading(true);
                      Promise.all([
                        listPaletteEntries({ material_id: materialId }),
                        listTests({ material_id: materialId }),
                      ])
                        .then(([entries, fetchedTests]) => {
                          setRows(entries.filter((e) => e.indices != null));
                          setTests(fetchedTests.map((t): TestSummary => ({
                            id: t.id,
                            name: t.name,
                            kind: t.kind,
                            source_test_id: t.source_test_id ?? null,
                            parent_test_id: t.parent_test_id ?? null,
                          })));
                          setRowsLoading(false);
                        })
                        .catch((err) => {
                          setRowsError(err instanceof Error ? err.message : "Failed to load");
                          setRowsLoading(false);
                        });
                    }
                  }}
                >
                  Retry
                </Button>
              }
            />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              title={materialId === null ? "Pick a material" : "No exposure data yet"}
              description={
                materialId === null
                  ? "Choose a material from the toolbar to explore how its palette colours map to laser dose."
                  : "This material has no palette entries with computed exposure indices. Burn a few cells, save them, then return."
              }
            />
          ) : (
            <>
              {/* Scatter — hero. flex-1 lets it absorb whatever vertical
                  slack the under-chart rows leave; minHeight 220px keeps
                  the chart legible at the worst case. */}
              <div
                className="relative rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] p-4 flex-1 flex flex-col"
                style={{ minHeight: 220 }}
                onClick={handleBackgroundClear}
              >
                {proposeMode === "drawing" && (
                  <div
                    className={
                      "absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white rounded-sm shadow-md " +
                      (polygon.length >= 3
                        ? "bg-[color:var(--color-primary)] cursor-pointer"
                        : "bg-[color:var(--color-primary)]/70 pointer-events-none")
                    }
                    onClick={polygon.length >= 3
                      ? (e) => {
                          e.stopPropagation();
                          setProposeMode("panel");
                        }
                      : undefined}
                    role={polygon.length >= 3 ? "button" : undefined}
                  >
                    {polygon.length === 0
                      ? "Click vertices · ENTER or double-click to close · ESC cancels"
                      : polygon.length < 3
                        ? `Click ${3 - polygon.length} more vertices · ESC cancels`
                        : `✓ Click here to finish · ENTER or double-click also works · ESC cancels`}
                  </div>
                )}
                {cropMode && proposeMode !== "drawing" && (
                  <div
                    className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white rounded-sm shadow-md bg-[color:var(--color-primary)] pointer-events-none"
                  >
                    Drag to crop · ESC cancels
                  </div>
                )}
                <ExposureScatter
                  rows={displayRows}
                  mode={mode}
                  xKey={effectiveXKey}
                  yKey={effectiveYKey}
                  xScale={xScale}
                  yScale={yScale}
                  focusedId={focusedId}
                  onHover={handleHover}
                  onLeave={handleLeave}
                  onClick={handleClick}
                  family={focusedFamily ?? undefined}
                  trimOutliers={filters.trimOutliers}
                  onXKeyChange={setXKey}
                  onYKeyChange={(k) => {
                    if (mode === "univariate") setYKeyUni(k as ChannelCol);
                    else setYKeyBi(k as IndexRow);
                  }}
                  onXScaleChange={setXScale}
                  onYScaleChange={setYScale}
                  polygon={polygon}
                  polygonDrawing={proposeMode === "drawing"}
                  curve={preview.curve?.map((p) => ({ x: p.x, y: p.y })) ?? null}
                  cells={preview.cells.map((c) => ({ x: c.x, y: c.y }))}
                  onPolygonVertexAdd={(p) => setPolygon((prev) => [...prev, p])}
                  onPolygonVertexMove={(i, p) => setPolygon((prev) =>
                    prev.map((v, idx) => (idx === i ? p : v)),
                  )}
                  onPolygonClose={() => {
                    if (polygon.length >= 3) setProposeMode("panel");
                  }}
                  onPolygonCancel={closeProposeWizard}
                  viewport={viewport}
                  onViewportChange={setViewport}
                  showColourField={colourField}
                  showContours={contours}
                  fadeDots={fadeDots}
                  cropMode={cropMode}
                  onCropModeChange={setCropMode}
                />
              </div>

              {/* Under-graph pill bar — one-click toggles that always
                  live in the chart's gravitational field rather than
                  buried in the Filters tab. */}
              <ExposureUnderGraphPills
                filters={filters}
                onChange={setFilters}
                cropMode={cropMode}
                onCropModeChange={setCropMode}
              />

              {/* Stats hero echo — always-glanceable headline of the
                  three numbers users actually skim. Full breakdown lives
                  in the Stats rail tab. */}
              <div className="flex items-center gap-4 px-1 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)]">
                <span>
                  <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.16em] mr-1.5">r</span>
                  <span className="text-[color:var(--color-primary)] font-semibold">{fmtR(stats.pearsonR)}</span>
                </span>
                <span>
                  <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.16em] mr-1.5">ρ</span>
                  {fmtR(stats.spearmanRho)}
                </span>
                <span>
                  <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.16em] mr-1.5">R²</span>
                  {fmtR2(stats.fit.r2)}
                </span>
                <span>
                  <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.16em] mr-1.5">n</span>
                  {stats.fit.n}
                </span>
              </div>

            </>
          )}
        </main>

        {/* ── RIGHT RAIL ────────────────────────────────────────────────── */}
        <aside
          style={{ width: proposeMode === "panel" ? 300 : 280 }}
          className="shrink-0 flex flex-col gap-4 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto overflow-x-hidden min-w-0"
        >
          {proposeMode === "panel" ? (
            <ExposureProposeRail
              anchor={anchor}
              entriesInsidePolygon={entriesInsidePolygonCoords.length}
              mode={effective ?? { mode: "curve", varyParam: "power" }}
              onModeChange={setProposeOverride}
              cellCount={cellCount}
              onCellCountChange={setCellCount}
              paramRows={paramRows}
              onParamOverrideChange={(key, value) => {
                setParamOverrides((prev) => ({ ...prev, [key]: value }));
              }}
              hasParamOverrides={
                Object.keys(paramOverrides).length > 0
                || Object.keys(burnOverrides).length > 0
              }
              onResetParams={() => {
                setParamOverrides({});
                setBurnOverrides({});
              }}
              burnSettings={effectiveBurnSettings}
              onBurnSettingChange={(key, value) => {
                setBurnOverrides((prev) => ({ ...prev, [key]: value }));
              }}
              rangeReadout={rangeReadout}
              canCreate={anchor !== null && preview.cells.length > 0}
              helperText={
                anchor === null
                  ? "Polygon contains no entries"
                  : preview.cells.length === 0
                    ? "Couldn't fit any cells — try a different param or redraw"
                    : preview.cells.length < cellCount
                      ? `Only ${preview.cells.length} of ${cellCount} cells fit — region too small for the chosen params`
                      : null
              }
              onCreate={handleCreateTest}
              onCancel={closeProposeWizard}
            />
          ) : (
            <>
              {/* Focus + Recipe */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <RailHeading>
                    {pinnedFocusId != null ? "Pinned" : "Focus"}
                  </RailHeading>
                  {focusedId != null && (
                    <button
                      type="button"
                      onClick={handleBackgroundClear}
                      className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink-muted)] transition-colors"
                      title={pinnedFocusId != null ? "Unpin" : "Clear hover"}
                    >
                      clear
                    </button>
                  )}
                </div>
                <MetalBar variant="soft" className="mb-3" />
                <ExposureFocusedCard
                  rows={displayRows}
                  focusedId={focusedId}
                  focusedFamily={focusedFamily}
                  availableFamilies={focusedAvailableFamilies}
                  activeFilterAxis={filters.family?.axis ?? null}
                  onSetFilter={(axis, anchorRowId) =>
                    setFilters((prev) => ({ ...prev, family: { axis, anchorRowId } }))}
                  onClearFilter={() =>
                    setFilters((prev) => ({ ...prev, family: null }))}
                  hasParamValueFilter={hasParamValueFilter}
                  onTogglePerParamFilter={handleTogglePerParamFilter}
                />
              </section>

              {/* Indices */}
              <section>
                <RailHeading>Indices</RailHeading>
                <MetalBar variant="soft" className="mb-3" />
                <ExposureFocusedIndices row={focusedRow} />
              </section>

              {/* Neighbours */}
              <section>
                <RailHeading>Neighbours</RailHeading>
                <MetalBar variant="soft" className="mb-3" />
                {focusedRow ? (
                  <ExposureNeighboursPanel
                    anchor={focusedRow}
                    candidates={displayRows}
                    onSelectNeighbour={(id) => {
                      setTransientFocusId(null);
                      setPinnedFocusId(id);
                    }}
                    onFilterFromNeighbour={handleFilterFromNeighbour}
                  />
                ) : (
                  <p className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">
                    Focus an entry to see its neighbours.
                  </p>
                )}
              </section>

              {/* Stats */}
              <section>
                <RailHeading>Stats</RailHeading>
                <MetalBar variant="soft" className="mb-3" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
                    Pearson r
                  </span>
                  <span
                    className="font-mono text-[24px] leading-none tabular-nums text-[color:var(--color-primary)] font-semibold"
                    title="Linear correlation between X and Y"
                  >
                    {fmtR(stats.pearsonR)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 font-mono mt-2">
                  <SubStat label="Spearman ρ" value={fmtR(stats.spearmanRho)} />
                  <SubStat label="R²" value={fmtR2(stats.fit.r2)} />
                  <SubStat
                    label="Slope"
                    value={Number.isFinite(stats.fit.slope) ? stats.fit.slope.toFixed(3) : "—"}
                  />
                  <SubStat label="n" value={String(stats.fit.n)} />
                </div>
              </section>

              {/* Correlations */}
              <section>
                <RailHeading>Correlations</RailHeading>
                <MetalBar variant="soft" className="mb-3" />
                <div className="flex gap-1 mb-2">
                  <button
                    type="button"
                    onClick={() => setMatrixSource("indices")}
                    className={
                      "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
                      (matrixSource === "indices"
                        ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                        : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
                    }
                  >
                    Indices
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatrixSource("raw")}
                    className={
                      "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
                      (matrixSource === "raw"
                        ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                        : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
                    }
                  >
                    Raw params
                  </button>
                </div>
                {matrixSource === "indices" ? (
                  <ExposureCorrelationMatrix<IndexRow>
                    matrix={correlationMatrix}
                    rowKeys={INDEX_ROWS}
                    rowLabels={INDEX_LABELS_MATRIX}
                    selectedRowKey={xKey}
                    selectedChannel={mode === "univariate" ? yKeyUni : "L"}
                    onSelect={(idx, ch) => {
                      setXKey(idx);
                      if (mode === "univariate") setYKeyUni(ch);
                    }}
                    renderRowLabel={(rowKey, label) => (
                      <HelpTip
                        help={EXPOSURE_INDEX_HELP[rowKey]}
                        Body={IndexCardBody}
                      >
                        <span className="cursor-help">{label}</span>
                      </HelpTip>
                    )}
                  />
                ) : (
                  <ExposureCorrelationMatrix<RawParamRow>
                    matrix={correlationMatrix}
                    rowKeys={RAW_PARAM_ROWS}
                    rowLabels={RAW_PARAM_LABELS}
                    selectedRowKey={null}
                    selectedChannel={null}
                    onSelect={null}
                    renderRowLabel={(rowKey, label) => (
                      <HelpTip
                        help={EXPOSURE_RAW_PARAM_HELP[rowKey]}
                        Body={RawParamCardBody}
                      >
                        <span className="cursor-help">{label}</span>
                      </HelpTip>
                    )}
                  />
                )}
              </section>

              {/* Overlays */}
              <section>
                <RailHeading>Scatter overlays</RailHeading>
                <MetalBar variant="soft" className="mb-3" />
                <div className="flex flex-col gap-2">
                  <OverlayToggle
                    label="▦  Colour field"
                    help="Inverse-distance-weighted blend of the 12 nearest dots' measured hex values."
                    checked={colourField}
                    onToggle={() => setColourField((v) => !v)}
                    disabled={mode !== "bivariate"}
                    disabledReason="Bivariate mode only"
                  />
                  <OverlayToggle
                    label="◷  Contours · L*"
                    help="Marching-squares iso-L* lines over a kNN-interpolated grid."
                    checked={contours}
                    onToggle={() => setContours((v) => !v)}
                    disabled={mode !== "bivariate"}
                    disabledReason="Bivariate mode only"
                  />
                  <OverlayToggle
                    label="◯  Fade dots"
                    help="Drops palette dots to ~28% so the overlays above read clearly."
                    checked={fadeDots}
                    onToggle={() => setFadeDots((v) => !v)}
                  />
                </div>
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── Right-rail primitives ──────────────────────────────────────────────── */

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mb-1.5">
      {children}
    </div>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="text-[13px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

/* ── Color-tab overlay toggle row ──────────────────────────────────────── */

function OverlayToggle({
  label, help, checked, onToggle, disabled, disabledReason,
}: {
  label: string;
  help: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      title={disabled ? disabledReason : help}
      className={
        "flex items-center gap-2.5 px-2 py-1.5 rounded-sm border text-left transition-colors " +
        (disabled
          ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] opacity-50 cursor-not-allowed"
          : checked
            ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink)] hover:border-[color:var(--color-primary)]")
      }
    >
      <span
        aria-hidden
        className={
          "inline-block w-3 h-3 flex-none rounded-sm border " +
          (disabled
            ? "border-[color:var(--color-border-strong)] bg-transparent"
            : checked
              ? "border-white bg-white"
              : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]")
        }
      >
        {checked && !disabled && (
          <svg viewBox="0 0 10 10" className="w-3 h-3">
            <path d="M2 5.5l2 2 4-4.5" fill="none" stroke="var(--color-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="flex-1 font-mono text-[10.5px] uppercase tracking-[0.14em]">{label}</span>
    </button>
  );
}

