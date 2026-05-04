import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listMaterials } from "../api/library";
import { listResults } from "../api/results";
import { getTest, listTests } from "../api/tests";
import {
  StabilityChart,
  type ChartMode,
  type FocusedCell,
  type FocusSource,
  type XAxis,
  type YAxis,
} from "../components/StabilityChart";
import {
  fitAffineTransform,
  type AffineTransform,
} from "../components/stabilityCalibrateMath";
import { StabilityFocusedCellPanel } from "../components/StabilityFocusedCellPanel";
import { StabilityPicker } from "../components/StabilityPicker";
import { StabilityResultModal } from "../components/StabilityResultModal";
import { StabilityStats } from "../components/StabilityStats";
import type { Material } from "../library";
import { useRoute } from "../router";
import { getCurrentMachineId } from "../state/machine";
import type { Lab } from "../color/math";
import type { ResultRecord, TestRecord } from "../types";

/**
 * Top-level Stability page. The base test carries the expected
 * palette; selected results layer measured engravings on top so the
 * user can spot consistent deviation vectors (a hue rotation, a
 * brightness shift) and decide whether their burn needs a global
 * correction.
 *
 * Three columns: picker rail (left), chart canvas (centre), stat
 * strip (right). The chart and stats both consume the same
 * cell × result matrix and stay in lockstep — clicking a worst-cell
 * link in the stats strip pulses the matching cell in the chart.
 */
