import * as React from "react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { listMaterials } from "../api/library";
import { listPaletteEntries } from "../api/palette";
import { listTests } from "../api/tests";
import type { Material } from "../library";
import type { PaletteEntry } from "../types";
import {
  ExposureScatter,
  type ScaleKind,
  type ScatterMode,
} from "../components/exposure/ExposureScatter";
import { ExposureHueRibbon } from "../components/exposure/ExposureHueRibbon";
import { ExposureCorrelationMatrix } from "../components/exposure/ExposureCorrelationMatrix";
import { ExposureRangeBrush } from "../components/exposure/ExposureRangeBrush";
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
  applyFilters, dataRanges, DEFAULT_FILTERS,
  FILTERABLE_PARAMS,
  type ActiveFilters,
  type FilterableParam,
  type TestSummary,
} from "../components/exposure/exposureFilters";
import { ExposureFilterPanel } from "../components/exposure/ExposureFilterPanel";
import { ExposureFilterPills, type ClearKey } from "../components/exposure/ExposureFilterPills";
import { ExposureFocusedIndices } from "../components/exposure/ExposureFocusedIndices";
import { ExposureToolbar } from "../components/exposure/ExposureToolbar";
import { useFiltersUrlSync } from "../components/exposure/exposureFiltersUrl";
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
};

const RAW_PARAM_LABELS: Record<RawParamRow, string> = {
  power: "PWR",
  speed: "SPD",
  frequency: "FRQ",
  density: "DEN",
  passes: "PSS",
  pulse_width: "PWD",
};

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function activeParamFilterKeys(filters: ActiveFilters): ReadonlySet<FilterableParam> {
  const out = new Set<FilterableParam>();
  for (const k of FILTERABLE_PARAMS) {
    const r = filters.paramRanges[k];
    if (r && (r.min != null || r.max != null)) out.add(k);
  }
  return out;
}

