import { useMemo } from "react";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import { seriesColour, type FocusedCell } from "./StabilityChart";
import {
  AcrossRunsStats,
  BurnVsCameraStats,
  PaletteResidualPC1,
  PerResultStats,
  StatsSeriesEntry,
  computeAcrossRunsStats,
  computeBurnVsCameraStats,
  computePaletteResidualPC1,
  computePerResultStats,
  describePc1Axis,
  signedNum,
} from "./stabilityStatsMath";

export type { StatsSeriesEntry } from "./stabilityStatsMath";

interface Props {
  cells: ValidationCell[];
  series: StatsSeriesEntry[];
  /** Page-wide focused cell. Drives the highlight on the TOP VARIABLE
   *  list + the Max-ΔE links. ``null`` = no focus. */
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  /** Click handler for the per-result card body — opens the per-result
   *  modal on the page. Optional so a future caller without modal
   *  state still gets the bare cards. */
  onResultCardClick?: (resultId: number) => void;
  /** Slot rendered at the top of the scrollable card stack — used by
   *  the page to inject the focused-cell drilldown so it shares the
   *  strip's scroll context with the long-form stat cards. */
  prependSlot?: React.ReactNode;
  /** Number of distinct burns (``retest_index`` values) the selected
   *  results span. 1 = "all photos of the same burn"; the
   *  σ-across-runs / CAMERA σ stats are then pure measurement noise.
   *  ≥2 = "different burns" — the same σ also captures burn-to-burn
   *  variability, which the BurnVsCameraCard now flags so the verdict
   *  is read with the right caveat. ``undefined`` falls back to 1
   *  (single-burn assumption) so legacy callers don't need to thread it. */
  burnsSpanned?: number;
  /** When ``true`` the strip widens (260 → 420 px) to claim the
   *  pixels freed by the collapsed picker rail. Cards inside don't
   *  need any internal layout changes — labels stop ellipsising and
   *  the histogram bars get more dynamic range. */
  widened?: boolean;
}

/**
 * Right strip of the Stability page — one card per selected result
 * carrying mean ΔLab, median ΔE76, the worst-cell anchor, and a hue
 * rotation summary. When 2+ results are loaded an extra "across runs"
 * card surfaces the most-variable cells so the user can chase
 * disagreements down to specific patches.
 */