export function StabilityPage() {
  const [route, navigate] = useRoute();
  const routeId = route.name === "stability" ? route.id : undefined;

  const [materials, setMaterials] = useState<Material[]>([]);
  const [tests, setTests] = useState<TestRecord[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<number | undefined>(routeId);

  // Cache base-test detail (with validation_cells) by id so re-selection
  // is instant. The list endpoint also carries validation_cells, so
  // first-pass selection rarely needs another round-trip.
  const [testDetail, setTestDetail] = useState<TestRecord | null>(null);

  const [results, setResults] = useState<ResultRecord[] | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | undefined>();

  const [selectedResultIds, setSelectedResultIds] = useState<number[]>([]);

  // Cache of full result records (with swatches). Keyed by id so
  // tick/untick stays cheap.
  const [resultCache, setResultCache] = useState<Record<number, ResultRecord>>(
    {},
  );
  const [yAxis, setYAxis] = useState<YAxis>("delta_hue");
  const [xAxis, setXAxis] = useState<XAxis>("expected_hue");
  const [chartMode, setChartMode] = useState<ChartMode>("scatter");
  // Calibrate state. ``referenceResultId === null`` means "fall back
  // to the first selected result"; the chart resolves the default
  // there. ``applyToChart`` is the toggle that pipes the fitted
  // transform back through SCATTER / SPATIAL / SPECTRUMS.
  const [referenceResultId, setReferenceResultId] = useState<number | null>(
    null,
  );
  const [applyToChart, setApplyToChart] = useState(false);

  // Unified focused-cell state. Conceptually one slot read by every
  // view, but stored as two independent buckets so a transient hover
  // can momentarily overshadow a pinned cell without clobbering it —
  // when the cursor leaves the hovered surface, the pinned focus
  // re-asserts. The exposed `focusedCell` collapses both into the
  // shape consumers care about: transient wins, pinned is the
  // fallback, null when both are empty.
  const [pinnedCell, setPinnedCell] = useState<
    { cellIndex: number; source: FocusSource } | null
  >(null);
  const [transientCell, setTransientCell] = useState<
    { cellIndex: number; source: FocusSource } | null
  >(null);

  // Per-result modal: id of the result whose warped photo + stats are
  // currently visible. Lifted to the page so the modal survives focus
  // toggles further down the strip. ``null`` = closed.
  const [selectedResultIdForModal, setSelectedResultIdForModal] =
    useState<number | null>(null);

  // Priority: pinned beats transient. The earlier order (transient
  // first) caused the user-reported bug where clicking a cell to pin
  // it, then moving the cursor over a neighbouring cell, silently
  // moved the cross-view highlight to the neighbour — making "click
  // to investigate this cell" feel slippery. Pinned wins everywhere
  // except its own source view's cursor-tracked tooltip, which the
  // child components handle locally without touching this slot.
  const focusedCell: FocusedCell = useMemo(() => {
    if (pinnedCell) {
      return {
        kind: "pinned",
        cellIndex: pinnedCell.cellIndex,
        source: pinnedCell.source,
      };
    }
    if (transientCell) {
      return {
        kind: "transient",
        cellIndex: transientCell.cellIndex,
        source: transientCell.source,
      };
    }
    return null;
  }, [transientCell, pinnedCell]);

  // Esc anywhere on the page clears every focus state. Cheap window
  // listener — the page only mounts once so we don't need to debounce.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTransientCell(null);
        setPinnedCell(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Switching base test → drop focus. The cell index is meaningless on
  // a different test's grid; the modal ties to a specific result id so
  // it would point at a row from the wrong test once the picker
  // changes.
  useEffect(() => {
    setTransientCell(null);
    setPinnedCell(null);
    setSelectedResultIdForModal(null);
  }, [selectedTestId]);

  // Load materials + validation tests on mount; if a test id arrived
  // via the URL, ensure we hydrate its detail. Otherwise pre-select
  // the most-recent.
  useEffect(() => {
    listMaterials()
      .then(setMaterials)
      .catch(() => {});
    listTests({ machine_id: getCurrentMachineId() })
      .then((all) => {
        const validation = all.filter((t) => t.kind === "validation");
        setTests(validation);
        if (selectedTestId == null && validation.length > 0) {
          // Newest first — backend sorts by created_at DESC.
          setSelectedTestId(validation[0].id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate the selected test's detail (validation_cells) from cache
  // when possible, else refetch. The list endpoint already carries
  // validation_cells server-side; this protects against a future
  // partial response without forcing a second round trip up-front.
  useEffect(() => {
    if (selectedTestId == null) {
      setTestDetail(null);
      return;
    }
    const fromList = tests.find((t) => t.id === selectedTestId);
    if (fromList && fromList.validation_cells.length > 0) {
      setTestDetail(fromList);
      return;
    }
    getTest(selectedTestId)
      .then(setTestDetail)
      .catch(() => setTestDetail(null));
  }, [selectedTestId, tests]);

  // Load results when the base test changes; reset the comparison set.
  useEffect(() => {
    setSelectedResultIds([]);
    if (selectedTestId == null) {
      setResults(null);
      return;
    }
    setResultsLoading(true);
    setResultsError(undefined);
    listResults(selectedTestId)
      .then((r) => {
        // ``listResults`` returns full records with ``swatches`` already
        // populated, so we can seed the cache up-front and skip the
        // per-id round-trip the page used to do.
        const sorted = [...r].sort(
          (a, b) =>
            new Date(b.uploaded_at).getTime() -
            new Date(a.uploaded_at).getTime(),
        );
        setResults(sorted);
        setResultCache((prev) => {
          const next = { ...prev };
          for (const rec of sorted) next[rec.id] = rec;
          return next;
        });
        // Tick every result by default — multi-lighting-angle uploads
        // are the common case for validation, and the BURN-vs-CAMERA
        // split + σ stats are only meaningful with ≥2 runs anyway.
        // Users can untick the ones they don't want.
        if (sorted.length > 0) {
          setSelectedResultIds(sorted.map((r) => r.id));
        }
      })
      .catch((e) => setResultsError((e as Error).message))
      .finally(() => setResultsLoading(false));
  }, [selectedTestId]);

  const onToggleResult = useCallback((id: number) => {
    setSelectedResultIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  // Keep the URL in sync so links survive reloads / sharing.
  useEffect(() => {
    if (selectedTestId == null) {
      if (route.name === "stability" && route.id != null) {
        navigate({ name: "stability" });
      }
      return;
    }
    if (route.name !== "stability" || route.id !== selectedTestId) {
      navigate({ name: "stability", id: selectedTestId });
    }
  }, [selectedTestId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the chart series + stats input from the cache.
  const chartSeries = useMemo(() => {
    if (!testDetail) return [];
    const out: {
      resultId: number;
      label: string;
      cells: Map<number, { hex: string; lab: Lab }>;
    }[] = [];
    const cellsPerRow = inferCellsPerRow(testDetail);
    if (cellsPerRow == null) return out;
    for (const id of selectedResultIds) {
      const r = resultCache[id];
      if (!r) continue;
      const cells = new Map<number, { hex: string; lab: Lab }>();
      for (const sw of r.swatches) {
        const idx = sw.row * cellsPerRow + sw.col;
        if (!Array.isArray(sw.lab) || sw.lab.length !== 3) continue;
        cells.set(idx, {
          hex: sw.hex,
          lab: [sw.lab[0], sw.lab[1], sw.lab[2]],
        });
      }
      out.push({
        resultId: id,
        label: shortStamp(r.uploaded_at),
        cells,
      });
    }
    return out;
  }, [testDetail, selectedResultIds, resultCache]);

  const statsSeries = useMemo(() => {
    return chartSeries
      .map((s) => {
        const r = resultCache[s.resultId];
        if (!r) return null;
        return { result: r, cells: s.cells, label: s.label };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [chartSeries, resultCache]);

  const cells = testDetail?.validation_cells ?? [];
  const cellsPerRow = useMemo(
    () => (testDetail ? inferCellsPerRow(testDetail) : null),
    [testDetail],
  );

  // Resolve the reference run for the calibration fit. Defaults to the
  // first selected result when the user hasn't picked an explicit run
  // (or the picked one has been unticked). Recomputed any time the
  // pick or the selection changes.
  const resolvedReferenceId = useMemo<number | null>(() => {
    if (chartSeries.length === 0) return null;
    if (
      referenceResultId != null &&
      chartSeries.some((s) => s.resultId === referenceResultId)
    ) {
      return referenceResultId;
    }
    return chartSeries[0].resultId;
  }, [chartSeries, referenceResultId]);

  // Fit the affine transform on the reference run's measured cells so
  // we can pass it down when ``applyToChart`` is on. ``null`` whenever
  // the fit can't be produced (no reference / under-determined /
  // singular) — the calibrate canvas surfaces the same error UI.
  const simulationTransform = useMemo<AffineTransform | null>(() => {
    if (!applyToChart) return null;
    if (resolvedReferenceId == null) return null;
    const ref = chartSeries.find(
      (s) => s.resultId === resolvedReferenceId,
    );
    if (ref == null) return null;
    const pairs: { measured: Lab; expected: Lab }[] = [];
    for (const c of cells) {
      const exp = c.expected_lab as Lab | number[];
      if (!Array.isArray(exp) || exp.length !== 3) continue;
      const m = ref.cells.get(c.cell_index);
      if (m == null) continue;
      pairs.push({
        measured: [m.lab[0], m.lab[1], m.lab[2]],
        expected: [exp[0], exp[1], exp[2]],
      });
    }
    const fit = fitAffineTransform(pairs);
    if (!fit.ok) return null;
    return fit.fit.transform;
  }, [applyToChart, resolvedReferenceId, chartSeries, cells]);

  // Changing the reference run while APPLY-TO-CHART is on shouldn't
  // leave the user staring at a stale transform — the spec calls for a
  // hard reset of the toggle. We compare the resolved id between
  // renders so an initial null → id transition doesn't clobber the
  // toggle.
  const lastResolvedRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = lastResolvedRef.current;
    if (prev != null && prev !== resolvedReferenceId && applyToChart) {
      setApplyToChart(false);
    }
    lastResolvedRef.current = resolvedReferenceId;
  }, [resolvedReferenceId, applyToChart]);

  // Count distinct retest_index values across the selected results.
  // 1 = "all photos of the same burn" (CAMERA σ is pure measurement
  // noise). ≥2 = "different burns" (the same σ also captures
  // burn-to-burn variability). Drives the BurnVsCameraCard's
  // verdict caveat.
  const burnsSpanned = useMemo(() => {
    const seen = new Set<number>();
    for (const id of selectedResultIds) {
      const r = resultCache[id];
      if (!r) continue;
      seen.add(r.retest_index ?? 0);
    }
    return Math.max(1, seen.size);
  }, [selectedResultIds, resultCache]);

  // Drop focus when the cell index doesn't exist on the current grid
  // (e.g. a stale focus carried over via state during a base-test
  // change race). Cell indices are not strictly contiguous, so we do
  // a lookup rather than a bounds check.
  useEffect(() => {
    if (cells.length === 0) return; // grid not loaded yet — preserve focus
    if (transientCell) {
      const exists = cells.some(
        (c) => c.cell_index === transientCell.cellIndex,
      );
      if (!exists) setTransientCell(null);
    }
    if (pinnedCell) {
      const exists = cells.some((c) => c.cell_index === pinnedCell.cellIndex);
      if (!exists) setPinnedCell(null);
    }
  }, [cells, transientCell, pinnedCell]);

  const handleHover = useCallback(
    (cellIndex: number, source: FocusSource) => {
      setTransientCell({ cellIndex, source });
    },
    [],
  );

  const handleHoverLeave = useCallback((source: FocusSource) => {
    setTransientCell((prev) => {
      if (prev == null) return prev;
      if (prev.source !== source) return prev;
      return null;
    });
  }, []);

  const handleClick = useCallback((cellIndex: number, source: FocusSource) => {
    // Clear any in-flight transient — the user just committed.
    setTransientCell(null);
    setPinnedCell((prev) => {
      // Re-clicking the same cell in the same source toggles off.
      if (
        prev != null &&
        prev.cellIndex === cellIndex &&
        prev.source === source
      ) {
        return null;
      }
      return { cellIndex, source };
    });
  }, []);

  const handleBackgroundClear = useCallback((source: FocusSource) => {
    // Clear the transient owned by this view (if any). Pinned focus
    // also clears — clicking the empty chart canvas reads as "I'm
    // done with that cell".
    setTransientCell((prev) => (prev?.source === source ? null : prev));
    setPinnedCell(null);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader test={testDetail ?? null} cellsCount={cells.length} />
      <div className="flex-1 min-h-0 flex">
        <StabilityPicker
          tests={tests}
          materials={materials}
          selectedTestId={selectedTestId}
          onSelectTest={setSelectedTestId}
          results={results}
          resultsLoading={resultsLoading}
          selectedResultIds={selectedResultIds}
          onToggleResult={onToggleResult}
          error={resultsError}
        />
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <StabilityChart
            cells={cells}
            series={chartSeries}
            xAxis={xAxis}
            yAxis={yAxis}
            onXAxisChange={setXAxis}
            onYAxisChange={setYAxis}
            mode={chartMode}
            onModeChange={setChartMode}
            cellsPerRow={cellsPerRow}
            focusedCell={focusedCell}
            onHover={handleHover}
            onHoverLeave={handleHoverLeave}
            onClick={handleClick}
            onBackgroundClear={handleBackgroundClear}
            simulationTransform={simulationTransform}
            referenceResultId={resolvedReferenceId}
            onReferenceResultIdChange={setReferenceResultId}
            applyToChart={applyToChart}
            onApplyToChartChange={setApplyToChart}
          />
        </main>
        <StabilityStats
          cells={cells}
          series={statsSeries}
          focusedCell={focusedCell}
          onHover={(idx) => handleHover(idx, "stats")}
          onHoverLeave={() => handleHoverLeave("stats")}
          onClick={(idx) => handleClick(idx, "stats")}
          onResultCardClick={setSelectedResultIdForModal}
          burnsSpanned={burnsSpanned}
          prependSlot={
            focusedCell != null && testDetail != null ? (
              <StabilityFocusedCellPanel
                test={testDetail}
                results={selectedResultIds
                  .map((id) => resultCache[id])
                  .filter((r): r is NonNullable<typeof r> => r != null)}
                cellIndex={focusedCell.cellIndex}
                cellsPerRow={cellsPerRow}
                focusedCell={focusedCell}
                onCellClick={(idx) => handleClick(idx, "stats")}
                onClose={() => {
                  setTransientCell(null);
                  setPinnedCell(null);
                }}
              />
            ) : null
          }
        />
      </div>
      {testDetail != null && (
        <StabilityResultModal
          open={selectedResultIdForModal != null}
          result={
            selectedResultIdForModal != null
              ? resultCache[selectedResultIdForModal] ?? null
              : null
          }
          test={testDetail}
          onClose={() => setSelectedResultIdForModal(null)}
        />
      )}
    </div>
  );
}

function PageHeader({
  test,
  cellsCount,
}: {
  test: TestRecord | null;
  cellsCount: number;
}) {
  return (
    <header className="shrink-0 px-4 py-4 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-1">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Stability · validation comparison
      </div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-[20px] font-semibold text-[color:var(--color-ink)]">
          Where does my burn drift?
        </h1>
        {test && (
          <div className="font-mono text-[10.5px] tabular-nums tracking-[0.06em] text-[color:var(--color-ink-muted)]">
            base #{test.id} · {test.name || "Untitled"} ·{" "}
            <span className="text-[color:var(--color-ink-subtle)]">
              {cellsCount} cells
            </span>
          </div>
        )}
      </div>
      <p className="mt-1 text-[12.5px] text-[color:var(--color-ink-muted)] max-w-[78ch]">
        Pick a validation test as the expected base, layer one or more of
        its result photos, and look for consistent deltas — a uniform
        hue rotation or brightness offset means the whole palette can be
        corrected with a single shift.
      </p>
    </header>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

/** Pull cells_per_row from the spec, falling back to the documented
 *  ``ceil(x_steps / rows)`` derivation that older tests didn't store
 *  explicitly. Returns null when neither path can produce a sensible
 *  positive integer (test malformed; chart will skip). */
function inferCellsPerRow(t: TestRecord): number | null {
  const direct = t.spec.cells_per_row;
  if (direct != null && direct > 0) return direct;
  const xs = t.spec.x_steps;
  const rows = Math.max(1, t.spec.rows);
  if (xs > 0 && rows > 0) return Math.ceil(xs / rows);
  return null;
}

function shortStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
}
