import * as React from "react";
import { hueDeg, chroma as chromaFn } from "../../color/math";
import { niceBounds, niceTicks } from "../stabilityChartMath";
import type { ChannelCol, ExposureRow, IndexRow } from "./exposureCorrelations";
import { logLinearRegression } from "./exposureMath";

export type ScaleKind = "linear" | "log";
export type ScatterMode = "univariate" | "bivariate";

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

const W = 720;
const H = 420;
const PADL = 60;
const PADR = 28;
const PADT = 24;
const PADB = 56;

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

  const { min: xMin, max: xMax } = niceBounds(xsForScale, null);
  const { min: yMin, max: yMax } = niceBounds(ysForScale, null);

  const px = (v: number) => {
    const t = ((xScale === "log" ? Math.log10(v) : v) - xMin) / (xMax - xMin || 1);
    return PADL + t * (W - PADL - PADR);
  };
  const py = (v: number) => {
    const t = ((yScale === "log" ? Math.log10(v) : v) - yMin) / (yMax - yMin || 1);
    return H - PADB - t * (H - PADT - PADB);
  };

  const fit =
    mode === "univariate"
      ? logLinearRegression(xs, ys)
      : null;

  const xTicks = niceTicks(xMin, xMax, 5);
  const yTicks = niceTicks(yMin, yMax, 5);

  const isInDimRange = (row: ExposureRow): boolean => {
    if (!dimRange) return true;
    const v = row.indices.surface_exposure_index as number;
    return v >= dimRange[0] && v <= dimRange[1];
  };

  const positiveXs = xs.filter((v) => Number.isFinite(v) && v > 0);
  const minPosX = positiveXs.length > 0 ? Math.min(...positiveXs) : 1;
  const maxX = xs.length > 0 ? Math.max(...xs.filter(Number.isFinite)) : 1;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="exposure scatter"
    >
      <rect
        x={PADL}
        y={PADT}
        width={W - PADL - PADR}
        height={H - PADT - PADB}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={0.6}
      />

      {xTicks.map((t) => (
        <line
          key={`xg-${t}`}
          x1={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
          y1={PADT}
          x2={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
          y2={H - PADB}
          stroke="var(--color-border)"
          strokeOpacity={0.4}
          strokeDasharray="2 4"
          strokeWidth={0.4}
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
          strokeOpacity={0.4}
          strokeDasharray="2 4"
          strokeWidth={0.4}
        />
      ))}

      {xTicks.map((t) => (
        <text
          key={`xl-${t}`}
          x={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
          y={H - PADB + 14}
          fontSize="10"
          fontFamily="ui-monospace"
          fill="var(--color-ink-subtle)"
          textAnchor="middle"
        >
          {xScale === "log" ? `10^${t}` : t}
        </text>
      ))}
      {yTicks.map((t) => (
        <text
          key={`yl-${t}`}
          x={PADL - 6}
          y={H - PADB - ((t - yMin) / (yMax - yMin || 1)) * (H - PADT - PADB) + 3}
          fontSize="10"
          fontFamily="ui-monospace"
          fill="var(--color-ink-subtle)"
          textAnchor="end"
        >
          {yScale === "log" ? `10^${t}` : t}
        </text>
      ))}

      {mode === "univariate" && fit && Number.isFinite(fit.slope) && positiveXs.length > 0 && (
        <line
          data-role="regression-line"
          x1={px(minPosX)}
          y1={py(fit.intercept + fit.slope * Math.log10(minPosX))}
          x2={px(maxX)}
          y2={py(fit.intercept + fit.slope * Math.log10(Math.max(1e-3, maxX)))}
          stroke="var(--color-primary)"
          strokeWidth={1.4}
          strokeDasharray="6 4"
          opacity={0.85}
        />
      )}

      {focusedId != null && (() => {
        const focused = rows.find((r) => r.id === focusedId);
        if (!focused) return null;
        const fx = rowIndex(focused, xKey);
        const fy =
          mode === "univariate"
            ? rowChannel(focused, yKey as ChannelCol)
            : rowIndex(focused, yKey as IndexRow);
        if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
        return (
          <g>
            <line
              x1={PADL}
              x2={W - PADR}
              y1={py(fy)}
              y2={py(fy)}
              stroke="var(--color-primary)"
              strokeWidth={0.4}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <line
              x1={px(fx)}
              x2={px(fx)}
              y1={PADT}
              y2={H - PADB}
              stroke="var(--color-primary)"
              strokeWidth={0.4}
              strokeDasharray="3 3"
              opacity={0.5}
            />
          </g>
        );
      })()}

      {rows.map((row) => {
        const x = rowIndex(row, xKey);
        const y =
          mode === "univariate"
            ? rowChannel(row, yKey as ChannelCol)
            : rowIndex(row, yKey as IndexRow);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const isFocused = row.id === focusedId;
        const visible = isInDimRange(row);
        return (
          <g key={row.id} opacity={visible ? 1 : 0.15}>
            {isFocused && (
              <circle
                data-role="focus-halo"
                cx={px(x)}
                cy={py(y)}
                r={10}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth={2}
              />
            )}
            <circle
              data-role="scatter-dot"
              cx={px(x)}
              cy={py(y)}
              r={isFocused ? 6 : 5}
              fill={row.hex}
              stroke="var(--color-surface)"
              strokeWidth={0.6}
              onMouseEnter={() => onHover(row.id)}
              onMouseLeave={() => onLeave()}
              onClick={() => onClick(row.id)}
              style={{ cursor: "pointer" }}
            />
          </g>
        );
      })}

      <text
        x={PADL}
        y={H - 8}
        fontSize="11"
        fontFamily="ui-monospace"
        fill="var(--color-ink-subtle)"
      >
        {xScale === "log" ? "log10(" : ""}{xKey}{xScale === "log" ? ")" : ""}
      </text>
      <text
        x={16}
        y={PADT + 8}
        fontSize="11"
        fontFamily="ui-monospace"
        fill="var(--color-ink-subtle)"
        transform={`rotate(-90, 16, ${PADT + 8})`}
      >
        {yScale === "log" ? "log10(" : ""}{yKey}{yScale === "log" ? ")" : ""}
      </text>
    </svg>
  );
};
