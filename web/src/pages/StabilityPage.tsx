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
import { hexToLab, hexToRgb, rgbToHex, type Lab } from "../color/math";
import type { ResultRecord, TestRecord } from "../types";

interface FlatFieldEdge {
  side: string;
  x_mm: number;
  y_mm: number;
  R: number;
  G: number;
  B: number;
}

/**
 * Reverse-apply the flat-field gain that was multiplied into the
 * frame at ingest. Mirrors the bilinear blend in
 * ``src/xcs_gen_web/wb_correction.py::flatfield_correct``: at burn-
 * space position (u, v) the interpolated edge RGB is
 * ``(h_lerp + v_lerp) / 2``, the per-channel gain is
 * ``canonical / max(interpolated, 1)``, and the corrected pixel was
 * ``raw * gain``. Dividing by the same gain recovers the raw value
 * the camera saw — the A/B toggle on the Stability page uses this
 * to show "what would these cells look like without WB correction?".
 */
function reverseApplyFlatField(
  hex: string,
  cellX_mm: number,
  cellY_mm: number,
  gridBbox: { x_min: number; y_min: number; x_max: number; y_max: number },
  edges: FlatFieldEdge[],
  canonical: [number, number, number] = [160, 160, 145],
): string {
  const byside = new Map(edges.map((e) => [e.side, e]));
  const top = byside.get("top");
  const right = byside.get("right");
  const bottom = byside.get("bottom");
  const left = byside.get("left");
  if (!top || !right || !bottom || !left) return hex;
  const u = Math.min(
    1,
    Math.max(
      0,
      (cellX_mm - gridBbox.x_min) /
        Math.max(1e-3, gridBbox.x_max - gridBbox.x_min),
    ),
  );
  const v = Math.min(
    1,
    Math.max(
      0,
      (cellY_mm - gridBbox.y_min) /
        Math.max(1e-3, gridBbox.y_max - gridBbox.y_min),
    ),
  );
  const blendChannel = (key: "R" | "G" | "B") => {
    const h = (1 - u) * left[key] + u * right[key];
    const w = (1 - v) * top[key] + v * bottom[key];
    return (h + w) / 2;
  };
  const rgb = hexToRgb(hex);
  const interpolated: [number, number, number] = [
    blendChannel("R"),
    blendChannel("G"),
    blendChannel("B"),
  ];
  const gain = canonical.map((c, i) => c / Math.max(1, interpolated[i]));
  const raw: [number, number, number] = [
    Math.max(0, Math.min(255, rgb[0] / Math.max(1e-3, gain[0]))),
    Math.max(0, Math.min(255, rgb[1] / Math.max(1e-3, gain[1]))),
    Math.max(0, Math.min(255, rgb[2] / Math.max(1e-3, gain[2]))),
  ];
  return rgbToHex(raw[0], raw[1], raw[2]);
}

/** Type-narrowing predicate for the flat-field correction shape. The
 *  schema declares it as ``number[] | Array<Record<...>> | null`` to
 *  accommodate both flat-field (4 edge dicts) and chromaticity (per-
 *  channel scales). The reverse-apply only knows what to do with the
 *  former. */
