/**
 * 2D Spectrum playground.
 *
 * Three viz for two-axis parameter sweeps, on one scrolling page with
 * page-level shared state so a pin / clip in one viz shows up in the
 * others. Design spec lives in the design doc — this file implements
 * the preferred options:
 *
 *   Viz 1A — atlas: the measured swatch grid with iso-contour overlay
 *   Viz 2A — drift map: samples in PC1/PC2 with row+column threads
 *   Viz 3A — crosshair strips: L-shaped row-mean + col-mean marginals
 *
 * The shared state (pinnedCell, xClip, yClip, deltaERadius, activeAxis)
 * lives on ``Spectrum2DBody`` and flows to each viz as props; pinning /
 * clipping in one section re-renders the others.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { SpectrumAbout } from "./SpectrumAbout";
import {
  alignPcaWithReference,
  deltaE2000,
  hexToLab,
  labToHex,
  pca1,
  pca2,
  polyFit,
  evalPoly,
  type Lab,
  type PolyFit,
} from "../color/math";
import {
  computeCellSpread,
  computeConstellationScale,
  computeGridStability,
} from "../color/variability";
import { listTests } from "../api/tests";
import { getAveragedSwatches } from "../api/results";
import { getCurrentMachineId } from "../state/machine";
import type { AveragedSwatch, TestRecord } from "../types";
import { useRoute } from "../router";
import { StabilityChip } from "../components/StabilityChip";
import { PerCellExplodeStrip } from "../components/PerCellExplodeStrip";
import {
  Button,
  cn,
  EmptyState,
  Field,
  MetalBar,
  PageContainer,
  Section,
  Select,
} from "../ui";

/* ========================================================================
 * Types + helpers
 * ====================================================================== */

type Cell = {
  row: number;
  col: number;
  x: number; // x_param value
  y: number; // y_param value
  hex: string;
  lab: Lab;
  /** Source swatch kept alongside so viz can reach per_result /
   *  variability without re-looking-up in the flat array. */
  swatch: AveragedSwatch;
};

type Grid = {
  cells: (Cell | null)[][]; // grid[row][col]
  xs: number[]; // distinct x_param values, sorted asc
  ys: number[]; // distinct y_param values, sorted asc
  flat: Cell[]; // all non-null cells, flat
};

type LabAxis = "L" | "a" | "b" | "C" | "h";
const LAB_AXIS_META: Record<LabAxis, { label: string; unit: string; min: number; max: number }> = {
  L: { label: "L*",  unit: "L*",  min: 0,   max: 100 },
  a: { label: "a*",  unit: "a*",  min: -80, max: 80 },
  b: { label: "b*",  unit: "b*",  min: -80, max: 80 },
  C: { label: "C*",  unit: "C*",  min: 0,   max: 130 },
  h: { label: "h°",  unit: "deg", min: 0,   max: 360 },
};

function labAxisValue(lab: Lab, axis: LabAxis): number {
  switch (axis) {
    case "L": return lab[0];
    case "a": return lab[1];
    case "b": return lab[2];
    case "C": return Math.hypot(lab[1], lab[2]);
    case "h": return ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360;
  }
}

function pivotSwatches(swatches: AveragedSwatch[]): Grid {
  const valid = swatches.filter(
    (s) =>
      s.x_value != null &&
      s.y_value != null &&
      s.lab?.length === 3,
  );
  const xs = [...new Set(valid.map((s) => s.x_value))].sort((a, b) => a - b);
  const ys = [...new Set(valid.map((s) => s.y_value as number))].sort((a, b) => a - b);
  const xi = new Map(xs.map((x, i) => [x, i]));
  const yi = new Map(ys.map((y, i) => [y, i]));

  const cells: (Cell | null)[][] = Array.from({ length: ys.length }, () =>
    Array<Cell | null>(xs.length).fill(null),
  );
  const flat: Cell[] = [];
  for (const s of valid) {
    const r = yi.get(s.y_value as number)!;
    const c = xi.get(s.x_value)!;
    const cell: Cell = {
      row: r,
      col: c,
      x: s.x_value,
      y: s.y_value as number,
      swatch: s,
      hex: s.hex,
      lab: s.lab as Lab,
    };
    cells[r][c] = cell;
    flat.push(cell);
  }
  return { cells, xs, ys, flat };
}

/* Averaging in Lab space — same mean regardless of gamma. */
function meanLab(cells: Cell[]): Lab | null {
  if (cells.length === 0) return null;
  let L = 0, a = 0, b = 0;
  for (const c of cells) {
    L += c.lab[0];
    a += c.lab[1];
    b += c.lab[2];
  }
  return [L / cells.length, a / cells.length, b / cells.length];
}

/* Linear interpolation for marching-squares contours in screen space. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ========================================================================
 * Page
 * ====================================================================== */

export function Spectrum2DPage() {
  const [route, navigate] = useRoute();
  const routeId = route.name === "spectrum-2d" ? route.id : undefined;

  const [tests, setTests] = useState<TestRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>(routeId);
  const [swatches, setSwatches] = useState<AveragedSwatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    listTests({ status: "tested", machine_id: getCurrentMachineId() })
      .then((all) => {
        const bi = all.filter((t) => t.spec.y_param != null);
        setTests(bi);
        if (selectedId == null && bi.length > 0) setSelectedId(bi[0].id);
      })
      .catch((e) => setError((e as Error).message));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (selectedId == null) {
      setSwatches(null);
      return;
    }
    setLoading(true);
    setSwatches(null);
    setError(undefined);
    getAveragedSwatches(selectedId)
      .then((s) => setSwatches(s))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (
      selectedId != null &&
      (route.name !== "spectrum-2d" || route.id !== selectedId)
    ) {
      navigate({ name: "spectrum-2d", id: selectedId });
    }
  }, [selectedId]); // eslint-disable-line

  const selected = tests.find((t) => t.id === selectedId);

  // Grid-level variability summary for the header chip. Computed at the
  // page level (not inside the body) so the chip can render during the
  // single-run / loading states too.
  const stability = useMemo(
    () => computeGridStability(swatches ?? []),
    [swatches],
  );

  // "Jump to first unstable cell" is a one-shot signal from header →
  // body: bumping the nonce value tells the body's effect to consume
  // the pending pin and then forget it, so re-clicks keep working.
  const [jumpNonce, setJumpNonce] = useState(0);
  const jumpToUnstable = () => setJumpNonce((n) => n + 1);
  const pendingPin = useMemo(() => {
    if (stability.unstableSwatches.length === 0) return null;
    const s = stability.unstableSwatches[0];
    if (s.row == null || s.col == null) return null;
    return { row: s.row, col: s.col };
  }, [stability]);

  return (
    <PageContainer className="py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-1.5">
            <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
            Spectrum · 2D — dual-axis sweep
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
              Parameter grid ↔ colour field
            </h1>
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              aria-label="Open field manual"
              className={cn(
                "group relative inline-flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-full",
                "border border-[color:var(--color-primary)]/40",
                "bg-[color:var(--color-primary-tint)]",
                "text-[color:var(--color-primary)]",
                "shadow-[0_1px_0_rgba(184,65,14,0.08),inset_0_0_0_1px_rgba(255,255,255,0.5)]",
                "hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
                "transition-colors",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full",
                  "bg-[color:var(--color-surface)] border border-[color:var(--color-primary)]/30",
                  "group-hover:bg-white/20 group-hover:border-white/40",
                  "transition-colors",
                )}
              >
                <BookOpen className="h-3 w-3" strokeWidth={2} />
              </span>
              <span className="font-mono text-[11px] font-semibold tracking-[0.14em] uppercase">
                Field manual
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigate({ name: "spectrum" })}
              className={cn(
                "inline-flex items-center h-8 px-3 rounded-full",
                "border border-[color:var(--color-border-strong)]",
                "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-muted)]",
                "hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-primary)]/50",
                "font-mono text-[11px] font-semibold tracking-[0.14em] uppercase",
                "transition-colors",
              )}
            >
              ← 1-axis spectrum
            </button>
            <StabilityChip stability={stability} onJumpToUnstable={jumpToUnstable} />
          </div>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[72ch]">
            Pick a 2-axis test. The atlas is the measured grid, the drift map
            shows how the two input parameters move colour across Lab space,
            and the crosshair strips expose each parameter's marginal effect.
            Pin a cell in any of them — the others highlight it too.
          </p>
        </div>
        <div className="min-w-[260px]">
          <Field label="Test">
            <Select
              value={selectedId ?? ""}
              onChange={(e) =>
                setSelectedId(e.target.value ? Number(e.target.value) : undefined)
              }
            >
              {tests.length === 0 && <option value="">— no tested 2-axis tests —</option>}
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.id} · {t.name} ({t.spec.x_param} × {t.spec.y_param})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </header>

      <SpectrumAbout open={aboutOpen} onOpenChange={setAboutOpen} initialTab="2d" />

      {tests.length === 0 ? (
        <Section>
          <EmptyState
            title="No tested 2-axis tests yet"
            description="Upload a photo of a 2-axis parameter sweep. This page kicks in once at least one 2D test has ingested swatches."
            action={
              <Button variant="primary" onClick={() => navigate({ name: "tests" })}>
                Open tests
              </Button>
            }
          />
        </Section>
      ) : loading || swatches == null ? (
        <Section>
          <div className="py-10 text-center font-mono text-[11px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
            Loading swatches…
          </div>
        </Section>
      ) : error ? (
        <Section>
          <div className="rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-4 py-3 text-[13px] text-[color:var(--color-destructive)]">
            {error}
          </div>
        </Section>
      ) : (
        <Spectrum2DBody
          test={selected!}
          swatches={swatches}
          jumpNonce={jumpNonce}
          pendingPin={pendingPin}
        />
      )}
    </PageContainer>
  );
}

