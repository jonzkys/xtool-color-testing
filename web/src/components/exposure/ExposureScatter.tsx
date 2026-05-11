import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hueDeg, chroma as chromaFn } from "../../color/math";
import { niceBounds, niceTicks } from "../stabilityChartMath";
import type { ChannelCol, ExposureRow, IndexRow } from "./exposureCorrelations";
import { logLinearRegression, fmtIndexTick, quantile } from "./exposureMath";
import { ExposureFamilyTrace } from "./ExposureFamilyTrace";
import type { FamilyMember } from "./recipeFamilies";
import { HelpTip } from "../HelpTip";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_CHANNEL_HELP,
  type ExposureIndexHelp,
} from "./exposureHelpCopy";
import {
  ChannelCardBody,
  IndexCardBody,
} from "./ExposureHelpCardBody";
import { ExposureAxisPicker } from "./ExposureAxisPicker";
import { ExposurePolygon } from "./ExposurePolygon";
import { ExposurePolygonDraw } from "./ExposurePolygonDraw";
import { ExposureCellsPreview } from "./ExposureCellsPreview";
import type { Polygon } from "./proposeTestMath";

export type ScaleKind = "linear" | "log";
export type ScatterMode = "univariate" | "bivariate";

/** Viewport bounds — always expressed in the SAME space as the active scale
 *  (i.e. log10-of-value when xScale=='log'; raw value when 'linear'). This
 *  matches what the px/py projection helpers expect, so the override slots
 *  in without extra conversion. */
export interface ScatterViewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

interface Props {
  rows: readonly ExposureRow[];
  mode: ScatterMode;
  xKey: IndexRow;
  yKey: ChannelCol | IndexRow;
  xScale: ScaleKind;
  yScale: ScaleKind;
  focusedId: number | null;
  onHover: (id: number) => void;
  onLeave: () => void;
  onClick: (id: number) => void;
  /** Optional: dim out-of-range entries (Exposure brush). null = no dim. */
  dimRange?: readonly [number, number] | null;
  /** Optional: family members to trace as a polyline behind the dots. */
  family?: readonly FamilyMember[];
  /** When true, axis bounds clamp to 1st/99th percentile, hiding extreme outliers. Default false. */
  trimOutliers?: boolean;
  /** Optional callback fired with the count of dots hidden by trimOutliers. */
  onOffChartCount?: (count: number) => void;
  /** Optional: clicking the X label opens an axis picker that calls this. */
  onXKeyChange?: (k: IndexRow) => void;
  /** Optional: clicking the Y label opens an axis picker that calls this. */
  onYKeyChange?: (k: ChannelCol | IndexRow) => void;
  /** Optional: log/linear scale toggle for the X axis. */
  onXScaleChange?: (s: ScaleKind) => void;
  /** Optional: log/linear scale toggle for the Y axis. */
  onYScaleChange?: (s: ScaleKind) => void;
  /** Optional: PROPOSE TEST polygon overlay (closed or in-progress). */
  polygon?: Polygon | null;
  /** When true, render the click-capture rect and dim dot pointer events. */
  polygonDrawing?: boolean;
  /** Optional: dashed curve preview (curve mode). */
  curve?: ReadonlyArray<{ x: number; y: number }> | null;
  /** Optional: N proposed cell markers. */
  cells?: ReadonlyArray<{ x: number; y: number }> | null;
  /** Called on each click while drawing — adds a vertex in index-space. */
  onPolygonVertexAdd?: (point: readonly [number, number]) => void;
  /** Called when the user closes the polygon (double-click or Enter). */
  onPolygonClose?: () => void;
  /** Called when the user cancels drawing (Esc). */
  onPolygonCancel?: () => void;
  /** Called continuously while a polygon vertex is being dragged (after
   *  the polygon has closed). */
  onPolygonVertexMove?: (vertexIndex: number, newPoint: readonly [number, number]) => void;
  /** Optional viewport override. When set, the plot uses these bounds
   *  instead of computing from the data; null/undefined = auto-fit. */
  viewport?: ScatterViewport | null;
  /** Called when the user changes the viewport via wheel/drag/box-zoom. */
  onViewportChange?: (next: ScatterViewport | null) => void;
}

