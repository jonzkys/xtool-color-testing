import * as React from "react";
import { hueDeg, chroma as chromaFn } from "../../color/math";
import { niceBounds, niceTicks } from "../stabilityChartMath";
import type { ChannelCol, ExposureRow, IndexRow } from "./exposureCorrelations";
import { logLinearRegression, fmtIndexTick } from "./exposureMath";

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

const W = 760;
const H = 440;
const PADL = 64;
const PADR = 28;
const PADT = 28;
const PADB = 60;

const INDEX_PRETTY: Record<IndexRow, string> = {
  pulse_spacing_mm: "PULSE SPACING (mm)",
  line_spacing_index: "LINE SPACING IDX",
  pulse_energy_index: "PULSE ENERGY IDX",
  pulse_intensity_index: "PULSE INTENSITY IDX",
  surface_exposure_index: "SURFACE EXPOSURE IDX",
};

const CHANNEL_PRETTY: Record<ChannelCol, string> = {
  L: "L*  (LIGHTNESS)",
  a: "a*  (RED ↔ GREEN)",
  b: "b*  (YELLOW ↔ BLUE)",
  hue: "h°  (HUE)",
  chroma: "C*  (CHROMA)",
};

function xLabel(key: IndexRow, scale: ScaleKind): string {
  const base = INDEX_PRETTY[key];
  return scale === "log" ? `LOG₁₀ ${base}` : base;
}

function yLabel(
  mode: ScatterMode,
  key: ChannelCol | IndexRow,
  scale: ScaleKind,
): string {
  const base =
    mode === "univariate"
      ? CHANNEL_PRETTY[key as ChannelCol]
      : INDEX_PRETTY[key as IndexRow];
  return scale === "log" ? `LOG₁₀ ${base}` : base;
}

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
    // dimRange is always compared against surface_exposure_index —
    // the brush is anchored to that axis regardless of xKey (per spec).
    const v = row.indices.surface_exposure_index as number;
    return v >= dimRange[0] && v <= dimRange[1];
  };

  const positiveXs = xs.filter((v) => Number.isFinite(v) && v > 0);
  const minPosX = positiveXs.length > 0 ? Math.min(...positiveXs) : 1;
  const finiteXs = xs.filter(Number.isFinite);
  const maxX = finiteXs.length > 0 ? Math.max(...finiteXs) : 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-auto block rounded-[6px] bg-[color:var(--color-surface-elevated)]"
      role="img"
      aria-label="exposure scatter"
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

      {/* Dots — focused last so it sits on top of the cloud */}
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

      {/* Axis titles — instrument register, mid-axis, mono uppercase */}
      <text
        x={PADL + (W - PADL - PADR) / 2}
        y={H - 12}
        textAnchor="middle"
        className="fill-[color:var(--color-ink-subtle)]"
        style={{
          font: "600 10px var(--font-mono)",
          letterSpacing: "0.18em",
        }}
      >
        {xLabel(xKey, xScale)}
      </text>
      <text
        x={20}
        y={PADT + (H - PADT - PADB) / 2}
        textAnchor="middle"
        className="fill-[color:var(--color-ink-subtle)]"
        transform={`rotate(-90, 20, ${PADT + (H - PADT - PADB) / 2})`}
        style={{
          font: "600 10px var(--font-mono)",
          letterSpacing: "0.18em",
        }}
      >
        {yLabel(mode, yKey, yScale)}
      </text>
    </svg>
  );
};