/* ========================================================================
 * Body (shared state + three sections)
 * ====================================================================== */

function Spectrum2DBody({
  test,
  swatches,
  jumpNonce,
  pendingPin,
}: {
  test: TestRecord;
  swatches: AveragedSwatch[];
  jumpNonce: number;
  pendingPin: { row: number; col: number } | null;
}) {
  const grid = useMemo(() => pivotSwatches(swatches), [swatches]);

  // Shared state. Pinning / axis / clip changes in any one viz flow to
  // the others.
  const [activeAxis, setActiveAxis] = useState<LabAxis>("L");
  const [pinned, setPinned] = useState<{ row: number; col: number } | null>(null);
  const [xClip, setXClip] = useState<[number, number] | null>(null); // indices into grid.xs
  const [yClip, setYClip] = useState<[number, number] | null>(null);
  const [deltaERadius, setDeltaERadius] = useState(2.3);
  const [threadMode, setThreadMode] = useState<"both" | "rows" | "cols">("both");
  const [contourCount, setContourCount] = useState<1 | 3 | 5>(3);
  const [threshold, setThreshold] = useState<number | null>(null); // in axis units
  const [atlasMode, setAtlasMode] = useState<"swatch" | "constellation" | "hybrid">(
    "swatch",
  );

  // Reset state when the test changes.
  useEffect(() => {
    setPinned(null);
    setXClip(null);
    setYClip(null);
    setThreshold(null);
    setAtlasMode("swatch");
  }, [test.id]);

  // One-shot jump from the header Stability chip. ``jumpNonce`` is the
  // trigger, ``pendingPin`` is the target cell. We pin it and scroll
  // the atlas into view; the pin ripples through all three viz.
  useEffect(() => {
    if (jumpNonce === 0) return;
    if (pendingPin == null) return;
    setPinned(pendingPin);
    // Smooth-scroll the first section into view so the user sees
    // where we jumped.
    const el = document.getElementById("spec2d-atlas");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jumpNonce, pendingPin]);

  if (grid.flat.length === 0) {
    return (
      <Section>
        <EmptyState
          title="No swatches yet"
          description="This test is marked 'tested' but doesn't have any ingested swatches. Upload a photo first."
        />
      </Section>
    );
  }

  const pinnedCell =
    pinned != null ? grid.cells[pinned.row][pinned.col] : null;

  return (
    <div className="flex flex-col gap-6">
      <div id="spec2d-atlas">
        <Viz1Atlas
          test={test}
          grid={grid}
          activeAxis={activeAxis}
          setActiveAxis={setActiveAxis}
          threshold={threshold}
          setThreshold={setThreshold}
          contourCount={contourCount}
          setContourCount={setContourCount}
          pinned={pinned}
          setPinned={setPinned}
          atlasMode={atlasMode}
          setAtlasMode={setAtlasMode}
        />
        {pinnedCell && pinnedCell.swatch.per_result?.length &&
          pinnedCell.swatch.per_result.length >= 2 && (
          <PerCellExplodeStrip
            label={`${String(test.spec.x_param)}=${fmtTick(pinnedCell.x)} · ${String(test.spec.y_param)}=${fmtTick(pinnedCell.y)}`}
            cell={pinnedCell.swatch}
            onClose={() => setPinned(null)}
          />
        )}
      </div>
      <MetalBar />
      <Viz2DriftMap
        test={test}
        grid={grid}
        pinned={pinned}
        setPinned={setPinned}
        deltaERadius={deltaERadius}
        setDeltaERadius={setDeltaERadius}
        threadMode={threadMode}
        setThreadMode={setThreadMode}
      />
      <MetalBar />
      <Viz3Marginals
        test={test}
        grid={grid}
        xClip={xClip}
        setXClip={setXClip}
        yClip={yClip}
        setYClip={setYClip}
        pinned={pinned}
      />
    </div>
  );
}

/* ========================================================================
 * Viz 1A — atlas with iso-colour contours
 * ====================================================================== */

type Viz1Props = {
  test: TestRecord;
  grid: Grid;
  activeAxis: LabAxis;
  setActiveAxis: (a: LabAxis) => void;
  threshold: number | null;
  setThreshold: (t: number | null) => void;
  contourCount: 1 | 3 | 5;
  setContourCount: (c: 1 | 3 | 5) => void;
  pinned: { row: number; col: number } | null;
  setPinned: (p: { row: number; col: number } | null) => void;
  atlasMode: "swatch" | "constellation" | "hybrid";
  setAtlasMode: (m: "swatch" | "constellation" | "hybrid") => void;
};

