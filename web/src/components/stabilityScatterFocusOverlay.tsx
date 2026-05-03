import {
  seriesColour,
  type AxisMeta,
  type SeriesInput,
} from "./stabilityChartMath";
import type { ScatterRow } from "./StabilityScatter";
import type { FocusedCell } from "./StabilityChart";
import { StabilityHoverCard } from "./stabilityChartTooltip";

/**
 * Focus-overlay layer for the stability scatter. Draws halos around
 * every series dot whose `cell_index` matches the page's focused cell,
 * a faint vertical guide at the focused dot's x position, and (when
 * focus is pinned) a sticky tooltip card anchored to the topmost
 * focused dot. Lives in its own file so `StabilityScatter.tsx` stays
 * inside the documented line budget.
 *
 * The component is presentation-only — it does not own focus state.
 */

export interface FocusOverlayProps {
  rows: ScatterRow[];
  series: SeriesInput[];
  xMeta: AxisMeta;
  yMeta: AxisMeta;
  focusedCell: FocusedCell;
  /** Already-projected pixel coordinates per series for the focused
   *  cell's row, mirroring `rowSpread` order. `null` for series that
   *  didn't sample the focused cell. */
  perSeriesPx: ({ x: number; y: number; sIdx: number } | null)[];
  /** Topmost focused dot in screen-space — used as the sticky tooltip
   *  anchor when focus is pinned. `null` when no series sampled the
   *  focused cell. */
  topAnchor: { x: number; y: number } | null;
  /** Plot edges so the guide line stretches the full chart height. */
  plotTop: number;
  plotBottom: number;
  plotLeft: number;
  plotRight: number;
  /** SVG viewBox dimensions for the pinned tooltip's percent maths. */
  W: number;
  H: number;
  /** Spread (max - min Y across runs) for the focused row. `null` when
   *  fewer than two runs sampled the cell. */
  focusedSpread: number | null;
}

export function ScatterFocusHalos({
  rows,
  focusedCell,
  perSeriesPx,
  plotTop,
  plotBottom,
}: FocusOverlayProps) {
  if (focusedCell == null) return null;
  const focusedRow = rows.find(
    (r) => r.cell.cell_index === focusedCell.cellIndex,
  );
  if (!focusedRow) return null;
  const pinned = focusedCell.kind === "pinned";
  const ringOpacity = pinned ? 0.95 : 0.6;
  const ringWidth = pinned ? 2.4 : 2;
  // Vertical guide x: pulled from the row's projected x. We rely on
  // the parent's xToPx — accessible because perSeriesPx already has
  // them, so we take the first finite one.
  const guideX = perSeriesPx.find((p) => p != null)?.x ?? null;
  return (
    <g aria-hidden>
      {guideX != null && (
        <line
          x1={guideX}
          x2={guideX}
          y1={plotTop}
          y2={plotBottom}
          stroke="var(--color-primary)"
          strokeWidth={1}
          opacity={pinned ? 0.45 : 0.3}
          strokeDasharray={pinned ? undefined : "4 4"}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {perSeriesPx.map((p) =>
        p == null ? null : (
          <circle
            key={`focus-halo-${p.sIdx}`}
            cx={p.x}
            cy={p.y}
            r={7}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={ringWidth}
            opacity={ringOpacity}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </g>
  );
}

/** Sticky pinned tooltip card. Re-uses the existing hover-card so
 *  visual register matches; spread/trend rows are hidden because the
 *  pinned card is meant to read like a snapshot of the cell, not the
 *  hover-time bin context. */
export function ScatterFocusPinnedCard({
  rows,
  series,
  xMeta,
  yMeta,
  focusedCell,
  topAnchor,
  W,
  H,
  focusedSpread,
}: FocusOverlayProps) {
  if (focusedCell?.kind !== "pinned") return null;
  if (topAnchor == null) return null;
  const focusedRow = rows.find(
    (r) => r.cell.cell_index === focusedCell.cellIndex,
  );
  if (!focusedRow) return null;
  return (
    <StabilityHoverCard
      row={focusedRow}
      series={series}
      xMeta={xMeta}
      yMeta={yMeta}
      spread={focusedSpread}
      trendRows={null}
      anchorPx={topAnchor}
      plotW={W}
      plotH={H}
    />
  );
}

/** Pull the dot colour out of the palette for callers that want to
 *  echo it next to the halo (currently unused but kept here so the
 *  overlay file owns the visual contract end-to-end). */
export function focusDotColour(sIdx: number): string {
  return seriesColour(sIdx);
}