function rowChannel(row: ExposureRow, key: ChannelCol): number {
  const [l, a, b] = row.lab;
  switch (key) {
    case "L":      return l;
    case "a":      return a;
    case "b":      return b;
    case "hue":    return hueDeg(a, b);
    case "chroma": return chromaFn(a, b);
  }
}

function rowIndex(row: ExposureRow, key: IndexRow): number {
  return (row.indices[key] as number | null) ?? NaN;
}

const W = 680;
const H = 380;
const PADL = 64;
const PADR = 28;
const PADT = 28;
const PADB = 60;

const INDEX_PRETTY: Record<IndexRow, string> = {
  pulse_spacing_mm: "PULSE SPACING (mm)",
  line_spacing_mm: "LINE SPACING (mm)",
  pulse_energy_index: "PULSE ENERGY IDX",
  pulse_intensity_index: "PULSE INTENSITY IDX",
  total_exposure_index: "TOTAL EXPOSURE IDX",
  ablation_aggression_index: "ABLATION AGGRESSION IDX",
  delivery_smoothness_index: "DELIVERY SMOOTHNESS IDX",
};

const CHANNEL_PRETTY: Record<ChannelCol, string> = {
  L: "L*  (LIGHTNESS)",
  a: "a*  (RED ↔ GREEN)",
  b: "b*  (YELLOW ↔ BLUE)",
  hue: "h°  (HUE)",
  chroma: "C*  (CHROMA)",
};