function isFlatFieldEdges(value: unknown): value is FlatFieldEdge[] {
  if (!Array.isArray(value) || value.length !== 4) return false;
  for (const e of value) {
    if (e == null || typeof e !== "object") return false;
    const rec = e as Record<string, unknown>;
    if (typeof rec.side !== "string") return false;
    if (typeof rec.R !== "number") return false;
    if (typeof rec.G !== "number") return false;
    if (typeof rec.B !== "number") return false;
  }
  return true;
}

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
  const routeCell =
    route.name === "stability" && route.cell != null ? route.cell : null;
  // Tracks which (id, cell) deep link we most recently applied so the
  // apply-on-load effect can distinguish "first time at this URL"
  // (apply) from "user has been interacting since" (don't snap back).
  // A new deep-link navigation (e.g. clicking a different palette
  // entry's "from cell" link) updates this and reapplies.
  const lastAppliedDeepLink = useRef<{ id: number; cell: number } | null>(
    null,
  );

  const [materials, setMaterials] = useState<Material[]>([]);
  const [tests, setTests] = useState<TestRecord[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<number | undefined>(routeId);
  // Which test family the picker is currently showing. Stability was
  // originally validation-only; sweep tests benefit from the same
  // multi-photo comparison + cross-run stats. The toggle just gates
  // which list of tests is loaded — the chart math takes a unified
  // shape downstream (see ``cells`` derivation, which synthesises
  // sweep cells from the spec + reference run when the toggle is on).
  type StabilityKind = "validation" | "sweep";
  const [kindFilter, setKindFilter] = useState<StabilityKind>("validation");
  // Deep-link guard: if the URL points at a specific test id, the
  // picker has to fetch *that test's* kind first and seed kindFilter
  // from it. Otherwise the default kindFilter="validation" wins, the
  // initial listTests call returns the wrong family, and the page
  // resets ``selectedTestId`` to the newest in-family test —
  // silently swallowing the deep link. ``kindResolved`` gates the
  // listTests effect until the kind seed has finished.
  const [kindResolved, setKindResolved] = useState<boolean>(routeId == null);

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

  // A/B toggle for the flat-field WB correction. When OFF, the chart
  // series reverse-applies the per-cell inverse gain so users can see
  // the raw camera value the burn would have produced without WB. Only
  // surfaced when at least one selected result has ``wb.mode ===
  // "flatfield"``; chromaticity-mode results always render corrected.
  const [wbApplied, setWbApplied] = useState(true);

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

  // Left picker rail collapse state. Persisted to localStorage so the
  // user's preference survives reloads — once you've fold the rail
  // for analysis, you typically want to stay folded. Default expanded
  // on first visit so the picker is discoverable.
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("stability:leftCollapsed") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "stability:leftCollapsed",
      leftCollapsed ? "1" : "0",
    );
  }, [leftCollapsed]);

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

  // Sweep tests don't carry an authored expected Lab, so POLAR (hue
  // ring) and VALIDATE (cell → palette save) are dropped from the
  // mode pill row. INGEST is the inverse — sweep-only, since
  // validation tests already have VALIDATE. Snap to SCATTER on the
  // way out either way so the user isn't staring at a hidden mode.
  useEffect(() => {
    if (
      kindFilter === "sweep" &&
      (chartMode === "polar" || chartMode === "validate")
    ) {
      setChartMode("scatter");
    } else if (kindFilter === "validation" && chartMode === "ingest") {
      setChartMode("scatter");
    }
  }, [kindFilter, chartMode]);

  // Materials list is kind-agnostic; load it once on mount.
  useEffect(() => {
    listMaterials()
      .then(setMaterials)
      .catch(() => {});
  }, []);

  // Resolve the URL test's kind on mount (if any) so kindFilter snaps
  // to the right family before the listTests effect fires. Without
  // this, a deep link to a sweep test gets clobbered: kindFilter
  // defaults to "validation", listTests returns validation results,
  // the deep-linked id isn't in there, and the picker silently jumps
  // to the newest validation. Runs once per page mount — subsequent
  // user-driven kind toggles don't refetch the test, they just flip
  // ``kindFilter`` directly.
  useEffect(() => {
    if (routeId == null) return;
    let cancelled = false;
    getTest(routeId)
      .then((t) => {
        if (cancelled) return;
        if (t.kind === "sweep" || t.kind === "validation") {
          setKindFilter(t.kind);
        }
        setKindResolved(true);
      })
      .catch(() => {
        if (cancelled) return;
        setKindResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Test list re-fetches whenever the kind toggle flips. Backend filters
  // by ``kind`` so the dropdown doesn't pull both families. Gated on
  // ``kindResolved`` so the deep-link kind seed has a chance to land
  // before we start filtering — see the ``kindResolved`` doc above.
  useEffect(() => {
    if (!kindResolved) return;
    let cancelled = false;
    listTests({ machine_id: getCurrentMachineId(), kind: kindFilter })
      .then((next) => {
        if (cancelled) return;
        setTests(next);
        // If the previously selected id isn't in the new list, fall
        // back to the most-recent test in this family. Newest first —
        // backend sorts by created_at DESC.
        const stillThere = next.some((t) => t.id === selectedTestId);
        if (!stillThere) {
          setSelectedTestId(next[0]?.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kindFilter, kindResolved]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Cell footprint in burn-space mm — the same derivation the
    // generator and BE use. Cells flow left→right, top→bottom across
    // the [0..width_mm] × [0..height_mm] grid bbox the flat-field
    // correction was anchored to at ingest.
    const gridW = testDetail.spec.width_mm;
    const gridH = testDetail.spec.height_mm;
    const gap = testDetail.spec.gap_mm;
    const cellWidthMm =
      (gridW - Math.max(0, cellsPerRow - 1) * gap) / Math.max(1, cellsPerRow);
    const physicalRows = Math.max(
      1,
      Math.ceil(testDetail.spec.x_steps / Math.max(1, cellsPerRow)),
    );
    const cellHeightMm =
      (gridH - Math.max(0, physicalRows - 1) * gap) /
      Math.max(1, physicalRows);
    for (const id of selectedResultIds) {
      const r = resultCache[id];
      if (!r) continue;
      const cells = new Map<number, { hex: string; lab: Lab }>();
      const wb = r.wb;
      const reverse =
        !wbApplied &&
        wb?.mode === "flatfield" &&
        isFlatFieldEdges(wb.correction);
      const edges =
        reverse && wb && isFlatFieldEdges(wb.correction)
          ? wb.correction
          : null;
      for (const sw of r.swatches) {
        const idx = sw.row * cellsPerRow + sw.col;
        if (!Array.isArray(sw.lab) || sw.lab.length !== 3) continue;
        if (reverse && edges) {
          // Centre of the cell in burn-space mm. Edge readings live
          // outside the grid bbox so cells at the corners still get a
          // well-defined u, v ∈ [0, 1].
          const cellX_mm =
            sw.col * (cellWidthMm + gap) + cellWidthMm / 2;
          const cellY_mm =
            sw.row * (cellHeightMm + gap) + cellHeightMm / 2;
          const rawHex = reverseApplyFlatField(
            sw.hex,
            cellX_mm,
            cellY_mm,
            { x_min: 0, y_min: 0, x_max: gridW, y_max: gridH },
            edges,
          );
          cells.set(idx, { hex: rawHex, lab: hexToLab(rawHex) });
        } else {
          cells.set(idx, {
            hex: sw.hex,
            lab: [sw.lab[0], sw.lab[1], sw.lab[2]],
          });
        }
      }
      out.push({
        resultId: id,
        label: shortStamp(r.uploaded_at),
        cells,
      });
    }
    return out;
  }, [testDetail, selectedResultIds, resultCache, wbApplied]);

  const statsSeries = useMemo(() => {
    return chartSeries
      .map((s) => {
        const r = resultCache[s.resultId];
        if (!r) return null;
        return { result: r, cells: s.cells, label: s.label };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [chartSeries, resultCache]);

  const cellsPerRow = useMemo(
    () => (testDetail ? inferCellsPerRow(testDetail) : null),
    [testDetail],
  );

  // Resolve the reference run for the calibration fit. Defaults to the
  // first selected result when the user hasn't picked an explicit run
  // (or the picked one has been unticked). Recomputed any time the
  // pick or the selection changes. Sweep tests reuse the same slot as
  // the source of "expected" Labs (see ``cells`` below) so the toggle
  // also picks the primary run for cross-result comparison.
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

  // Cells drive every chart axis, the focus panel, and the result
  // modal. Validation tests own a real cells list; sweep tests don't,
  // so we synthesise one from the reference run's measured swatches —
  // each measured Lab becomes the "expected" for that grid position,
  // and every other selected run is plotted as drift relative to it.
  // The result is the same multi-photo comparison view validation gets,
  // applied to "how stable is this burn across N photos / N retests?"
  // for sweep tests.
  const cells = useMemo(() => {
    if (testDetail == null) return [];
    if (testDetail.kind !== "sweep") {
      return testDetail.validation_cells;
    }
    if (resolvedReferenceId == null || cellsPerRow == null) return [];
    const ref = chartSeries.find((s) => s.resultId === resolvedReferenceId);
    if (ref == null) return [];
    const synthesized: typeof testDetail.validation_cells = [];
    // Iterate the ref's measurements (already keyed by cell_index) so
    // we don't synthesize "expected" entries for cells the reference
    // run failed to measure. Stable order on cell_index keeps the
    // SPATIAL grid + stats list deterministic across renders.
    const sorted = [...ref.cells.entries()].sort((a, b) => a[0] - b[0]);
    for (const [cell_index, m] of sorted) {
      synthesized.push({
        id: -cell_index, // synthetic — never round-trips to the API
        test_id: testDetail.id,
        cell_index,
        palette_entry_id: null,
        expected_hex: m.hex,
        expected_lab: [m.lab[0], m.lab[1], m.lab[2]],
        params: {},
      });
    }
    return synthesized;
  }, [testDetail, resolvedReferenceId, chartSeries, cellsPerRow]);

  // Apply ``?cell=`` deep-link when the matching test's cells become
  // available. Reapplies whenever the (id, cell) tuple changes —
  // letting the user follow a sequence of palette → test deep links
  // without each one being shadowed by the previous pin. Doesn't
  // re-snap after manual pin/unpin: lastAppliedDeepLink remembers
  // the (id, cell) we already applied for, so further interaction
  // is not interrupted.
  useEffect(() => {
    if (routeId == null || routeCell == null) return;
    if (selectedTestId !== routeId) return;
    if (cells.length === 0) return;
    if (!cells.some((c) => c.cell_index === routeCell)) return;
    const last = lastAppliedDeepLink.current;
    if (last && last.id === routeId && last.cell === routeCell) return;
    setPinnedCell({ cellIndex: routeCell, source: "deep-link" });
    lastAppliedDeepLink.current = { id: routeId, cell: routeCell };
  }, [cells, selectedTestId, routeId, routeCell]);

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
          kind={kindFilter}
          onKindChange={setKindFilter}
          selectedTestId={selectedTestId}
          onSelectTest={setSelectedTestId}
          results={results}
          resultsLoading={resultsLoading}
          selectedResultIds={selectedResultIds}
          onToggleResult={onToggleResult}
          error={resultsError}
          collapsed={leftCollapsed}
          onToggleCollapsed={() => setLeftCollapsed((v) => !v)}
        />
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          {selectedResultIds.some(
            (id) => resultCache[id]?.wb?.mode === "flatfield",
          ) && (
            <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-[color:var(--color-border)] text-[11px] font-mono uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer normal-case font-mono tracking-[0.14em]">
                <input
                  type="checkbox"
                  checked={wbApplied}
                  onChange={(e) => setWbApplied(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--color-primary)]"
                />
                <span>WB CORRECTION</span>
              </label>
            </div>
          )}
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
            validateTestId={selectedTestId}
            kind={kindFilter}
            test={testDetail}
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
          widened={leftCollapsed}
          prependSlot={
            // Only show the drilldown panel for PINNED focus (an
            // explicit click). A transient hover used to render this
            // too, but that caused a layout-shift loop: hover →
            // panel inserts at top of strip → rows below shift down
            // → cursor leaves the source row → focus clears → panel
            // disappears → rows shift back → cursor enters again →
            // loop. The chart + TOP VARIABLE list still highlight
            // the cell on hover, which is the affordance hover
            // should give; the drilldown is a deliberate read.
            focusedCell?.kind === "pinned" && testDetail != null ? (
              <StabilityFocusedCellPanel
                test={testDetail}
                results={selectedResultIds
                  .map((id) => resultCache[id])
                  .filter((r): r is NonNullable<typeof r> => r != null)}
                cellIndex={focusedCell.cellIndex}
                cellsPerRow={cellsPerRow}
                focusedCell={focusedCell}
                onCellClick={(idx) => handleClick(idx, "stats")}
                onRunOpen={setSelectedResultIdForModal}
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
          highlightCellIndex={focusedCell?.cellIndex ?? null}
          cellsPerRow={cellsPerRow}
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
  // Single-line header. Earlier iteration carried a breadcrumb, a
  // 20px title, and a wrap-friendly description paragraph — over
  // four screen lines of chrome that the chart had to push past on
  // every screen. Title sits inline with the test summary; the
  // TopBar already labels the page so the breadcrumb adds nothing.
  return (
    <header className="shrink-0 px-4 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] flex items-baseline justify-between gap-4 flex-wrap">
      <h1 className="text-[14px] font-semibold text-[color:var(--color-ink)] whitespace-nowrap">
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