function countActiveFilters(filters: ActiveFilters): number {
  let n = 0;
  if (!setsEqual(filters.sources, DEFAULT_FILTERS.sources)) n++;
  if (filters.validatedOnly) n++;
  if (filters.testId != null) n++;
  if (filters.testKind !== "all") n++;
  if (filters.family) n++;
  if (filters.brushRange) n++;
  for (const k of FILTERABLE_PARAMS) {
    const r = filters.paramRanges[k];
    if (r && (r.min != null || r.max != null)) n++;
  }
  return n;
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

  // ranges derived from unfiltered rows so sliders span full data extent
  const ranges = useMemo(() => dataRanges(rows), [rows]);

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

  // ── filter panel open/closed (toggled by toolbar Filters button) ──────
  const [filtersOpen, setFiltersOpen] = useState(false);

  const handleTogglePerParamFilter = useCallback(
    (param: FilterableParam, value: number) => {
      setFilters((prev) => {
        const r = prev.paramRanges[param];
        const exact = r != null && r.min === value && r.max === value;
        if (exact) {
          const next = { ...prev.paramRanges };
          delete next[param];
          return { ...prev, paramRanges: next };
        }
        return {
          ...prev,
          paramRanges: { ...prev.paramRanges, [param]: { min: value, max: value } },
        };
      });
    },
    [],
  );

  const handleFilterFromNeighbour = useCallback(
    (row: ExposureRow) => {
      setFilters((prev) => {
        const next = { ...prev.paramRanges };
        for (const k of FILTERABLE_PARAMS) {
          const v = row.params?.[k];
          if (typeof v === "number" && Number.isFinite(v)) {
            next[k] = { min: v, max: v };
          }
        }
        return { ...prev, paramRanges: next };
      });
    },
    [],
  );

  const handleClearOne = useCallback((key: ClearKey) => {
    setFilters((prev) => {
      if (key === "sources") return { ...prev, sources: DEFAULT_FILTERS.sources };
      if (key === "validated") return { ...prev, validatedOnly: false };
      if (key === "testId") return { ...prev, testId: null, testLineage: new Set() };
      if (key === "testKind") return { ...prev, testKind: "all" };
      if (key === "family") return { ...prev, family: null };
      if (key === "brush") return { ...prev, brushRange: null };
      if (key.startsWith("range:")) {
        const k = key.slice("range:".length) as FilterableParam;
        const next = { ...prev.paramRanges };
        delete next[k];
        return { ...prev, paramRanges: next };
      }
      return prev;
    });
  }, []);

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
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        activeFilterCount={countActiveFilters(filters)}
      />

      {/* ── PILL BAR (active filter chips) ────────────────────────────── */}
      <div className="px-4 pt-2 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)]">
        <ExposureFilterPills
          filters={filters}
          entryCount={displayRows.length}
          onClearOne={handleClearOne}
          onClearAll={() => setFilters(DEFAULT_FILTERS)}
        />
      </div>

      {/* ── BODY ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden gap-4 px-4 py-4">

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
              {/* Scatter — hero */}
              <div
                className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] p-4"
                onClick={handleBackgroundClear}
              >
                <ExposureScatter
                  rows={displayRows}
                  mode={mode}
                  xKey={xKey}
                  yKey={yKey}
                  xScale={xScale}
                  yScale={yScale}
                  focusedId={focusedId}
                  onHover={handleHover}
                  onLeave={handleLeave}
                  onClick={handleClick}
                  dimRange={filters.brushRange}
                  family={focusedFamily ?? undefined}
                  trimOutliers={filters.trimOutliers}
                  onXKeyChange={setXKey}
                  onYKeyChange={(k) => {
                    if (mode === "univariate") setYKeyUni(k as ChannelCol);
                    else setYKeyBi(k as IndexRow);
                  }}
                  onXScaleChange={setXScale}
                  onYScaleChange={setYScale}
                />
              </div>

              {/* Hue ribbon + exposure range (left) | correlation matrix (right) */}
              <div className="flex gap-4 items-stretch">
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                  <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 flex-1 min-h-0 flex flex-col">
                    <PanelLabel title="Hue ribbon" subtitle={`ordered by ${xKey}`} />
                    <div className="flex-1 min-h-0 flex items-center">
                      <div className="w-full">
                        <ExposureHueRibbon
                          rows={displayRows}
                          orderBy={xKey}
                          focusedId={focusedId}
                          onHover={handleHover}
                          onLeave={handleLeave}
                          onClick={handleClick}
                          dimRange={filters.brushRange}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 flex-1 min-h-0 flex flex-col">
                    <PanelLabel title="Exposure range" subtitle="total_exposure_index, log scale" />
                    <div className="flex-1 min-h-0 flex items-center">
                      <div className="w-full">
                        <ExposureRangeBrush
                          rows={displayRows}
                          range={filters.brushRange}
                          onRangeChange={(r) => setFilters((prev) => ({ ...prev, brushRange: r }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
                  <PanelLabel title="Correlations" subtitle="|r| heatmap" />
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
                </div>
              </div>
            </>
          )}
        </main>

        {/* ── FILTERS RAIL (toggleable via toolbar) ─────────────────────── */}
        {filtersOpen && (
          <aside
            style={{ width: 240 }}
            className="shrink-0 flex flex-col gap-4 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto"
          >
            <section>
              <RailHeading>Filters</RailHeading>
              <MetalBar variant="soft" className="mb-3" />
              <ExposureFilterPanel
                filters={filters}
                onChange={setFilters}
                tests={tests}
                dataRanges={ranges}
              />
            </section>
          </aside>
        )}

        {/* ── RIGHT RAIL ────────────────────────────────────────────────── */}
        <aside
          style={{ width: 240 }}
          className="shrink-0 flex flex-col gap-4 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto"
        >
          <section>
            <RailHeading>Stats</RailHeading>
            <MetalBar variant="soft" className="mb-3" />

            {/* Hero r = */}
            <div className="flex flex-col gap-0.5 mb-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
                Pearson r
              </span>
              <span
                className="font-mono text-[28px] leading-none tabular-nums text-[color:var(--color-primary)] font-semibold"
                title="Linear correlation between X and Y, computed on log-X if log scale is on"
              >
                {fmtR(stats.pearsonR)}
              </span>
            </div>

            {/* Sub-stats — denser stack */}
            <div className="grid grid-cols-2 gap-y-2 gap-x-3 font-mono">
              <SubStat label="Spearman ρ" value={fmtR(stats.spearmanRho)} />
              <SubStat label="R² (log·lin)" value={fmtR2(stats.fit.r2)} />
              <SubStat
                label="Slope"
                value={Number.isFinite(stats.fit.slope) ? stats.fit.slope.toFixed(3) : "—"}
              />
              <SubStat label="n" value={String(stats.fit.n)} />
            </div>

            {mode === "bivariate" && (
              <p className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)] leading-relaxed mt-3">
                No Y outcome — bivariate r is between two indices, not a fit quality.
              </p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-1.5">
              <RailHeading>
                {pinnedFocusId != null ? "Pinned" : "Focused"}
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
              highlightIndex={xKey}
              onDiscHover={handleHover}
              onDiscLeave={handleLeave}
              onDiscClick={handleClick}
              dimRange={filters.brushRange}
              focusedFamily={focusedFamily}
              availableFamilies={focusedAvailableFamilies}
              activeFilterAxis={filters.family?.axis ?? null}
              onSetFilter={(axis, anchorRowId) =>
                setFilters((prev) => ({ ...prev, family: { axis, anchorRowId } }))}
              onClearFilter={() =>
                setFilters((prev) => ({ ...prev, family: null }))}
              activeParamFilters={activeParamFilterKeys(filters)}
              onTogglePerParamFilter={handleTogglePerParamFilter}
            />
          </section>

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

          <section>
            <RailHeading>Indices</RailHeading>
            <MetalBar variant="soft" className="mb-3" />
            <ExposureFocusedIndices row={focusedRow} />
          </section>
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

/* ── Main-column panel label ───────────────────────────────────────────── */

function PanelLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
        {title}
      </span>
      {subtitle && (
        <span className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] truncate">
          {subtitle}
        </span>
      )}
    </div>
  );
}