export const ExposureScatter: React.FC<Props> = ({
  rows,
  mode,
  xKey,
  yKey,
  xScale,
  yScale,
  focusedId,
  onHover,
  onLeave,
  onClick,
  dimRange,
  family,
  trimOutliers = false,
  onOffChartCount,
  onXKeyChange,
  onYKeyChange,
  onXScaleChange,
  onYScaleChange,
  polygon,
  polygonDrawing,
  curve,
  cells,
  onPolygonVertexAdd,
  onPolygonClose,
  onPolygonCancel,
  onPolygonVertexMove,
  viewport,
  onViewportChange,
}) => {
  const xs = rows.map((r) => rowIndex(r, xKey));
  const ys = rows.map((r) =>
    mode === "univariate"
      ? rowChannel(r, yKey as ChannelCol)
      : rowIndex(r, yKey as IndexRow),
  );

  const xsForScale = xScale === "log"
    ? xs.filter((v) => Number.isFinite(v) && v > 0).map((v) => Math.log10(v))
    : xs.filter((v) => Number.isFinite(v));
  const ysForScale = yScale === "log"
    ? ys.filter((v) => Number.isFinite(v) && v > 0).map((v) => Math.log10(v))
    : ys.filter((v) => Number.isFinite(v));

  const { min: xMinRaw, max: xMaxRaw } = niceBounds(xsForScale, null);
  const { min: yMinRaw, max: yMaxRaw } = niceBounds(ysForScale, null);

  // When trimOutliers is on, clamp bounds to 1st/99th percentile of in-scope data.
  const xLo = trimOutliers ? quantile(xsForScale, 0.01) : xMinRaw;
  const xHi = trimOutliers ? quantile(xsForScale, 0.99) : xMaxRaw;
  const yLo = trimOutliers ? quantile(ysForScale, 0.01) : yMinRaw;
  const yHi = trimOutliers ? quantile(ysForScale, 0.99) : yMaxRaw;

  // Pad bounds by 5% of range so dots don't sit on the frame edge.
  const xPad = (xHi - xLo) * 0.05;
  const yPad = (yHi - yLo) * 0.05;
  const autoXMin = xLo - xPad;
  const autoXMax = xHi + xPad;
  const autoYMin = yLo - yPad;
  const autoYMax = yHi + yPad;

  // When the parent has set a viewport, use it verbatim — wheel zoom and
  // box-zoom feed the same coordinate space the px/py helpers consume.
  const xMin = viewport ? viewport.xMin : autoXMin;
  const xMax = viewport ? viewport.xMax : autoXMax;
  const yMin = viewport ? viewport.yMin : autoYMin;
  const yMax = viewport ? viewport.yMax : autoYMax;

  const px = (v: number) => {
    const t = ((xScale === "log" ? Math.log10(v) : v) - xMin) / (xMax - xMin || 1);
    return PADL + t * (W - PADL - PADR);
  };
  const py = (v: number) => {
    const t = ((yScale === "log" ? Math.log10(v) : v) - yMin) / (yMax - yMin || 1);
    return H - PADB - t * (H - PADT - PADB);
  };

  // PROPOSE TEST projection helpers — pair with px/py for the inverse direction.
  const toSvg = (x: number, y: number): readonly [number, number] => [px(x), py(y)];
  const fromSvg = (sx: number, sy: number): readonly [number, number] => {
    const tX = (sx - PADL) / (W - PADL - PADR || 1);
    const xVal = xMin + tX * (xMax - xMin);
    const x = xScale === "log" ? Math.pow(10, xVal) : xVal;
    const tY = (H - PADB - sy) / (H - PADT - PADB || 1);
    const yVal = yMin + tY * (yMax - yMin);
    const y = yScale === "log" ? Math.pow(10, yVal) : yVal;
    return [x, y];
  };

  const fit =
    mode === "univariate"
      ? logLinearRegression(xs, ys)
      : null;

  const xTicks = niceTicks(xMin, xMax, 5);
  const yTicks = niceTicks(yMin, yMax, 5);

  const isInDimRange = (row: ExposureRow): boolean => {
    if (!dimRange) return true;
    // dimRange is always compared against total_exposure_index —
    // the brush is anchored to that axis regardless of xKey (per spec).
    const v = row.indices.total_exposure_index as number;
    return v >= dimRange[0] && v <= dimRange[1];
  };

  const positiveXs = xs.filter((v) => Number.isFinite(v) && v > 0);
  const minPosX = positiveXs.length > 0 ? Math.min(...positiveXs) : 1;
  const finiteXs = xs.filter(Number.isFinite);
  const maxX = finiteXs.length > 0 ? Math.max(...finiteXs) : 1;

  // Off-chart count: dots whose scaled coordinates fall outside the clamped bounds.
  const offChartCount = React.useMemo(() => {
    if (!trimOutliers) return 0;
    let n = 0;
    for (const row of rows) {
      const x = rowIndex(row, xKey);
      const y = mode === "univariate"
        ? rowChannel(row, yKey as ChannelCol)
        : rowIndex(row, yKey as IndexRow);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const xCheck = xScale === "log" ? Math.log10(Math.max(1e-9, x)) : x;
      const yCheck = yScale === "log" ? Math.log10(Math.max(1e-9, y)) : y;
      if (xCheck < xMin || xCheck > xMax || yCheck < yMin || yCheck > yMax) n++;
    }
    return n;
  }, [rows, xKey, yKey, mode, xScale, yScale, xMin, xMax, yMin, yMax, trimOutliers]);

  React.useEffect(() => {
    onOffChartCount?.(offChartCount);
  }, [offChartCount, onOffChartCount]);

  // Picker state for click-to-open axis pickers
  const xLabelRef = useRef<HTMLDivElement | null>(null);
  const yLabelRef = useRef<HTMLDivElement | null>(null);
  const [xPickerOpen, setXPickerOpen] = useState(false);
  const [yPickerOpen, setYPickerOpen] = useState(false);

  useEffect(() => {
    if (!xPickerOpen && !yPickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      const t = e.target;
      if (xLabelRef.current?.contains(t)) return;
      if (yLabelRef.current?.contains(t)) return;
      const tip = document.querySelector('[data-axis-picker]');
      if (tip && tip.contains(t)) return;
      setXPickerOpen(false);
      setYPickerOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [xPickerOpen, yPickerOpen]);

  // ── Zoom / pan / box-zoom ──────────────────────────────────────────
  // All bounds (xMin/xMax/yMin/yMax) and the rect from svgPointToData
  // live in *scaled* space — log10-of-value when xScale==='log', raw
  // value otherwise. The wheel/drag handlers operate in that space so
  // no extra projection logic is needed.

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [boxZoom, setBoxZoom] = useState<{
    sx0: number; sy0: number; sx1: number; sy1: number;
  } | null>(null);

  /** Convert client-pixel coords from a mouse event into SVG viewport
   *  units (i.e. the coordinate system viewBox lives in). The chart
   *  uses preserveAspectRatio so the displayed size differs from the
   *  intrinsic W×H — we account for that via getBoundingClientRect. */
  const clientToSvg = React.useCallback(
    (clientX: number, clientY: number): readonly [number, number] | null => {
      const el = svgRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      // preserveAspectRatio xMidYMid meet → scale to fit, keep aspect
      const scale = Math.min(rect.width / W, rect.height / H);
      const drawW = W * scale;
      const drawH = H * scale;
      const offX = (rect.width - drawW) / 2;
      const offY = (rect.height - drawH) / 2;
      const sx = (clientX - rect.left - offX) / scale;
      const sy = (clientY - rect.top - offY) / scale;
      return [sx, sy];
    },
    [],
  );

  /** Convert an (sx, sy) point in SVG viewport coords into scaled data
   *  coords (the space xMin/xMax/yMin/yMax live in). */
  const svgPointToData = React.useCallback(
    (sx: number, sy: number): readonly [number, number] => {
      const tX = (sx - PADL) / (W - PADL - PADR || 1);
      const tY = (H - PADB - sy) / (H - PADT - PADB || 1);
      return [xMin + tX * (xMax - xMin), yMin + tY * (yMax - yMin)];
    },
    [xMin, xMax, yMin, yMax],
  );

  /** True when the SVG coord is inside the plot rectangle. */
  const isInsidePlot = (sx: number, sy: number): boolean =>
    sx >= PADL && sx <= W - PADR && sy >= PADT && sy <= H - PADB;

  // Wheel = zoom anchored at the cursor.
  React.useEffect(() => {
    const el = svgRef.current;
    if (!el || !onViewportChange) return;
    const onWheel = (e: WheelEvent) => {
      const pt = clientToSvg(e.clientX, e.clientY);
      if (!pt || !isInsidePlot(pt[0], pt[1])) return;
      e.preventDefault();
      const [dataX, dataY] = svgPointToData(pt[0], pt[1]);
      // 1 wheel step → 1.15× zoom. Scroll up = zoom in, down = zoom out.
      const k = Math.exp(-e.deltaY * 0.0015);
      const nxMin = dataX - (dataX - xMin) / k;
      const nxMax = dataX + (xMax - dataX) / k;
      const nyMin = dataY - (dataY - yMin) / k;
      const nyMax = dataY + (yMax - dataY) / k;
      onViewportChange({ xMin: nxMin, xMax: nxMax, yMin: nyMin, yMax: nyMax });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clientToSvg, svgPointToData, xMin, xMax, yMin, yMax, onViewportChange]);

  // Cmd/Ctrl+drag = box zoom; Shift+drag = pan. Both gated on the
  // modifier so they don't fight polygon-vertex clicks.
  const handlePlotMouseDown: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!onViewportChange) return;
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) return;
    const pt = clientToSvg(e.clientX, e.clientY);
    if (!pt || !isInsidePlot(pt[0], pt[1])) return;
    e.preventDefault();
    e.stopPropagation();
    const [sx0, sy0] = pt;
    const isPan = e.shiftKey && !(e.metaKey || e.ctrlKey);
    const startBounds = { xMin, xMax, yMin, yMax };
    if (!isPan) setBoxZoom({ sx0, sy0, sx1: sx0, sy1: sy0 });

    const onMove = (ev: MouseEvent) => {
      const p = clientToSvg(ev.clientX, ev.clientY);
      if (!p) return;
      if (isPan) {
        // Pan: translate bounds by the inverse of the cursor delta.
        const dxData = ((p[0] - sx0) / (W - PADL - PADR)) * (startBounds.xMax - startBounds.xMin);
        const dyData = ((p[1] - sy0) / (H - PADT - PADB)) * (startBounds.yMax - startBounds.yMin);
        onViewportChange({
          xMin: startBounds.xMin - dxData,
          xMax: startBounds.xMax - dxData,
          yMin: startBounds.yMin + dyData,  // SVG y is inverted vs. data y
          yMax: startBounds.yMax + dyData,
        });
      } else {
        setBoxZoom({ sx0, sy0, sx1: p[0], sy1: p[1] });
      }
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (isPan) return;
      const p = clientToSvg(ev.clientX, ev.clientY) ?? [sx0, sy0];
      const dx = Math.abs(p[0] - sx0);
      const dy = Math.abs(p[1] - sy0);
      setBoxZoom(null);
      // Treat tiny drags as clicks (no-op).
      if (dx < 4 || dy < 4) return;
      const [ax, ay] = svgPointToData(sx0, sy0);
      const [bx, by] = svgPointToData(p[0], p[1]);
      onViewportChange({
        xMin: Math.min(ax, bx),
        xMax: Math.max(ax, bx),
        yMin: Math.min(ay, by),
        yMax: Math.max(ay, by),
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Top-line + formula resolution
  const xLabelTop = INDEX_PRETTY[xKey];
  const xLabelDisplay = xScale === "log" ? `LOG₁₀ ${xLabelTop}` : xLabelTop;
  const xFormula = EXPOSURE_INDEX_HELP[xKey].formula;

  const yIsChannel = mode === "univariate";
  const yLabelTop = yIsChannel
    ? CHANNEL_PRETTY[yKey as ChannelCol]
    : INDEX_PRETTY[yKey as IndexRow];
  const yLabelDisplay = yScale === "log" ? `LOG₁₀ ${yLabelTop}` : yLabelTop;

  const xHelp: ExposureIndexHelp = EXPOSURE_INDEX_HELP[xKey];

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "44px 1fr",
        gridTemplateRows: "1fr 40px",
        columnGap: 0,
        rowGap: 0,
      }}
    >
      {/* (1, 1) — Y axis label, single rotated heading line. Formula
          lives in the hover card to keep this column readable. */}
      {yIsChannel ? (
        <HelpTip
          help={EXPOSURE_CHANNEL_HELP[yKey as ChannelCol]}
          Body={ChannelCardBody}
        >
          <div
            ref={yLabelRef}
            className={
              "flex items-center justify-center " +
              (onYKeyChange ? "cursor-pointer" : "cursor-help")
            }
            style={{ gridColumn: 1, gridRow: 1, paddingRight: 10 }}
            onClick={onYKeyChange ? (e) => {
              e.stopPropagation();
              setYPickerOpen(true);
            } : undefined}
          >
            <div
              className={
                "font-mono uppercase tracking-[0.18em] text-[10px] font-semibold text-[color:var(--color-ink-subtle)] " +
                (onYKeyChange ? "border-b border-dotted border-[color:var(--color-ink-subtle)]" : "")
              }
              style={{
                writingMode: "vertical-rl" as React.CSSProperties["writingMode"],
                transform: "rotate(180deg)",
                whiteSpace: "nowrap",
              }}
            >
              {yLabelDisplay}
            </div>
          </div>
        </HelpTip>
      ) : (
        <HelpTip
          help={EXPOSURE_INDEX_HELP[yKey as IndexRow]}
          Body={IndexCardBody}
        >
          <div
            ref={yLabelRef}
            className={
              "flex items-center justify-center " +
              (onYKeyChange ? "cursor-pointer" : "cursor-help")
            }
            style={{ gridColumn: 1, gridRow: 1, paddingRight: 10 }}
            onClick={onYKeyChange ? (e) => {
              e.stopPropagation();
              setYPickerOpen(true);
            } : undefined}
          >
            <div
              className={
                "font-mono uppercase tracking-[0.18em] text-[10px] font-semibold text-[color:var(--color-ink-subtle)] " +
                (onYKeyChange ? "border-b border-dotted border-[color:var(--color-ink-subtle)]" : "")
              }
              style={{
                writingMode: "vertical-rl" as React.CSSProperties["writingMode"],
                transform: "rotate(180deg)",
                whiteSpace: "nowrap",
              }}
            >
              {yLabelDisplay}
            </div>
          </div>
        </HelpTip>
      )}

      {/* (1, 2) — the SVG itself */}
      <div style={{ gridColumn: 2, gridRow: 1, minWidth: 0, position: "relative" }}>
        {viewport && onViewportChange && (
          <button
            type="button"
            onClick={() => onViewportChange(null)}
            title="Reset to auto-fit (also dbl-click)"
            className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-sm border border-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)] font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)] hover:text-white"
          >
            Reset zoom
          </button>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="block w-full h-auto rounded-[6px] bg-[color:var(--color-surface-elevated)]"
          role="img"
          aria-label="exposure scatter"
          onMouseDown={handlePlotMouseDown}
          onDoubleClick={(e) => {
            if (!onViewportChange || !viewport) return;
            // If the polygon wizard is open, let it own double-click
            // (it uses dbl-click to close the polygon).
            if (polygonDrawing) return;
            const pt = clientToSvg(e.clientX, e.clientY);
            if (!pt || !isInsidePlot(pt[0], pt[1])) return;
            onViewportChange(null);
          }}
          style={{
            cursor: boxZoom ? "crosshair" : undefined,
          }}
        >
          {/* Plot frame */}
          <rect
            x={PADL}
            y={PADT}
            width={W - PADL - PADR}
            height={H - PADT - PADB}
            fill="var(--color-surface)"
            stroke="var(--color-border)"
            strokeWidth={0.8}
          />

          {/* Gridlines */}
          {xTicks.map((t) => (
            <line
              key={`xg-${t}`}
              x1={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
              y1={PADT}
              x2={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
              y2={H - PADB}
              stroke="var(--color-border)"
              strokeOpacity={0.55}
              strokeDasharray="2 4"
              strokeWidth={0.5}
            />
          ))}
          {yTicks.map((t) => (
            <line
              key={`yg-${t}`}
              x1={PADL}
              y1={H - PADB - ((t - yMin) / (yMax - yMin || 1)) * (H - PADT - PADB)}
              x2={W - PADR}
              y2={H - PADB - ((t - yMin) / (yMax - yMin || 1)) * (H - PADT - PADB)}
              stroke="var(--color-border)"
              strokeOpacity={0.55}
              strokeDasharray="2 4"
              strokeWidth={0.5}
            />
          ))}

          {/* Tick labels */}
          {xTicks.map((t) => (
            <text
              key={`xl-${t}`}
              x={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
              y={H - PADB + 16}
              textAnchor="middle"
              className="fill-[color:var(--color-ink-muted)]"
              style={{ font: "10px var(--font-mono)" }}
            >
              {xScale === "log" ? fmtIndexTick(Math.pow(10, t)) : fmtIndexTick(t)}
            </text>
          ))}
          {yTicks.map((t) => (
            <text
              key={`yl-${t}`}
              x={PADL - 8}
              y={H - PADB - ((t - yMin) / (yMax - yMin || 1)) * (H - PADT - PADB) + 3}
              textAnchor="end"
              className="fill-[color:var(--color-ink-muted)]"
              style={{ font: "10px var(--font-mono)" }}
            >
              {yScale === "log" ? fmtIndexTick(Math.pow(10, t)) : fmtIndexTick(t)}
            </text>
          ))}

          {/* Regression line — univariate only */}
          {mode === "univariate" && fit && Number.isFinite(fit.slope) && positiveXs.length > 0 && (
            <line
              data-role="regression-line"
              x1={px(minPosX)}
              y1={py(fit.intercept + fit.slope * Math.log10(minPosX))}
              x2={px(maxX)}
              y2={py(fit.intercept + fit.slope * Math.log10(maxX))}
              stroke="var(--color-primary)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.9}
            />
          )}

          {/* Focus crosshair */}
          {focusedId != null && (() => {
            const focused = rows.find((r) => r.id === focusedId);
            if (!focused) return null;
            const fx = rowIndex(focused, xKey);
            const fy =
              mode === "univariate"
                ? rowChannel(focused, yKey as ChannelCol)
                : rowIndex(focused, yKey as IndexRow);
            if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
            // Don't render crosshair for out-of-clamp focused entries.
            if (trimOutliers) {
              const xCheck = xScale === "log" ? Math.log10(Math.max(1e-9, fx)) : fx;
              const yCheck = yScale === "log" ? Math.log10(Math.max(1e-9, fy)) : fy;
              if (xCheck < xMin || xCheck > xMax || yCheck < yMin || yCheck > yMax) return null;
            }
            return (
              <g aria-hidden="true">
                <line
                  x1={PADL}
                  x2={W - PADR}
                  y1={py(fy)}
                  y2={py(fy)}
                  stroke="var(--color-primary)"
                  strokeWidth={0.6}
                  strokeDasharray="3 3"
                  opacity={0.6}
                />
                <line
                  x1={px(fx)}
                  x2={px(fx)}
                  y1={PADT}
                  y2={H - PADB}
                  stroke="var(--color-primary)"
                  strokeWidth={0.6}
                  strokeDasharray="3 3"
                  opacity={0.6}
                />
              </g>
            );
          })()}

          {/* Family trace — rendered behind the dots */}
          {family && family.length >= 2 && (
            <ExposureFamilyTrace
              points={family
                .map((m) => {
                  const x = rowIndex(m.row, xKey);
                  const y =
                    mode === "univariate"
                      ? rowChannel(m.row, yKey as ChannelCol)
                      : rowIndex(m.row, yKey as IndexRow);
                  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                  // Skip family members that are outside clamped bounds.
                  if (trimOutliers) {
                    const xCheck = xScale === "log" ? Math.log10(Math.max(1e-9, x)) : x;
                    const yCheck = yScale === "log" ? Math.log10(Math.max(1e-9, y)) : y;
                    if (xCheck < xMin || xCheck > xMax || yCheck < yMin || yCheck > yMax) return null;
                  }
                  return [px(x), py(y)] as const;
                })
                .filter((p): p is readonly [number, number] => p !== null)}
            />
          )}

          {/* Dots — focused last so it sits on top of the cloud.
              While the propose-test polygon is being drawn, dots become
              non-interactive so the click-capture rect takes precedence. */}
          <g pointerEvents={polygonDrawing ? "none" : undefined}>
          {rows
            .map((row, i) => ({ row, isFocused: row.id === focusedId, i }))
            .sort((a, b) => Number(a.isFocused) - Number(b.isFocused))
            .map(({ row }) => {
              const x = rowIndex(row, xKey);
              const y =
                mode === "univariate"
                  ? rowChannel(row, yKey as ChannelCol)
                  : rowIndex(row, yKey as IndexRow);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
              // Skip out-of-clamp dots when trimOutliers is on.
              if (trimOutliers) {
                const xCheck = xScale === "log" ? Math.log10(Math.max(1e-9, x)) : x;
                const yCheck = yScale === "log" ? Math.log10(Math.max(1e-9, y)) : y;
                if (xCheck < xMin || xCheck > xMax || yCheck < yMin || yCheck > yMax) return null;
              }
              const isFocused = row.id === focusedId;
              const visible = isInDimRange(row);
              return (
                <g key={row.id} opacity={visible ? 1 : 0.13}>
                  {isFocused && (
                    <circle
                      data-role="focus-halo"
                      cx={px(x)}
                      cy={py(y)}
                      r={11}
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      onClick={(e) => { e.stopPropagation(); onClick(row.id); }}
                      style={{ cursor: "pointer" }}
                    />
                  )}
                  <circle
                    data-role="scatter-dot"
                    cx={px(x)}
                    cy={py(y)}
                    r={isFocused ? 6 : 4.5}
                    fill={row.hex}
                    stroke={isFocused ? "var(--color-ink)" : "var(--color-ink-subtle)"}
                    strokeWidth={isFocused ? 1 : 0.6}
                    onMouseEnter={() => onHover(row.id)}
                    onMouseLeave={() => onLeave()}
                    onClick={(e) => { e.stopPropagation(); onClick(row.id); }}
                    style={{ cursor: "pointer" }}
                  />
                </g>
              );
            })}
          </g>

          {/* PROPOSE TEST overlays — sit above dots, below axis labels. */}
          {polygon && polygon.length >= 2 && (
            <ExposurePolygon
              polygon={polygon}
              toSvg={toSvg}
              fromSvg={fromSvg}
              drawing={!!polygonDrawing}
              onVertexMove={onPolygonVertexMove}
            />
          )}
          {(curve || (cells && cells.length > 0)) && (
            <ExposureCellsPreview
              curve={curve}
              cells={cells ?? []}
              toSvg={toSvg}
            />
          )}
          {polygonDrawing && onPolygonVertexAdd && onPolygonClose && onPolygonCancel && (
            <ExposurePolygonDraw
              width={W}
              height={H}
              fromSvg={fromSvg}
              vertices={polygon ?? []}
              onVertexAdd={onPolygonVertexAdd}
              onClose={onPolygonClose}
              onCancel={onPolygonCancel}
            />
          )}

          {/* Plot border — drawn last so it sits over gridlines */}
          <line
            x1={PADL}
            x2={PADL}
            y1={PADT}
            y2={H - PADB}
            stroke="var(--color-border-strong)"
          />
          <line
            x1={PADL}
            x2={W - PADR}
            y1={H - PADB}
            y2={H - PADB}
            stroke="var(--color-border-strong)"
          />

          {/* Box-zoom marquee — visible only while the user is dragging
              cmd/ctrl with the mouse. Clamped to the plot rectangle. */}
          {boxZoom && (
            <rect
              x={Math.max(PADL, Math.min(boxZoom.sx0, boxZoom.sx1))}
              y={Math.max(PADT, Math.min(boxZoom.sy0, boxZoom.sy1))}
              width={Math.min(
                Math.abs(boxZoom.sx1 - boxZoom.sx0),
                (W - PADR) - Math.max(PADL, Math.min(boxZoom.sx0, boxZoom.sx1)),
              )}
              height={Math.min(
                Math.abs(boxZoom.sy1 - boxZoom.sy0),
                (H - PADB) - Math.max(PADT, Math.min(boxZoom.sy0, boxZoom.sy1)),
              )}
              fill="var(--color-primary)"
              fillOpacity={0.08}
              stroke="var(--color-primary)"
              strokeWidth={0.8}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>

      {/* (2, 1) — corner spacer (empty) */}
      <div style={{ gridColumn: 1, gridRow: 2 }} />

      {/* (2, 2) — X axis label, two lines, centered horizontally */}
      <HelpTip help={xHelp} Body={IndexCardBody}>
        <div
          ref={xLabelRef}
          className={
            "flex flex-col items-center justify-center " +
            (onXKeyChange ? "cursor-pointer" : "cursor-help")
          }
          style={{ gridColumn: 2, gridRow: 2, paddingTop: 4 }}
          onClick={onXKeyChange ? (e) => {
            e.stopPropagation();
            setXPickerOpen(true);
          } : undefined}
        >
          <div className={
            "font-mono uppercase tracking-[0.18em] text-[10px] font-semibold text-[color:var(--color-ink-subtle)] leading-tight " +
            (onXKeyChange ? "border-b border-dotted border-[color:var(--color-ink-subtle)]" : "")
          }>
            {xLabelDisplay}
          </div>
          <div className="font-mono text-[9px] text-[color:var(--color-ink-subtle)] opacity-70 leading-tight">
            {xFormula}
          </div>
        </div>
      </HelpTip>

      {xPickerOpen && xLabelRef.current && onXKeyChange && typeof document !== "undefined" && createPortal(
        <div
          data-axis-picker
          className="fixed z-[1000] rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-lg"
          style={(() => {
            const a = xLabelRef.current!.getBoundingClientRect();
            const margin = 8;
            const w = 220, h = 280;
            // X label is below the chart; prefer ABOVE so popover doesn't cover empty space.
            let top = a.top - h - 6;
            if (top < margin) top = a.bottom + 6;
            let left = a.left + a.width / 2 - w / 2;
            if (left < margin) left = margin;
            if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
            return { left, top };
          })()}
        >
          <ExposureAxisPicker
            axis="x"
            mode={mode}
            currentKey={xKey}
            scale={xScale}
            onKeyChange={(k) => onXKeyChange(k as IndexRow)}
            onScaleChange={(s) => onXScaleChange?.(s)}
            onClose={() => setXPickerOpen(false)}
          />
        </div>,
        document.body,
      )}
      {yPickerOpen && yLabelRef.current && onYKeyChange && typeof document !== "undefined" && createPortal(
        <div
          data-axis-picker
          className="fixed z-[1000] rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-lg"
          style={(() => {
            const a = yLabelRef.current!.getBoundingClientRect();
            const margin = 8;
            const w = 220, h = 280;
            // Y label is on the chart's left; prefer to the RIGHT of the label.
            let left = a.right + 6;
            if (left + w > window.innerWidth - margin) left = a.left - w - 6;
            if (left < margin) left = margin;
            let top = a.top + a.height / 2 - h / 2;
            if (top < margin) top = margin;
            if (top + h > window.innerHeight - margin) top = window.innerHeight - h - margin;
            return { left, top };
          })()}
        >
          <ExposureAxisPicker
            axis="y"
            mode={mode}
            currentKey={yKey}
            scale={yScale}
            onKeyChange={(k) => onYKeyChange(k)}
            onScaleChange={(s) => onYScaleChange?.(s)}
            onClose={() => setYPickerOpen(false)}
          />
        </div>,
        document.body,
      )}
    </div>
  );
};
