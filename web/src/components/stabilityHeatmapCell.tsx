import {
  cellTintCss,
  type HeatmapCell,
  type HeatmapMetric,
} from "./stabilityHeatmapMath";
import type { FocusedCell } from "./StabilityChart";

/**
 * Per-cell renderer for the spatial heatmap. Lives in its own file so
 * `StabilityHeatmap.tsx` stays inside the documented line budget after
 * iter 4's focus + outline rendering. Pure presentation: takes a
 * `HeatmapCell` (or null for an empty grid position) and emits the
 * background tint, expected-hex bar, hover/focus outlines, and the
 * mouse handlers that bridge to the page-wide focus state.
 */

interface Props {
  /** Position on the workpiece grid. The empty-cell branch uses these
   *  to draw a hatch placeholder. */
  row: number;
  col: number;
  /** `null` when the (row, col) has no validation cell — empty
   *  position gets the diagonal hatch. */
  cell: HeatmapCell | null;
  /** Pixel position of the cell's top-left within the SVG viewBox. */
  x: number;
  y: number;
  /** Square cell side in viewBox px. */
  size: number;
  /** Active heatmap metric, used to drive the tint ramp. */
  metric: HeatmapMetric;
  range: { min: number; max: number };
  /** When false, every populated cell renders with the surface tint
   *  rather than its metric ramp colour (e.g. σ on <2 runs). */
  hasAnyData: boolean;
  tooFewRunsForSigma: boolean;
  isHovered: boolean;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onClick: (cellIndex: number) => void;
  onBackgroundClear: () => void;
  onSetHoverKey: (key: string | null) => void;
}

export function HeatmapCellRect({
  row,
  col,
  cell,
  x,
  y,
  size,
  metric,
  range,
  hasAnyData,
  tooFewRunsForSigma,
  isHovered,
  focusedCell,
  onHover,
  onClick,
  onBackgroundClear,
  onSetHoverKey,
}: Props) {
  const key = `${row}.${col}`;
  if (!cell) {
    return (
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        fill="url(#heatmap-empty-hatch)"
        stroke="var(--color-border)"
        strokeWidth={0.5}
        opacity={0.7}
        onClick={(e) => {
          // Treat empty-grid clicks as "background" so they clear an
          // active focus rather than pin a non-existent cell.
          e.stopPropagation();
          onBackgroundClear();
        }}
      />
    );
  }
  const tint =
    hasAnyData && !tooFewRunsForSigma
      ? cellTintCss(metric, cell.value, range) ?? "var(--color-surface)"
      : "var(--color-surface)";
  const isFocused =
    focusedCell != null && focusedCell.cellIndex === cell.cellIndex;
  const isPinned =
    focusedCell?.kind === "pinned" &&
    focusedCell.cellIndex === cell.cellIndex;
  return (
    <g
      onMouseEnter={() => {
        onSetHoverKey(key);
        onHover(cell.cellIndex);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(cell.cellIndex);
      }}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        fill={tint}
        stroke={isHovered ? "var(--color-primary)" : "var(--color-border)"}
        strokeWidth={isHovered ? 1.5 : 0.5}
      />
      {/* Expected-hex bar — anchors the cell to its target colour. */}
      <rect
        x={x + 1}
        y={y + size - 9}
        width={size - 2}
        height={8}
        fill={cell.expectedHex}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth={0.5}
      />
      {/* Focus outline — inset by 1 px so the cell square doesn't
          visually grow. Pinned focus = full opacity / 2 px stroke;
          transient = thinner and softer. */}
      {isFocused && (
        <rect
          x={x + 1}
          y={y + 1}
          width={size - 2}
          height={size - 2}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={isPinned ? 2 : 1.5}
          opacity={isPinned ? 1 : 0.7}
          pointerEvents="none"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}