function Viz1Atlas(props: Viz1Props) {
  const { grid, activeAxis, setActiveAxis, threshold, setThreshold, contourCount, pinned, setPinned, atlasMode, setAtlasMode } = props;

  // Constellation scale: fixed across all cells so dot-cloud size
  // compares honestly cell-to-cell. Estimated from the grid's 95th
  // percentile a*b* max-spread. Cheap enough to recompute per render.
  const cellPxEstimate = 48; // average cell size; AtlasGrid refines per-cell
  const constellationScale = useMemo(
    () => computeConstellationScale(grid.flat.map((c) => c.swatch), cellPxEstimate),
    [grid],
  );
  const hasReplicates = useMemo(
    () => grid.flat.some((c) => (c.swatch.per_result?.length ?? 0) >= 2),
    [grid],
  );

  // Axis values across the grid → used for contours and threshold slider.
  const values = useMemo(() => {
    const out: (number | null)[][] = grid.cells.map((row) =>
      row.map((c) => (c ? labAxisValue(c.lab, activeAxis) : null)),
    );
    return out;
  }, [grid, activeAxis]);

  // Value range derived from actual samples, not the theoretical axis max —
  // contour slider jumps should land on values the test really produced.
  const { vmin, vmax } = useMemo(() => {
    const flat = values.flat().filter((v): v is number => v != null);
    if (flat.length === 0) return { vmin: 0, vmax: 1 };
    return { vmin: Math.min(...flat), vmax: Math.max(...flat) };
  }, [values]);

  useEffect(() => {
    if (threshold == null || threshold < vmin || threshold > vmax) {
      setThreshold((vmin + vmax) / 2);
    }
  }, [vmin, vmax]); // eslint-disable-line

  const highlightedCount = useMemo(() => {
    if (threshold == null) return 0;
    const eps = (vmax - vmin) * 0.04 || 0.1;
    let n = 0;
    for (const row of values)
      for (const v of row) if (v != null && Math.abs(v - threshold) <= eps) n++;
    return n;
  }, [values, threshold, vmin, vmax]);

  // Section ratio: SVG grid left, 220px control rail right.
  return (
    <Section
      title="Atlas"
      description="Measured grid. Pick a Lab axis and drag the threshold to see all cells sharing a value."
      dense
      actions={
        hasReplicates ? (
          <div className="inline-flex rounded-[6px] overflow-hidden border border-[color:var(--color-border)]">
            {(["swatch", "constellation", "hybrid"] as const).map((m, i) => (
              <button
                key={m}
                onClick={() => setAtlasMode(m)}
                className={cn(
                  "h-7 px-2.5 font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase",
                  i > 0 && "border-l border-[color:var(--color-border)]",
                  atlasMode === m
                    ? "bg-[color:var(--color-ink)] text-[color:var(--color-surface)]"
                    : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
                )}
                title={
                  m === "swatch"
                    ? "Plain averaged swatches"
                    : m === "constellation"
                      ? "Per-cell Lab scatter of all runs"
                      : "Constellation overlaid on dimmed swatch"
                }
              >
                {m}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-4 items-start">
        <AtlasGrid
          grid={grid}
          values={values}
          vmin={vmin}
          vmax={vmax}
          threshold={threshold ?? (vmin + vmax) / 2}
          contourCount={contourCount}
          pinned={pinned}
          onPin={(p) => {
            const already = pinned && pinned.row === p.row && pinned.col === p.col;
            setPinned(already ? null : p);
            // Snap the contour threshold to the clicked cell's value on
            // the active axis so the Atlas responds in-place — otherwise
            // the effect of pinning is only visible after scrolling to
            // the drift map / marginals.
            if (!already) {
              const cell = grid.cells[p.row][p.col];
              if (cell != null) setThreshold(labAxisValue(cell.lab, activeAxis));
            }
          }}
          xParam={String(props.test.spec.x_param)}
          yParam={String(props.test.spec.y_param)}
          atlasMode={atlasMode}
          constellationScale={constellationScale}
        />
        <AtlasRail
          activeAxis={activeAxis}
          setActiveAxis={setActiveAxis}
          threshold={threshold ?? (vmin + vmax) / 2}
          setThreshold={setThreshold}
          vmin={vmin}
          vmax={vmax}
          contourCount={contourCount}
          setContourCount={props.setContourCount}
          highlightedCount={highlightedCount}
        />
      </div>
    </Section>
  );
}

function AtlasGrid({
  grid,
  values,
  vmin,
  vmax,
  threshold,
  contourCount,
  pinned,
  onPin,
  xParam,
  yParam,
  atlasMode,
  constellationScale,
}: {
  grid: Grid;
  values: (number | null)[][];
  vmin: number;
  vmax: number;
  threshold: number;
  contourCount: 1 | 3 | 5;
  pinned: { row: number; col: number } | null;
  onPin: (p: { row: number; col: number }) => void;
  xParam: string;
  yParam: string;
  atlasMode: "swatch" | "constellation" | "hybrid";
  constellationScale: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  // Responsive cell sizing — compute at render time via the SVG container's
  // actual width. We keep a fixed aspect so the grid stays square-ish even
  // for rectangular grids.
  const PAD_LEFT = 44;
  const PAD_TOP = 26;
  const PAD_RIGHT = 12;
  const PAD_BOTTOM = 30;
  const W = 720; // logical viewBox width (SVG scales to container)
  const H = Math.round(
    Math.min(
      640,
      Math.max(320, (grid.ys.length / Math.max(1, grid.xs.length)) * (W - PAD_LEFT - PAD_RIGHT) + PAD_TOP + PAD_BOTTOM),
    ),
  );
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const cellW = plotW / grid.xs.length;
  const cellH = plotH / grid.ys.length;

  // Contour thresholds — single line at the user value, or a fan of N
  // equally-spaced lines centred on it.
  const thresholds = useMemo(() => {
    if (contourCount === 1) return [threshold];
    const spread = (vmax - vmin) / 4;
    const out: number[] = [];
    const half = Math.floor(contourCount / 2);
    for (let i = -half; i <= half; i++) {
      out.push(threshold + (i * spread) / half || 0);
    }
    return out;
  }, [threshold, contourCount, vmin, vmax]);

  // Marching-squares: for each cell quad of the values grid, emit line
  // segments where the threshold crosses. Screen coords of each corner
  // = cell centre.
  const contourPaths = useMemo(() => {
    const out: { threshold: number; d: string }[] = [];
    for (const t of thresholds) {
      out.push({ threshold: t, d: marchingSquares(values, t, cellW, cellH, PAD_LEFT, PAD_TOP) });
    }
    return out;
  }, [values, thresholds, cellW, cellH]);

  return (
    <div
      className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-2"
      style={{ minWidth: 0 }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        role="img"
        aria-label={`Atlas grid: ${grid.xs.length} × ${grid.ys.length} samples.`}
      >
        {/* Axis rails */}
        <line
          x1={PAD_LEFT} y1={PAD_TOP}
          x2={PAD_LEFT} y2={PAD_TOP + plotH}
          stroke="var(--color-border-strong)" strokeWidth={1}
        />
        <line
          x1={PAD_LEFT} y1={PAD_TOP + plotH}
          x2={PAD_LEFT + plotW} y2={PAD_TOP + plotH}
          stroke="var(--color-border-strong)" strokeWidth={1}
        />

        {/* Axis labels */}
        <text
          x={PAD_LEFT + plotW / 2}
          y={H - 4}
          textAnchor="middle"
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.18em", fill: "var(--color-ink-subtle)" }}
        >
          {xParam}
        </text>
        <text
          x={12}
          y={PAD_TOP + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${PAD_TOP + plotH / 2})`}
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.18em", fill: "var(--color-ink-subtle)" }}
        >
          {yParam}
        </text>

        {/* X ticks — value + position every cell (or every ~5 for dense) */}
        {grid.xs.map((x, i) => {
          const show = grid.xs.length <= 12 || i % Math.ceil(grid.xs.length / 8) === 0;
          if (!show) return null;
          const cx = PAD_LEFT + (i + 0.5) * cellW;
          return (
            <g key={i}>
              <line
                x1={cx} y1={PAD_TOP + plotH}
                x2={cx} y2={PAD_TOP + plotH + 3}
                stroke="var(--color-border-strong)" strokeWidth={1}
              />
              <text
                x={cx} y={PAD_TOP + plotH + 14}
                textAnchor="middle"
                style={{ fontSize: 9.5, fill: "var(--color-ink-subtle)", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtTick(x)}
              </text>
            </g>
          );
        })}

        {/* Y ticks — bottom-up (first row = min y_param) */}
        {grid.ys.map((y, i) => {
          const show = grid.ys.length <= 12 || i % Math.ceil(grid.ys.length / 8) === 0;
          if (!show) return null;
          // Row 0 is visually at the BOTTOM of the atlas (min y_param at
          // bottom, increasing upward — standard Cartesian).
          const cy = PAD_TOP + plotH - (i + 0.5) * cellH;
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT - 3} y1={cy}
                x2={PAD_LEFT} y2={cy}
                stroke="var(--color-border-strong)" strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 5} y={cy + 3}
                textAnchor="end"
                style={{ fontSize: 9.5, fill: "var(--color-ink-subtle)", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtTick(y)}
              </text>
            </g>
          );
        })}

        {/* Swatch cells */}
        {grid.cells.map((row, r) =>
          row.map((cell, c) => {
            // Render row 0 at the bottom.
            const visualRow = grid.ys.length - 1 - r;
            const x = PAD_LEFT + c * cellW;
            const y = PAD_TOP + visualRow * cellH;
            const isPinned = pinned?.row === r && pinned?.col === c;
            const isHover = hover?.row === r && hover?.col === c;
            if (cell == null) {
              return (
                <rect
                  key={`${r}-${c}`}
                  x={x} y={y} width={cellW} height={cellH}
                  fill="url(#atlas-missing)"
                  stroke="var(--color-border)"
                  strokeWidth={0.5}
                />
              );
            }
            const bgOpacity =
              atlasMode === "constellation"
                ? 0.35
                : atlasMode === "hybrid"
                  ? 0.55
                  : 1;
            return (
              <g
                key={`${r}-${c}`}
                onMouseEnter={() => setHover({ row: r, col: c })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPin({ row: r, col: c })}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={x} y={y} width={cellW} height={cellH}
                  fill={cell.hex}
                  opacity={bgOpacity}
                />
                {atlasMode !== "swatch" && (
                  <ConstellationGlyph
                    cell={cell}
                    x={x}
                    y={y}
                    cellW={cellW}
                    cellH={cellH}
                    scale={constellationScale}
                  />
                )}
                {(isPinned || isHover) && (
                  <rect
                    x={x + 0.5} y={y + 0.5}
                    width={cellW - 1} height={cellH - 1}
                    fill="none"
                    stroke={isPinned ? "var(--color-primary)" : "var(--color-ink)"}
                    strokeWidth={isPinned ? 2 : 1.5}
                  />
                )}
              </g>
            );
          }),
        )}

        {/* Missing-cell hatch pattern */}
        <defs>
          <pattern id="atlas-missing" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--color-surface-elevated)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-border)" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Iso-contour curves — rendered on top */}
        {contourPaths.map((cp, i) => {
          const isCentre = i === Math.floor(contourPaths.length / 2);
          return (
            <g key={i}>
              {/* Halo for legibility on dark swatches */}
              <path
                d={cp.d}
                fill="none"
                stroke="var(--color-surface)"
                strokeWidth={3.5}
                strokeOpacity={0.7}
              />
              <path
                d={cp.d}
                fill="none"
                stroke={isCentre ? "var(--color-primary)" : "var(--color-ink)"}
                strokeWidth={isCentre ? 1.75 : 1}
                strokeOpacity={isCentre ? 0.95 : 0.55}
              />
            </g>
          );
        })}

        {/* Hover card anchored at top-right */}
        {hover && grid.cells[hover.row][hover.col] && (
          <HoverCard
            cell={grid.cells[hover.row][hover.col]!}
            x={PAD_LEFT + plotW}
            y={PAD_TOP}
          />
        )}
      </svg>
    </div>
  );
}

function HoverCard({ cell, x, y }: { cell: Cell; x: number; y: number }) {
  const boxW = 140;
  const boxH = 66;
  const bx = x - boxW;
  const by = y;
  return (
    <g transform={`translate(${bx}, ${by})`} pointerEvents="none">
      <rect
        x={0} y={0} width={boxW} height={boxH} rx={6}
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth={1}
      />
      <rect x={8} y={8} width={18} height={18} fill={cell.hex} stroke="var(--color-border)" strokeWidth={0.5} />
      <text x={30} y={20} style={{ fontSize: 11, fill: "var(--color-ink)", fontFamily: "var(--font-mono)" }}>{cell.hex}</text>
      <text x={8} y={42} style={{ fontSize: 10, fill: "var(--color-ink-muted)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
        L* {cell.lab[0].toFixed(1)}  a* {cell.lab[1].toFixed(1)}  b* {cell.lab[2].toFixed(1)}
      </text>
      <text x={8} y={58} style={{ fontSize: 9.5, fill: "var(--color-ink-subtle)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.08em" }}>
        x={fmtTick(cell.x)} · y={fmtTick(cell.y)}
      </text>
    </g>
  );
}

function AtlasRail({
  activeAxis,
  setActiveAxis,
  threshold,
  setThreshold,
  vmin,
  vmax,
  contourCount,
  setContourCount,
  highlightedCount,
}: {
  activeAxis: LabAxis;
  setActiveAxis: (a: LabAxis) => void;
  threshold: number;
  setThreshold: (t: number | null) => void;
  vmin: number;
  vmax: number;
  contourCount: 1 | 3 | 5;
  setContourCount: (c: 1 | 3 | 5) => void;
  highlightedCount: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-3">
        <Kicker>Contour axis</Kicker>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(LAB_AXIS_META) as LabAxis[]).map((a) => (
            <button
              key={a}
              onClick={() => setActiveAxis(a)}
              className={cn(
                "h-7 px-2.5 rounded-[6px] font-mono text-[11px] font-semibold",
                "border transition-colors",
                activeAxis === a
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-ink-muted)]",
              )}
            >
              {LAB_AXIS_META[a].label}
            </button>
          ))}
        </div>
        <div>
          <Kicker className="mb-1.5">Threshold</Kicker>
          <input
            type="range"
            min={vmin}
            max={vmax}
            step={(vmax - vmin) / 200 || 0.01}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)] mt-1">
            <span>{vmin.toFixed(1)}</span>
            <span className="text-[color:var(--color-primary)] font-semibold">{threshold.toFixed(1)}</span>
            <span>{vmax.toFixed(1)}</span>
          </div>
        </div>
        <div>
          <Kicker className="mb-1.5">Contour lines</Kicker>
          <div className="inline-flex rounded-[6px] overflow-hidden border border-[color:var(--color-border)]">
            {([1, 3, 5] as const).map((n) => (
              <button
                key={n}
                onClick={() => setContourCount(n)}
                className={cn(
                  "h-7 w-10 font-mono text-[11px] font-semibold",
                  n !== 1 && "border-l border-[color:var(--color-border)]",
                  contourCount === n
                    ? "bg-[color:var(--color-ink)] text-[color:var(--color-surface)]"
                    : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <MetaChip label="Near threshold">{highlightedCount} cells</MetaChip>
    </div>
  );
}

/* ========================================================================
 * Viz 2A — PC1/PC2 drift map
 * ====================================================================== */

type Viz2Props = {
  test: TestRecord;
  grid: Grid;
  pinned: { row: number; col: number } | null;
  setPinned: (p: { row: number; col: number } | null) => void;
  deltaERadius: number;
  setDeltaERadius: (r: number) => void;
  threadMode: "both" | "rows" | "cols";
  setThreadMode: (m: "both" | "rows" | "cols") => void;
};

function Viz2DriftMap(props: Viz2Props) {
  const { grid, pinned, setPinned, deltaERadius, setDeltaERadius, threadMode, setThreadMode } = props;

  const pca = useMemo(() => pca2(grid.flat.map((c) => c.lab)), [grid]);

  // Points in PC1/PC2 space — map each cell to (pc1, pc2) via pre-computed
  // projections (same order as grid.flat).
  const points = useMemo(() => {
    return grid.flat.map((c, i) => ({
      cell: c,
      pc1: pca.projected1[i],
      pc2: pca.projected2[i],
    }));
  }, [grid, pca]);

  const pc1Range = useMemo(() => {
    const xs = points.map((p) => p.pc1);
    return { min: Math.min(...xs, 0), max: Math.max(...xs, 0) };
  }, [points]);
  const pc2Range = useMemo(() => {
    const ys = points.map((p) => p.pc2);
    return { min: Math.min(...ys, 0), max: Math.max(...ys, 0) };
  }, [points]);

  const pinnedPt = useMemo(
    () =>
      pinned
        ? points.find((p) => p.cell.row === pinned.row && p.cell.col === pinned.col) ?? null
        : null,
    [points, pinned],
  );

  return (
    <Section
      title="Drift map · PC1 × PC2"
      description="Each sample plotted in 2-D colour space. Threads connect rows (orange) and columns (slate) from the input grid."
      dense
    >
      <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-4 items-start">
        <DriftSvg
          grid={grid}
          points={points}
          pc1Range={pc1Range}
          pc2Range={pc2Range}
          pinned={pinned}
          pinnedPt={pinnedPt}
          deltaERadius={deltaERadius}
          threadMode={threadMode}
          onPin={(p) => setPinned(pinned && pinned.row === p.row && pinned.col === p.col ? null : p)}
        />
        <DriftRail
          variance1={pca.variance_ratio_1}
          variance2={pca.variance_ratio_2}
          threadMode={threadMode}
          setThreadMode={setThreadMode}
          deltaERadius={deltaERadius}
          setDeltaERadius={setDeltaERadius}
          pinnedCell={pinnedPt?.cell ?? null}
          neighborCount={
            pinnedPt
              ? points.filter(
                  (p) => deltaE2000(p.cell.lab, pinnedPt.cell.lab) <= deltaERadius,
                ).length - 1
              : 0
          }
        />
      </div>
      {pca.variance_ratio_2 < 0.03 && (
        <div className="mt-3 rounded-[8px] border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning-tint)] px-3 py-2 font-mono text-[11px] tracking-[0.08em] text-[color:var(--color-warning-ink)]">
          PC2 captures &lt; 3 % of variance — this sweep is effectively 1-D
          in colour space. The marginals below may be the more useful view.
        </div>
      )}
    </Section>
  );
}

function DriftSvg({
  grid,
  points,
  pc1Range,
  pc2Range,
  pinned,
  pinnedPt,
  deltaERadius,
  threadMode,
  onPin,
}: {
  grid: Grid;
  points: { cell: Cell; pc1: number; pc2: number }[];
  pc1Range: { min: number; max: number };
  pc2Range: { min: number; max: number };
  pinned: { row: number; col: number } | null;
  pinnedPt: { cell: Cell; pc1: number; pc2: number } | null;
  deltaERadius: number;
  threadMode: "both" | "rows" | "cols";
  onPin: (p: { row: number; col: number }) => void;
}) {
  const PAD_L = 48, PAD_T = 20, PAD_R = 20, PAD_B = 40;
  const W = 720, H = 520;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // Symmetric padding so centroid sits near plot centre.
  const xSpan = Math.max(0.5, pc1Range.max - pc1Range.min);
  const ySpan = Math.max(0.5, pc2Range.max - pc2Range.min);
  const xPad = xSpan * 0.08;
  const yPad = ySpan * 0.08;
  const xMin = pc1Range.min - xPad;
  const xMax = pc1Range.max + xPad;
  const yMin = pc2Range.min - yPad;
  const yMax = pc2Range.max + yPad;

  const toX = (v: number) => PAD_L + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = (v: number) => PAD_T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Threads: link points sharing a row (horizontal in input grid ⇒ orange)
  // or a column (vertical in input grid ⇒ secondary).
  const rowThreads = useMemo(() => {
    const out: string[] = [];
    for (let r = 0; r < grid.ys.length; r++) {
      const row = grid.cells[r].map((c, col) => {
        if (c == null) return null;
        const p = points.find((p) => p.cell.row === r && p.cell.col === col);
        return p ? `${toX(p.pc1)},${toY(p.pc2)}` : null;
      }).filter((s): s is string => s != null);
      if (row.length >= 2) out.push(`M ${row.join(" L ")}`);
    }
    return out;
  }, [grid, points, xMin, xMax, yMin, yMax]);

  const colThreads = useMemo(() => {
    const out: string[] = [];
    for (let c = 0; c < grid.xs.length; c++) {
      const col = grid.cells.map((row, r) => {
        const cell = row[c];
        if (cell == null) return null;
        const p = points.find((p) => p.cell.row === r && p.cell.col === c);
        return p ? `${toX(p.pc1)},${toY(p.pc2)}` : null;
      }).filter((s): s is string => s != null);
      if (col.length >= 2) out.push(`M ${col.join(" L ")}`);
    }
    return out;
  }, [grid, points, xMin, xMax, yMin, yMax]);

  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  // ΔE disk radius in PC units — approximate ΔE76 as euclidean in (PC1, PC2)
  // plane. Not exact (there's variance lost to PC3) but a useful guide.
  const diskRadius = useMemo(() => {
    if (!pinnedPt) return 0;
    // pixels per PC unit along x vs y — use the geometric mean
    const pxX = plotW / (xMax - xMin);
    const pxY = plotH / (yMax - yMin);
    return deltaERadius * Math.sqrt(pxX * pxY);
  }, [pinnedPt, deltaERadius, plotW, plotH, xMax, xMin, yMax, yMin]);

  return (
    <div
      className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-2"
      style={{ minWidth: 0 }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto">
        {/* Axis crosshairs at centroid (0,0 in PC space) */}
        <line
          x1={toX(0)} y1={PAD_T}
          x2={toX(0)} y2={PAD_T + plotH}
          stroke="var(--color-border)" strokeDasharray="3 3" strokeWidth={1}
        />
        <line
          x1={PAD_L} y1={toY(0)}
          x2={PAD_L + plotW} y2={toY(0)}
          stroke="var(--color-border)" strokeDasharray="3 3" strokeWidth={1}
        />

        {/* Plot rect */}
        <rect
          x={PAD_L} y={PAD_T} width={plotW} height={plotH}
          fill="none" stroke="var(--color-border)" strokeWidth={1}
        />

        {/* Threads */}
        {(threadMode === "both" || threadMode === "rows") &&
          rowThreads.map((d, i) => (
            <path key={`r-${i}`} d={d} fill="none" stroke="var(--color-primary)" strokeOpacity={0.35} strokeWidth={1} />
          ))}
        {(threadMode === "both" || threadMode === "cols") &&
          colThreads.map((d, i) => (
            <path key={`c-${i}`} d={d} fill="none" stroke="var(--color-secondary)" strokeOpacity={0.4} strokeWidth={1} />
          ))}

        {/* ΔE neighbourhood disk (under dots) */}
        {pinnedPt && (
          <circle
            cx={toX(pinnedPt.pc1)} cy={toY(pinnedPt.pc2)}
            r={diskRadius}
            fill="var(--color-primary)"
            fillOpacity={0.08}
            stroke="var(--color-primary)"
            strokeOpacity={0.35}
            strokeDasharray="4 3"
            strokeWidth={1}
          />
        )}

        {/* Dots */}
        {points.map((p) => {
          const isPinned = pinned?.row === p.cell.row && pinned?.col === p.cell.col;
          const isHover = hover?.row === p.cell.row && hover?.col === p.cell.col;
          const inRadius =
            pinnedPt != null &&
            deltaE2000(p.cell.lab, pinnedPt.cell.lab) <= deltaERadius;
          const r = isPinned ? 10 : isHover ? 9 : 7;
          return (
            <g
              key={`${p.cell.row}-${p.cell.col}`}
              onMouseEnter={() => setHover({ row: p.cell.row, col: p.cell.col })}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPin({ row: p.cell.row, col: p.cell.col })}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={toX(p.pc1)} cy={toY(p.pc2)} r={r}
                fill={p.cell.hex}
                stroke={isPinned ? "var(--color-primary)" : "var(--color-ink)"}
                strokeOpacity={isPinned ? 1 : inRadius ? 0.8 : 0.3}
                strokeWidth={isPinned ? 2 : 1}
              />
            </g>
          );
        })}

        {/* Axis labels */}
        <text
          x={PAD_L + plotW / 2} y={H - 10}
          textAnchor="middle"
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.18em", fill: "var(--color-ink-subtle)" }}
        >
          PC1 · Lab units
        </text>
        <text
          x={16} y={PAD_T + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${PAD_T + plotH / 2})`}
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.18em", fill: "var(--color-ink-subtle)" }}
        >
          PC2 · Lab units
        </text>

        {/* Hover card */}
        {hover && (
          <HoverCard
            cell={grid.cells[hover.row][hover.col]!}
            x={PAD_L + plotW}
            y={PAD_T}
          />
        )}
      </svg>
    </div>
  );
}

function DriftRail({
  variance1,
  variance2,
  threadMode,
  setThreadMode,
  deltaERadius,
  setDeltaERadius,
  pinnedCell,
  neighborCount,
}: {
  variance1: number;
  variance2: number;
  threadMode: "both" | "rows" | "cols";
  setThreadMode: (m: "both" | "rows" | "cols") => void;
  deltaERadius: number;
  setDeltaERadius: (r: number) => void;
  pinnedCell: Cell | null;
  neighborCount: number;
}) {
  const pc3 = Math.max(0, 1 - variance1 - variance2);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-2.5">
        <Kicker>Variance captured</Kicker>
        <VarianceBar label="PC1" ratio={variance1} primary />
        <VarianceBar label="PC2" ratio={variance2} />
        <VarianceBar label="PC3" ratio={pc3} muted />
      </div>
      <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-2">
        <Kicker>Threads</Kicker>
        <div className="inline-flex rounded-[6px] overflow-hidden border border-[color:var(--color-border)]">
          {(["both", "rows", "cols"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setThreadMode(m)}
              className={cn(
                "h-7 flex-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]",
                m !== "both" && "border-l border-[color:var(--color-border)]",
                threadMode === m
                  ? "bg-[color:var(--color-ink)] text-[color:var(--color-surface)]"
                  : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-2">
        <Kicker>ΔE neighbourhood</Kicker>
        <input
          type="range"
          min={0.5} max={10} step={0.1}
          value={deltaERadius}
          onChange={(e) => setDeltaERadius(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
          <span>radius</span>
          <span className="text-[color:var(--color-primary)] font-semibold">ΔE {deltaERadius.toFixed(1)}</span>
        </div>
      </div>
      {pinnedCell ? (
        <div className="rounded-[10px] border border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary-tint)] p-3 flex flex-col gap-1.5">
          <Kicker className="text-[color:var(--color-primary)]">Pinned</Kicker>
          <div className="flex items-center gap-2">
            <div
              className="h-5 w-5 rounded-[3px] border border-[color:var(--color-border)]"
              style={{ background: pinnedCell.hex }}
            />
            <span className="font-mono text-[11px] text-[color:var(--color-ink)]">{pinnedCell.hex}</span>
          </div>
          <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">
            x={fmtTick(pinnedCell.x)} · y={fmtTick(pinnedCell.y)}
          </div>
          <div className="font-mono text-[10px] text-[color:var(--color-ink-muted)]">
            {neighborCount} within ΔE {deltaERadius.toFixed(1)}
          </div>
        </div>
      ) : (
        <MetaChip label="Pin">click a dot</MetaChip>
      )}
    </div>
  );
}

function VarianceBar({
  label,
  ratio,
  primary,
  muted,
}: {
  label: string;
  ratio: number;
  primary?: boolean;
  muted?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-[2px] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
        <div
          style={{
            width: `${pct * 100}%`,
            background: primary
              ? "var(--color-primary)"
              : muted
                ? "var(--color-ink-subtle)"
                : "var(--color-secondary)",
          }}
          className="h-full"
        />
      </div>
      <span className="w-9 text-right font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
        {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/* ========================================================================
 * Viz 3A — L-shaped marginal strips
 * ====================================================================== */

type Viz3Props = {
  test: TestRecord;
  grid: Grid;
  xClip: [number, number] | null;
  setXClip: (c: [number, number] | null) => void;
  yClip: [number, number] | null;
  setYClip: (c: [number, number] | null) => void;
  pinned: { row: number; col: number } | null;
};

function Viz3Marginals(props: Viz3Props) {
  const { grid, xClip, yClip, setXClip, setYClip, pinned } = props;

  const xClipOr: [number, number] = xClip ?? [0, grid.xs.length - 1];
  const yClipOr: [number, number] = yClip ?? [0, grid.ys.length - 1];

  const isClipped =
    xClipOr[0] !== 0 || xClipOr[1] !== grid.xs.length - 1 ||
    yClipOr[0] !== 0 || yClipOr[1] !== grid.ys.length - 1;

  // When the user is actively clipping, let them collapse the dimmed
  // outside-of-clip area so the active region fills the space. Matches
  // the 1-D Spectrum page's Crop toggle. Auto-disabled (not just
  // hidden) when the clip covers the full grid — the button has
  // nothing to do and we don't want to leave it in a half-on state.
  const [cropped, setCropped] = useState(false);
  useEffect(() => {
    if (!isClipped && cropped) setCropped(false);
  }, [isClipped, cropped]);

  // Row-mean strip — for each column, average over the rows inside yClip.
  const rowMeanStrip: Lab[] = useMemo(() => {
    const out: Lab[] = [];
    for (let c = 0; c < grid.xs.length; c++) {
      const cells: Cell[] = [];
      for (let r = yClipOr[0]; r <= yClipOr[1]; r++) {
        const v = grid.cells[r][c];
        if (v != null) cells.push(v);
      }
      const m = meanLab(cells);
      out.push(m ?? [50, 0, 0]);
    }
    return out;
  }, [grid, yClipOr[0], yClipOr[1]]);

  // Col-mean strip — for each row, average over the cols inside xClip.
  const colMeanStrip: Lab[] = useMemo(() => {
    const out: Lab[] = [];
    for (let r = 0; r < grid.ys.length; r++) {
      const cells: Cell[] = [];
      for (let c = xClipOr[0]; c <= xClipOr[1]; c++) {
        const v = grid.cells[r][c];
        if (v != null) cells.push(v);
      }
      const m = meanLab(cells);
      out.push(m ?? [50, 0, 0]);
    }
    return out;
  }, [grid, xClipOr[0], xClipOr[1]]);

  return (
    <Section
      title="Crosshair strips · marginals"
      description="Top strip = row-mean (varies with x). Left strip = col-mean (varies with y). Drag the handles to clip either axis; the other strip recomputes over that slice."
      dense
      actions={
        <button
          onClick={() => setCropped((v) => !v)}
          disabled={!isClipped}
          className={cn(
            "inline-flex items-center h-7 px-2.5 rounded-[6px]",
            "font-mono text-[10.5px] font-semibold tracking-[0.12em] uppercase",
            "border transition-colors",
            !isClipped
              ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed"
              : cropped
                ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-ink-muted)]",
          )}
          title={
            !isClipped
              ? "Clip an axis first, then crop"
              : cropped
                ? "Show full grid — drag handles to change clip"
                : "Hide clipped region and fill the strip with the active range"
          }
        >
          {cropped ? "Cropped" : "Crop"}
        </button>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-4 items-start">
        <MarginalsL
          grid={grid}
          xParam={String(props.test.spec.x_param)}
          yParam={String(props.test.spec.y_param)}
          rowMeanStrip={rowMeanStrip}
          colMeanStrip={colMeanStrip}
          xClip={xClipOr}
          yClip={yClipOr}
          setXClip={(v) =>
            setXClip(v[0] === 0 && v[1] === grid.xs.length - 1 ? null : v)
          }
          setYClip={(v) =>
            setYClip(v[0] === 0 && v[1] === grid.ys.length - 1 ? null : v)
          }
          pinned={pinned}
          cropped={cropped}
        />
        <MarginalsRail
          grid={grid}
          rowMeanStrip={rowMeanStrip}
          colMeanStrip={colMeanStrip}
          xParam={String(props.test.spec.x_param)}
          yParam={String(props.test.spec.y_param)}
        />
      </div>
    </Section>
  );
}

function MarginalsL({
  grid,
  xParam,
  yParam,
  rowMeanStrip,
  colMeanStrip,
  xClip,
  yClip,
  setXClip,
  setYClip,
  pinned,
  cropped,
}: {
  grid: Grid;
  xParam: string;
  yParam: string;
  rowMeanStrip: Lab[];
  colMeanStrip: Lab[];
  xClip: [number, number];
  yClip: [number, number];
  setXClip: (v: [number, number]) => void;
  setYClip: (v: [number, number]) => void;
  pinned: { row: number; col: number } | null;
  cropped: boolean;
}) {
  const W = 720;
  const H = 520;
  const STRIP = 44;
  const TICK = 22;
  const LABEL = 22;
  const centreX = STRIP + TICK;
  const centreY = STRIP + TICK;
  const centreW = W - centreX - LABEL;
  const centreH = H - centreY - LABEL;

  // Cell sizes depend on mode: cropped expands the active region to
  // fill the whole centre panel; uncropped keeps all cells at their
  // full-grid positions and dims out-of-clip ones so the handles have
  // a continuous surface to drag over.
  const xSpanCount = cropped ? xClip[1] - xClip[0] + 1 : grid.xs.length;
  const ySpanCount = cropped ? yClip[1] - yClip[0] + 1 : grid.ys.length;
  const xCellW = centreW / xSpanCount;
  const yCellH = centreH / ySpanCount;

  // Data row 0 = bottom. In cropped mode the first visible column is
  // xClip[0], so subtract that offset. Return null for cells that fall
  // outside the cropped window.
  const cellX = (col: number): number | null => {
    if (cropped && (col < xClip[0] || col > xClip[1])) return null;
    const base = cropped ? col - xClip[0] : col;
    return centreX + base * xCellW;
  };
  const cellY = (row: number): number | null => {
    if (cropped && (row < yClip[0] || row > yClip[1])) return null;
    // Visually highest row (= largest row index) sits at the top.
    const maxRow = cropped ? yClip[1] : grid.ys.length - 1;
    return centreY + (maxRow - row) * yCellH;
  };

  // ── Drag state for the four clip handles ───────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] =
    useState<null | "x0" | "x1" | "y0" | "y1">(null);

  /** Convert a DOM pointer event into the SVG's viewBox coordinate
   *  system — responsive scaling means we can't just subtract rect
   *  offsets. */
  const toSvgPoint = (e: React.PointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onPointerDown = (
    e: React.PointerEvent<SVGElement>,
    handle: "x0" | "x1" | "y0" | "y1",
  ) => {
    e.stopPropagation();
    setDragging(handle);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGElement>) => {
    if (!dragging) return;
    const { x, y } = toSvgPoint(e);
    if (dragging === "x0" || dragging === "x1") {
      const col = Math.round((x - centreX) / xCellW - 0.5);
      const clamped = Math.max(0, Math.min(grid.xs.length - 1, col));
      if (dragging === "x0") setXClip([Math.min(clamped, xClip[1]), xClip[1]]);
      else setXClip([xClip[0], Math.max(clamped, xClip[0])]);
    } else {
      const visualRow = Math.round((y - centreY) / yCellH - 0.5);
      const row = grid.ys.length - 1 - visualRow;
      const clamped = Math.max(0, Math.min(grid.ys.length - 1, row));
      if (dragging === "y0") setYClip([Math.min(clamped, yClip[1]), yClip[1]]);
      else setYClip([yClip[0], Math.max(clamped, yClip[0])]);
    }
  };
  const onPointerUp = () => setDragging(null);

  // Handle screen coords. Start handles sit at the LEADING edge of the
  // first clipped cell; end handles at the TRAILING edge of the last.
  // In cropped mode the handles collapse to the edges of the cropped
  // panel (active region fills everything), so we hide them there —
  // user uncrops to re-adjust.
  const xStartPx = centreX + xClip[0] * xCellW;
  const xEndPx = centreX + (xClip[1] + 1) * xCellW;
  const yStartPx = centreY + (grid.ys.length - yClip[0]) * yCellH; // bottom edge of lowest clipped row
  const yEndPx = centreY + (grid.ys.length - 1 - yClip[1]) * yCellH; // top edge of highest clipped row

  return (
    <div
      className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-2"
      style={{ minWidth: 0 }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none" }}
      >
        {/* Top horizontal strip — row-mean. Clipped columns dim in
            uncropped mode; in cropped mode they simply don't render. */}
        {rowMeanStrip.map((lab, i) => {
          const x = cellX(i);
          if (x == null) return null;
          const inClip = i >= xClip[0] && i <= xClip[1];
          return (
            <rect
              key={i}
              x={x}
              y={STRIP}
              width={xCellW}
              height={STRIP}
              fill={labToHex(lab)}
              opacity={inClip ? 1 : 0.3}
            />
          );
        })}
        {/* Left vertical strip — col-mean. */}
        {colMeanStrip.map((lab, i) => {
          const y = cellY(i);
          if (y == null) return null;
          const inClip = i >= yClip[0] && i <= yClip[1];
          return (
            <rect
              key={i}
              x={STRIP}
              y={y}
              width={STRIP}
              height={yCellH}
              fill={labToHex(lab)}
              opacity={inClip ? 1 : 0.3}
            />
          );
        })}

        {/* Centre mini-atlas. Uncropped: 0.5 in clip, 0.15 out.
            Cropped: only in-clip cells render, all at 0.5. */}
        {grid.cells.map((row, r) =>
          row.map((cell, c) => {
            if (cell == null) return null;
            const x = cellX(c);
            const y = cellY(r);
            if (x == null || y == null) return null;
            const inClip =
              c >= xClip[0] && c <= xClip[1] &&
              r >= yClip[0] && r <= yClip[1];
            return (
              <rect
                key={`${r}-${c}`}
                x={x}
                y={y}
                width={xCellW}
                height={yCellH}
                fill={cell.hex}
                opacity={inClip ? 0.5 : 0.15}
              />
            );
          }),
        )}

        {/* Centre outline */}
        <rect
          x={centreX} y={centreY} width={centreW} height={centreH}
          fill="none" stroke="var(--color-border)" strokeWidth={1}
        />

        {/* Pin cross-highlights */}
        {pinned && (() => {
          const px = cellX(pinned.col);
          const py = cellY(pinned.row);
          if (px == null || py == null) return null;
          return (
            <g pointerEvents="none">
              <rect
                x={px + 0.5}
                y={py + 0.5}
                width={xCellW - 1}
                height={yCellH - 1}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth={2}
              />
              <line
                x1={px + xCellW / 2}
                y1={STRIP}
                x2={px + xCellW / 2}
                y2={STRIP + STRIP}
                stroke="var(--color-primary)" strokeWidth={1.5}
              />
              <line
                x1={STRIP}
                y1={py + yCellH / 2}
                x2={STRIP + STRIP}
                y2={py + yCellH / 2}
                stroke="var(--color-primary)" strokeWidth={1.5}
              />
            </g>
          );
        })()}

        {/* Drag handles — only in uncropped mode. When cropped the
            active region fills the panel; there's no dim surface for
            the handle to drag over, so the user has to uncrop first. */}
        {!cropped && (
          <>
            <ClipHandle
              axis="x"
              edge="start"
              posPx={xStartPx}
              stripStart={STRIP}
              stripLen={STRIP}
              dragging={dragging === "x0"}
              onPointerDown={(e) => onPointerDown(e, "x0")}
            />
            <ClipHandle
              axis="x"
              edge="end"
              posPx={xEndPx}
              stripStart={STRIP}
              stripLen={STRIP}
              dragging={dragging === "x1"}
              onPointerDown={(e) => onPointerDown(e, "x1")}
            />
            <ClipHandle
              axis="y"
              edge="start"
              posPx={yStartPx}
              stripStart={STRIP}
              stripLen={STRIP}
              dragging={dragging === "y0"}
              onPointerDown={(e) => onPointerDown(e, "y0")}
            />
            <ClipHandle
              axis="y"
              edge="end"
              posPx={yEndPx}
              stripStart={STRIP}
              stripLen={STRIP}
              dragging={dragging === "y1"}
              onPointerDown={(e) => onPointerDown(e, "y1")}
            />
          </>
        )}

        {/* Axis labels */}
        <text
          x={centreX + centreW / 2} y={H - 4}
          textAnchor="middle"
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.18em", fill: "var(--color-ink-subtle)" }}
        >
          {xParam} · row-mean
        </text>
        <text
          x={10} y={centreY + centreH / 2}
          textAnchor="middle"
          transform={`rotate(-90 10 ${centreY + centreH / 2})`}
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.18em", fill: "var(--color-ink-subtle)" }}
        >
          {yParam} · col-mean
        </text>

      </svg>
      {/* Keep the dropdown controls too — useful for keyboard users and
          for resetting to full range. */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <ClipControl
          label={`${xParam} clip`}
          values={grid.xs}
          clip={xClip}
          setClip={setXClip}
        />
        <ClipControl
          label={`${yParam} clip`}
          values={grid.ys}
          clip={yClip}
          setClip={setYClip}
        />
      </div>
    </div>
  );
}

function ClipHandle({
  axis,
  edge,
  posPx,
  stripStart,
  stripLen,
  dragging,
  onPointerDown,
}: {
  axis: "x" | "y";
  edge: "start" | "end";
  /** Position along the variable axis (x for horizontal strip, y for vertical). */
  posPx: number;
  /** Start of the strip along its fixed axis. */
  stripStart: number;
  /** Thickness of the strip along its fixed axis. */
  stripLen: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
}) {
  // Visual bracket: a stem through the strip + a perpendicular cap at
  // the outer edge so it reads as a draggable pull. Larger invisible
  // hit target makes it easy to grab. Cursor hints are axis-aware.
  const HIT = 14;
  if (axis === "x") {
    const stem = stripStart;
    const stemEnd = stripStart + stripLen;
    const capSize = 6;
    const dir = edge === "start" ? -1 : 1;
    return (
      <g
        onPointerDown={onPointerDown}
        style={{ cursor: "ew-resize" }}
      >
        <rect
          x={posPx - HIT / 2} y={stem - 6}
          width={HIT} height={stripLen + 12}
          fill="transparent"
        />
        <line
          x1={posPx} y1={stem}
          x2={posPx} y2={stemEnd}
          stroke={dragging ? "var(--color-primary)" : "var(--color-ink)"}
          strokeWidth={dragging ? 2.5 : 2}
        />
        <path
          d={`M ${posPx} ${stem - 2} L ${posPx + dir * capSize} ${stem - 2} L ${posPx + dir * capSize} ${stem - 2 - capSize} Z`}
          fill={dragging ? "var(--color-primary)" : "var(--color-ink)"}
        />
      </g>
    );
  }
  const stem = stripStart;
  const stemEnd = stripStart + stripLen;
  const capSize = 6;
  // edge="start" → bottom edge in data (visually lower, larger y);
  // edge="end"   → top edge in data (visually higher, smaller y).
  const dir = edge === "start" ? 1 : -1;
  return (
    <g
      onPointerDown={onPointerDown}
      style={{ cursor: "ns-resize" }}
    >
      <rect
        x={stem - 6} y={posPx - HIT / 2}
        width={stripLen + 12} height={HIT}
        fill="transparent"
      />
      <line
        x1={stem} y1={posPx}
        x2={stemEnd} y2={posPx}
        stroke={dragging ? "var(--color-primary)" : "var(--color-ink)"}
        strokeWidth={dragging ? 2.5 : 2}
      />
      <path
        d={`M ${stem - 2} ${posPx} L ${stem - 2} ${posPx + dir * capSize} L ${stem - 2 - capSize} ${posPx + dir * capSize} Z`}
        fill={dragging ? "var(--color-primary)" : "var(--color-ink)"}
      />
    </g>
  );
}

function ClipControl({
  label,
  values,
  clip,
  setClip,
}: {
  label: string;
  values: number[];
  clip: [number, number];
  setClip: (v: [number, number]) => void;
}) {
  const full = clip[0] === 0 && clip[1] === values.length - 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <Kicker>{label}</Kicker>
        <button
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.08em]",
            full
              ? "text-[color:var(--color-ink-subtle)]"
              : "text-[color:var(--color-primary)] hover:underline",
          )}
          disabled={full}
          onClick={() => setClip([0, values.length - 1])}
        >
          reset
        </button>
      </div>
      <div className="flex items-center gap-2">
        <select
          className={cn(
            "h-7 flex-1 min-w-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
            "px-2 font-mono text-[11px] tabular-nums text-[color:var(--color-ink)]",
          )}
          value={clip[0]}
          onChange={(e) => {
            const v = Number(e.target.value);
            setClip([v, Math.max(v, clip[1])]);
          }}
        >
          {values.map((v, i) => (
            <option key={i} value={i}>{fmtTick(v)}</option>
          ))}
        </select>
        <span className="font-mono text-[10.5px] text-[color:var(--color-ink-subtle)]">→</span>
        <select
          className={cn(
            "h-7 flex-1 min-w-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
            "px-2 font-mono text-[11px] tabular-nums text-[color:var(--color-ink)]",
          )}
          value={clip[1]}
          onChange={(e) => {
            const v = Number(e.target.value);
            setClip([Math.min(v, clip[0]), v]);
          }}
        >
          {values.map((v, i) => (
            <option key={i} value={i}>{fmtTick(v)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function MarginalsRail({
  grid,
  rowMeanStrip,
  colMeanStrip,
  xParam,
  yParam,
}: {
  grid: Grid;
  rowMeanStrip: Lab[];
  colMeanStrip: Lab[];
  xParam: string;
  yParam: string;
}) {
  // Residual ΔE for a deg-2 PC1 fit on each marginal, same treatment as
  // the 1D page.
  const xFit = useMemo(() => fitResidual(grid.xs, rowMeanStrip), [grid.xs, rowMeanStrip]);
  const yFit = useMemo(() => fitResidual(grid.ys, colMeanStrip), [grid.ys, colMeanStrip]);
  return (
    <div className="flex flex-col gap-3">
      <FitCard label={`${xParam} · row-mean`} fit={xFit} />
      <FitCard label={`${yParam} · col-mean`} fit={yFit} />
      {/* Intentionally a plain info block — the MetaChip pill truncates
          awkwardly for multi-line strings at this width. */}
      <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-1">
        <Kicker>Method</Kicker>
        <p className="text-[11.5px] leading-[1.45] text-[color:var(--color-ink-muted)]">
          PC1 along each marginal, fit with a degree-2 polynomial.
          Residual reported as mean ΔE76.
        </p>
      </div>
    </div>
  );
}

type Resid = { variance: number; residual: number; fit: PolyFit };

function fitResidual(xs: number[], labs: Lab[]): Resid {
  if (xs.length < 3) return { variance: 0, residual: 0, fit: { coeffs: [0], r2: 0, degree: 0 } };
  const pca = alignPcaWithReference(pca1(labs), xs);
  const ys = pca.projected;
  const deg = Math.min(2, xs.length - 1);
  const fit = polyFit(xs, ys, deg);
  // Residual Δ on the projected axis, approximated as dLab (≈ ΔE76 in Lab).
  let sumSq = 0;
  for (let i = 0; i < xs.length; i++) {
    const yhat = evalPoly(fit.coeffs, xs[i]);
    sumSq += Math.pow(ys[i] - yhat, 2);
  }
  const residual = Math.sqrt(sumSq / xs.length);
  return { variance: pca.variance_ratio, residual, fit };
}

function FitCard({ label, fit }: { label: string; fit: Resid }) {
  const tone =
    fit.residual <= 1.5 ? "good"
    : fit.residual <= 3.5 ? "warn"
    : "bad";
  const toneColor =
    tone === "good" ? "var(--color-success, #2e7d32)"
    : tone === "warn" ? "var(--color-warning, #b26a00)"
    : "var(--color-destructive)";
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-1.5">
      <Kicker>{label}</Kicker>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[18px] font-semibold tabular-nums" style={{ color: toneColor }}>
          ΔE {fit.residual.toFixed(2)}
        </span>
        <span className="font-mono text-[10.5px] text-[color:var(--color-ink-subtle)] tabular-nums">
          PC1 {(fit.variance * 100).toFixed(0)}%
        </span>
      </div>
      <span className="font-mono text-[10px] text-[color:var(--color-ink-muted)]">
        residual of deg-{fit.fit.degree} polyfit
      </span>
    </div>
  );
}

/* ========================================================================
 * Small shared primitives
 * ====================================================================== */

function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MetaChip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[999px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-2.5 h-7">
      <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[10.5px] text-[color:var(--color-ink)] tabular-nums">
        {children}
      </span>
    </div>
  );
}

function fmtTick(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

// V3-A glyph. Each cell becomes a miniature Lab a*-by-b* scatter:
// white dots with slate borders for each per-result sample, orange
// centroid, thin slate axis cross whose arms = max a*/b* spread
// across this cell's samples. ``scale`` is the shared global
// px-per-ΔE factor so dot clouds across cells compare honestly.
// Single-result cells collapse to just the centroid dot.
function ConstellationGlyph({
  cell,
  x,
  y,
  cellW,
  cellH,
  scale,
}: {
  cell: Cell;
  x: number;
  y: number;
  cellW: number;
  cellH: number;
  scale: number;
}) {
  const per = cell.swatch.per_result ?? [];
  const cx = x + cellW / 2;
  const cy = y + cellH / 2;
  if (per.length < 2 || scale <= 0) {
    return (
      <circle cx={cx} cy={cy} r={1.8} fill="var(--color-primary)" pointerEvents="none" />
    );
  }
  const spread = computeCellSpread(cell.swatch);
  // Cloud extent in screen px (cap at cell half so it never leaves
  // the cell even when the global scale is generous).
  const axisLenPx = Math.min(
    cellW * 0.42,
    cellH * 0.42,
    Math.max(6, spread.maxSpread * scale),
  );
  const dotR = Math.max(1.2, Math.min(2.4, cellW * 0.08));
  return (
    <g pointerEvents="none">
      {/* Axis cross = local scalebar. Slate, faint. */}
      <line
        x1={cx - axisLenPx} y1={cy}
        x2={cx + axisLenPx} y2={cy}
        stroke="var(--color-ink)" strokeOpacity={0.35} strokeWidth={0.6}
      />
      <line
        x1={cx} y1={cy - axisLenPx}
        x2={cx} y2={cy + axisLenPx}
        stroke="var(--color-ink)" strokeOpacity={0.35} strokeWidth={0.6}
      />
      {/* Per-result dots placed as (a* - centroid_a, b* - centroid_b)
          offsets. L* drops out — it's encoded in the cell background. */}
      {spread.labs.map((lab, i) => {
        const da = (lab[1] - spread.centroidLab[1]) * scale;
        const db = (lab[2] - spread.centroidLab[2]) * scale;
        return (
          <circle
            key={i}
            cx={cx + da}
            cy={cy - db}
            r={dotR}
            fill="white"
            stroke="var(--color-ink)"
            strokeWidth={0.5}
          />
        );
      })}
      {/* Centroid dot — always last so it sits on top. */}
      <circle cx={cx} cy={cy} r={Math.max(1.4, dotR * 1.2)} fill="var(--color-primary)" />
    </g>
  );
}

/* ========================================================================
 * Marching-squares contour generator
 *
 * Input: value grid[row][col], some cells maybe null. Draws a line
 * wherever the threshold crosses between adjacent cell centres. Output is
 * an SVG path string (one long "M ... L ... M ... L ..." chain of segments).
 * Simple segment-per-cell-quad, no smoothing — still reads well with the
 * halo.
 * ====================================================================== */

function marchingSquares(
  values: (number | null)[][],
  threshold: number,
  cellW: number,
  cellH: number,
  padX: number,
  padY: number,
): string {
  const rows = values.length;
  const cols = values[0]?.length ?? 0;
  if (rows < 2 || cols < 2) return "";

  const segs: string[] = [];

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      // Visual rows are inverted (row 0 at bottom) — we draw at cell centres.
      const v00 = values[r][c];     // bottom-left (low y_param, low x_param) of this quad
      const v10 = values[r][c + 1]; // bottom-right
      const v01 = values[r + 1][c]; // top-left
      const v11 = values[r + 1][c + 1]; // top-right
      if (v00 == null || v10 == null || v01 == null || v11 == null) continue;

      // Cell centre positions in screen coords. Vertical flip: data row 0
      // is the BOTTOM visual row, so data row r's centre-y is
      // ``padY + (rows - 0.5 - r) * cellH`` (not the - 1 - r - 0.5 form
      // I had before, which floated contours a full cellH too high).
      const p00 = { x: padX + (c + 0.5) * cellW, y: padY + (rows - 0.5 - r) * cellH };
      const p10 = { x: padX + (c + 1.5) * cellW, y: padY + (rows - 0.5 - r) * cellH };
      const p01 = { x: padX + (c + 0.5) * cellW, y: padY + (rows - 1.5 - r) * cellH };
      const p11 = { x: padX + (c + 1.5) * cellW, y: padY + (rows - 1.5 - r) * cellH };

      // Build the bitmask for marching squares (standard 4-corner).
      const b00 = v00 >= threshold ? 1 : 0;
      const b10 = v10 >= threshold ? 2 : 0;
      const b11 = v11 >= threshold ? 4 : 0;
      const b01 = v01 >= threshold ? 8 : 0;
      const code = b00 | b10 | b11 | b01;
      if (code === 0 || code === 15) continue;

      // Helper: linear interpolate between two corners by value.
      const lerpBetween = (
        A: { x: number; y: number }, va: number,
        B: { x: number; y: number }, vb: number,
      ): { x: number; y: number } => {
        const t = (threshold - va) / (vb - va || 1e-9);
        return { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t) };
      };

      const bottom = () => lerpBetween(p00, v00, p10, v10);
      const right = () => lerpBetween(p10, v10, p11, v11);
      const top = () => lerpBetween(p01, v01, p11, v11);
      const left = () => lerpBetween(p00, v00, p01, v01);

      let a: { x: number; y: number } | null = null;
      let b: { x: number; y: number } | null = null;
      switch (code) {
        case 1: case 14: a = left(); b = bottom(); break;
        case 2: case 13: a = bottom(); b = right(); break;
        case 4: case 11: a = right(); b = top(); break;
        case 8: case 7:  a = left(); b = top(); break;
        case 3: case 12: a = left(); b = right(); break;
        case 6: case 9:  a = bottom(); b = top(); break;
        case 5:  // saddle — two segments
          segs.push(`M ${left().x.toFixed(1)} ${left().y.toFixed(1)} L ${bottom().x.toFixed(1)} ${bottom().y.toFixed(1)}`);
          segs.push(`M ${right().x.toFixed(1)} ${right().y.toFixed(1)} L ${top().x.toFixed(1)} ${top().y.toFixed(1)}`);
          continue;
        case 10:
          segs.push(`M ${left().x.toFixed(1)} ${left().y.toFixed(1)} L ${top().x.toFixed(1)} ${top().y.toFixed(1)}`);
          segs.push(`M ${bottom().x.toFixed(1)} ${bottom().y.toFixed(1)} L ${right().x.toFixed(1)} ${right().y.toFixed(1)}`);
          continue;
      }
      if (a && b) {
        segs.push(`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
      }
    }
  }
  return segs.join(" ");
}

/* Silence unused imports that only appear behind feature toggles. */
void hexToLab;