export function StabilityStats({
  cells,
  series,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onResultCardClick,
  prependSlot,
  burnsSpanned = 1,
  widened = false,
}: Props) {
  const perResult = useMemo(
    () => series.map((s) => computePerResultStats(cells, s)),
    [cells, series],
  );

  const acrossRuns = useMemo(
    () => series.length >= 2 ? computeAcrossRunsStats(cells, series) : null,
    [cells, series],
  );

  const burnVsCamera = useMemo(
    () =>
      series.length >= 2 ? computeBurnVsCameraStats(cells, series) : null,
    [cells, series],
  );

  // PC1 of the (per-cell, burn-mean) residual cloud — surfaces the
  // dominant direction the palette is pulled in. Renders for any
  // non-empty selection; meaningful at ≥3 sampled cells (math returns
  // a stable zero for fewer).
  const residualPC1 = useMemo(
    () => (series.length > 0 ? computePaletteResidualPC1(cells, series) : null),
    [cells, series],
  );

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col min-h-0 transition-[width] duration-150",
        widened ? "w-[420px]" : "w-[260px]",
        "border-l border-[color:var(--color-border)]",
        "bg-[color:var(--color-surface)]",
      )}
    >
      <div className="px-3 py-2 border-b border-[color:var(--color-border)]">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          Stats
        </span>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-scroll p-3 flex flex-col gap-3"
        style={{ scrollbarGutter: "stable" }}
      >
        {prependSlot}
        {series.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
            No results selected
          </div>
        ) : (
          <>
            {/* Per-result cards are aggregate-per-run (mean Δ, median
                ΔE…). When the user has PINNED a cell (clicked it),
                those run-level aggregates are no longer the question
                and they drown the strip — hide them so the focused-
                cell panel above gets the spotlight. Transient hover
                does NOT hide them: that would cause a layout-shift
                loop where the row under the cursor moves out of
                reach. */}
            {focusedCell?.kind !== "pinned" &&
              perResult.map((stat, i) => (
                <ResultStatCard
                  key={stat.resultId}
                  stat={stat}
                  colour={seriesColour(i)}
                  focusedCell={focusedCell}
                  onHover={onHover}
                  onHoverLeave={onHoverLeave}
                  onClick={onClick}
                  onCardClick={
                    onResultCardClick
                      ? () => onResultCardClick(stat.resultId)
                      : undefined
                  }
                />
              ))}
            {burnVsCamera && (
              <BurnVsCameraCard
                stats={burnVsCamera}
                focusedCell={focusedCell}
                onHover={onHover}
                onHoverLeave={onHoverLeave}
                onClick={onClick}
                burnsSpanned={burnsSpanned}
              />
            )}
            {residualPC1 && residualPC1.sampleCount >= 3 && (
              <PaletteDriftCard pc1={residualPC1} />
            )}
            {acrossRuns && (
              <AcrossRunsCard
                stats={acrossRuns}
                focusedCell={focusedCell}
                onHover={onHover}
                onHoverLeave={onHoverLeave}
                onClick={onClick}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/* ─── Per-result card ──────────────────────────────────────────────────── */

function ResultStatCard({
  stat,
  colour,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onCardClick,
}: {
  stat: PerResultStats;
  colour: string;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  /** Open this result in the per-result modal. ``undefined`` keeps the
   *  card non-clickable (legacy behaviour). */
  onCardClick?: () => void;
}) {
  // Using a wrapping <div> so the existing Max-ΔE button can still bind
  // its own click without nested-button issues. The card-level click
  // bubbles up from a transparent backdrop button rendered inside the
  // header so the per-cell focus link in the body keeps working.
  const interactive = onCardClick != null;
  return (
    <div
      className={cn(
        "relative rounded-[8px] border bg-[color:var(--color-surface-elevated)] overflow-hidden",
        "border-[color:var(--color-border)]",
        interactive &&
          "transition-colors hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/30",
      )}
    >
      <header className="relative flex items-center gap-2 px-2.5 py-1.5 border-b border-[color:var(--color-border)]/60">
        {interactive && (
          <button
            type="button"
            onClick={onCardClick}
            aria-label={`Open result ${stat.resultId} modal`}
            title="Open warped photo + stats"
            className={cn(
              "absolute inset-0 z-0",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color:var(--color-primary)]/60",
            )}
          />
        )}
        <span
          aria-hidden
          className="relative z-[1] h-2.5 w-2.5 rounded-full shrink-0"
          style={{ background: colour }}
        />
        <div className="relative z-[1] flex-1 min-w-0 pointer-events-none">
          <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)] truncate">
            {stat.label}
          </div>
          <div className="font-mono text-[9px] tracking-[0.06em] text-[color:var(--color-ink-subtle)] truncate">
            id {stat.resultId} · {stat.sampleCount}/{stat.totalCells} cells
          </div>
        </div>
        {interactive && (
          <span
            aria-hidden
            className="relative z-[1] font-mono text-[10px] leading-none text-[color:var(--color-ink-subtle)] pointer-events-none"
            title="open"
          >
            ⤴
          </span>
        )}
      </header>
      {stat.sampleCount === 0 ? (
        <div className="px-2.5 py-3 text-center font-mono text-[9.5px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
          No matched cells
        </div>
      ) : (
        <dl className="flex flex-col">
          <StatRow
            label="Mean Δ"
            value={`ΔL ${signedNum(stat.meanDeltaL)} · Δa ${signedNum(stat.meanDeltaA)} · Δb ${signedNum(stat.meanDeltaB)}`}
          />
          <StatRow
            label="Median ΔE"
            value={stat.medianDeltaE.toFixed(2)}
          />
          <StatRow
            label="Max ΔE"
            value={
              <FocusButton
                cellIndex={stat.worstCellIndex}
                primary={stat.maxDeltaE.toFixed(2)}
                focusedCell={focusedCell}
                onHover={onHover}
                onHoverLeave={onHoverLeave}
                onClick={onClick}
              />
            }
          />
          <StatRow
            label="Δhue mean"
            value={`${signedNum(stat.meanDeltaHue, 1)}°`}
          />
        </dl>
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 px-2.5 py-1.5",
        "border-t border-[color:var(--color-border)]/40 first:border-t-0",
      )}
    >
      <dt className="font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] shrink-0">
        {label}
      </dt>
      <dd className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)] text-right truncate">
        {value}
      </dd>
    </div>
  );
}

/* ─── Burn vs camera card ──────────────────────────────────────────────── */

function BurnVsCameraCard({
  stats,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  burnsSpanned,
}: {
  stats: BurnVsCameraStats;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  burnsSpanned: number;
}) {
  // When the selected results span more than one burn (different
  // ``retest_index`` values), the σ stat captures camera + burn-to-
  // burn variance combined. When they're all the same burn, σ is
  // pure camera/lighting noise. The verdict is the same arithmetic
  // either way; the caption flags the interpretation so the reader
  // doesn't mis-attribute.
  const mixedBurns = burnsSpanned >= 2;
  // Burn-dominant ≥3:1 → the burn really is biased and a colour shift
  // would help; camera-dominant ≤1:3 → the burn is fine and the camera
  // is the noisy element. Anything in between reads as balanced —
  // worth tuning either side, neither is the smoking gun.
  let verdict: "BURN DOMINATES" | "CAMERA DOMINATES" | "BALANCED" = "BALANCED";
  if (stats.ratio != null) {
    if (stats.ratio >= 3) verdict = "BURN DOMINATES";
    else if (stats.ratio <= 1 / 3) verdict = "CAMERA DOMINATES";
  }
  const burnSum = stats.medianBurnDeltaE;
  const cameraSum = stats.medianCameraSigma;
  const denom = burnSum + cameraSum;
  const burnFrac = denom > 0 ? burnSum / denom : 0;
  const burnPct = (burnFrac * 100).toFixed(1);
  const cameraPct = (100 - burnFrac * 100).toFixed(1);
  return (
    <div className="rounded-[8px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 overflow-hidden">
      <header className="px-2.5 py-1.5 border-b border-[color:var(--color-primary)]/30">
        <div className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
          Burn vs camera
        </div>
      </header>
      <dl className="flex flex-col">
        <StatRow
          label="Burn ΔE"
          value={`median ${stats.medianBurnDeltaE.toFixed(2)}`}
        />
        <StatRow
          label={mixedBurns ? "Run σ" : "Camera σ"}
          value={`median ${stats.medianCameraSigma.toFixed(2)}`}
        />
        <StatRow
          label="Ratio"
          value={
            stats.ratio == null
              ? "—"
              : `${stats.ratio.toFixed(1)} ×`
          }
        />
      </dl>
      <div className="px-2.5 pb-2 pt-1">
        {/* 100 % stacked bar — the eye picks up "where is the error coming
            from" before the user reads the numerical ratio. Width 100 %
            of the card, 6 px tall, primary tint on the burn side, ink-
            subtle on the camera side. */}
        <div
          className="flex h-[6px] w-full overflow-hidden rounded-[2px] border border-[color:var(--color-border)]"
          aria-hidden
          title={`burn ${burnPct}% · camera ${cameraPct}%`}
        >
          <div
            className="h-full bg-[color:var(--color-primary)]"
            style={{ width: `${burnPct}%` }}
          />
          <div
            className="h-full bg-[color:var(--color-ink-subtle)]"
            style={{ width: `${cameraPct}%` }}
          />
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          {verdict}
        </div>
        {mixedBurns && (
          <div className="mt-1 font-mono text-[9.5px] leading-snug text-[color:var(--color-ink-muted)] normal-case tracking-normal">
            Mixed burns selected — σ captures camera + burn-to-burn
            variance combined. Pick photos of a single burn for a
            pure-camera read.
          </div>
        )}
      </div>
      {(stats.worstBurn || stats.worstCamera) && (
        <div className="px-2.5 pt-1.5 pb-2.5 border-t border-[color:var(--color-primary)]/30 flex flex-col gap-0.5">
          {stats.worstBurn && (
            <WorstRow
              label="Worst burn"
              cellIndex={stats.worstBurn.cellIndex}
              valueLabel={`ΔE ${stats.worstBurn.value.toFixed(2)}`}
              focusedCell={focusedCell}
              onHover={onHover}
              onHoverLeave={onHoverLeave}
              onClick={onClick}
            />
          )}
          {stats.worstCamera && (
            <WorstRow
              label="Worst camera"
              cellIndex={stats.worstCamera.cellIndex}
              valueLabel={`σ ${stats.worstCamera.value.toFixed(2)}`}
              focusedCell={focusedCell}
              onHover={onHover}
              onHoverLeave={onHoverLeave}
              onClick={onClick}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Palette drift (PC1) card ────────────────────────────────────────── */

function PaletteDriftCard({ pc1 }: { pc1: PaletteResidualPC1 }) {
  const hint = describePc1Axis(pc1);
  const ratio = pc1.varianceRatio;
  // Verdict: high variance ratio = the burn drift is unidirectional →
  // a single global shift would help. Low ratio = drift is diffuse →
  // colour-dependent, no single offset will fix it.
  let verdict: string;
  if (ratio >= 0.6) verdict = "Single shift fits";
  else if (ratio >= 0.4) verdict = "Mostly aligned";
  else verdict = "Diffuse";
  // Magnitude of the centroid → how far the average residual is from
  // zero. Read it as "the average cell is this much off, and PC1
  // points the way".
  const meanMag = Math.hypot(
    pc1.meanDelta.L,
    pc1.meanDelta.a,
    pc1.meanDelta.b,
  );
  const ratioPct = Math.round(ratio * 100);
  return (
    <div className="rounded-[8px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 overflow-hidden">
      <header className="px-2.5 py-1.5 border-b border-[color:var(--color-primary)]/30">
        <div className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
          Palette drift · PC1
        </div>
      </header>
      <dl className="flex flex-col">
        <StatRow
          label="Direction"
          value={hint ?? "—"}
        />
        <StatRow
          label="Mean Δ"
          value={`${meanMag.toFixed(2)} Lab`}
        />
        <StatRow
          label="Variance"
          value={`${ratioPct}% on PC1`}
        />
      </dl>
      <div className="px-2.5 pb-2 pt-1">
        {/* Variance-explained bar — primary on the PC1 share, ink-subtle on
            the residual perpendicular variance. The fuller the primary bar,
            the more the palette's whole drift is captured by one direction. */}
        <div
          className="flex h-[6px] w-full overflow-hidden rounded-[2px] border border-[color:var(--color-border)]"
          aria-hidden
          title={`PC1 explains ${ratioPct}% of residual variance`}
        >
          <div
            className="h-full bg-[color:var(--color-primary)]"
            style={{ width: `${ratioPct}%` }}
          />
          <div
            className="h-full bg-[color:var(--color-ink-subtle)]"
            style={{ width: `${100 - ratioPct}%` }}
          />
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          {verdict}
        </div>
        {/* Component breakdown — Lab axis weights inside PC1, signed so
            the reader can map "warmer + brighter" back to the actual
            channel deltas without needing to remember the axis. */}
        <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[10px] tabular-nums text-[color:var(--color-ink)]">
          <span>
            <span className="text-[color:var(--color-ink-subtle)] mr-0.5">ΔL</span>
            {signedNum(pc1.meanDelta.L)}
          </span>
          <span>
            <span className="text-[color:var(--color-ink-subtle)] mr-0.5">Δa</span>
            {signedNum(pc1.meanDelta.a)}
          </span>
          <span>
            <span className="text-[color:var(--color-ink-subtle)] mr-0.5">Δb</span>
            {signedNum(pc1.meanDelta.b)}
          </span>
        </div>
      </div>
    </div>
  );
}

function WorstRow({
  label,
  cellIndex,
  valueLabel,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
}: {
  label: string;
  cellIndex: number;
  valueLabel: string;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
}) {
  const isFocused =
    focusedCell != null && focusedCell.cellIndex === cellIndex;
  const isPinned =
    focusedCell?.kind === "pinned" && focusedCell.cellIndex === cellIndex;
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(cellIndex)}
      onMouseLeave={onHoverLeave}
      onClick={() => onClick(cellIndex)}
      aria-pressed={isPinned}
      className={cn(
        "w-full flex items-baseline justify-between gap-2",
        "font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded-[3px]",
        "transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
        isFocused
          ? "bg-[color:var(--color-primary)]/12 text-[color:var(--color-primary)] border-l-2 border-[color:var(--color-primary)]"
          : "border-l-2 border-transparent text-[color:var(--color-ink)] hover:text-[color:var(--color-primary)]",
      )}
    >
      <span className="text-left font-mono text-[9px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-mono text-[10px] tabular-nums",
            isFocused
              ? "text-[color:var(--color-primary)]"
              : "text-[color:var(--color-ink)]",
          )}
        >
          cell #{cellIndex}
        </span>
        <span
          className={cn(
            isFocused
              ? "text-[color:var(--color-primary)]/80"
              : "text-[color:var(--color-ink-subtle)]",
          )}
        >
          {valueLabel}
        </span>
      </span>
    </button>
  );
}

/* ─── Across-runs card ─────────────────────────────────────────────────── */

function AcrossRunsCard({
  stats,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
}: {
  stats: AcrossRunsStats;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
}) {
  return (
    <div className="rounded-[8px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 overflow-hidden">
      <header className="px-2.5 py-1.5 border-b border-[color:var(--color-primary)]/30">
        <div className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
          σ across runs
        </div>
      </header>
      <dl className="flex flex-col">
        <StatRow label="Median σ" value={stats.medianSigma.toFixed(2)} />
        <StatRow
          label="Worst σ"
          value={
            <FocusButton
              cellIndex={stats.worstSigma.cellIndex}
              primary={stats.worstSigma.value.toFixed(2)}
              focusedCell={focusedCell}
              onHover={onHover}
              onHoverLeave={onHoverLeave}
              onClick={onClick}
            />
          }
        />
      </dl>
      {stats.topVariable.length > 0 && (
        <div className="px-2.5 pt-2 pb-2.5 border-t border-[color:var(--color-primary)]/30">
          <div className="font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] mb-1">
            Top variable
          </div>
          <ul className="flex flex-col gap-0.5">
            {stats.topVariable.map((row) => {
              const isFocused =
                focusedCell != null && focusedCell.cellIndex === row.cellIndex;
              const isPinned =
                focusedCell?.kind === "pinned" &&
                focusedCell.cellIndex === row.cellIndex;
              return (
                <li key={row.cellIndex}>
                  <button
                    type="button"
                    onMouseEnter={() => onHover(row.cellIndex)}
                    onMouseLeave={onHoverLeave}
                    onClick={() => onClick(row.cellIndex)}
                    aria-pressed={isPinned}
                    className={cn(
                      "w-full flex items-baseline justify-between gap-2",
                      "font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded-[3px]",
                      "transition-colors",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
                      isFocused
                        ? "bg-[color:var(--color-primary)]/12 text-[color:var(--color-primary)] border-l-2 border-[color:var(--color-primary)]"
                        : "border-l-2 border-transparent text-[color:var(--color-ink)] hover:text-[color:var(--color-primary)]",
                    )}
                  >
                    <span className="text-left">cell #{row.cellIndex}</span>
                    <span
                      className={cn(
                        isFocused
                          ? "text-[color:var(--color-primary)]/80"
                          : "text-[color:var(--color-ink-subtle)]",
                      )}
                    >
                      σ {row.sigma.toFixed(2)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function FocusButton({
  cellIndex,
  primary,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
}: {
  cellIndex: number | null;
  primary: string;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
}) {
  const isFocused =
    cellIndex != null &&
    focusedCell != null &&
    focusedCell.cellIndex === cellIndex;
  return (
    <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
      {primary}
      {cellIndex != null && (
        <>
          {" "}
          <button
            type="button"
            onMouseEnter={() => onHover(cellIndex)}
            onMouseLeave={onHoverLeave}
            onClick={() => onClick(cellIndex)}
            className={cn(
              "font-mono text-[10.5px] tabular-nums",
              "underline-offset-2 hover:underline",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60 rounded-[3px]",
              isFocused
                ? "text-[color:var(--color-primary)] font-semibold"
                : "text-[color:var(--color-primary)]/85",
            )}
          >
            (cell #{cellIndex})
          </button>
        </>
      )}
    </span>
  );
}
