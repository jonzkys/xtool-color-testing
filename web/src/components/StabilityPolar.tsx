import { useMemo, useState } from "react";
import { type Lab, labToHex } from "../color/math";
import type { ValidationCell } from "../types";
import { robustMeanLab } from "./stabilityStatsMath";
import type { SeriesInput } from "./stabilityChartMath";
import type { FocusedCell, FocusSource } from "./StabilityChart";

interface Props {
  cells: ValidationCell[];
  series: SeriesInput[];
  focusedCell: FocusedCell;
  onHover: (cellIndex: number, source: FocusSource) => void;
  onHoverLeave: (source: FocusSource) => void;
  onClick: (cellIndex: number, source: FocusSource) => void;
  onBackgroundClear: (source: FocusSource) => void;
  simulationActive: boolean;
}

const POLAR_SOURCE: FocusSource = "scatter";

/* ─── Polar residual viz ──────────────────────────────────────────────────
 *
 * Each cell renders at the (expected hue, expected chroma) of its
 * palette target on a polar map of CIE Lab a-by-b; an arrow stretches
 * from there to the cell's measured (hue, chroma) so the eye picks up
 * direction and magnitude of palette drift in one read. Single-run
 * selections show a simple dot pair per cell; multi-run selections
 * collapse to the cluster-robust burn-mean per cell so noisy runs
 * don't smear the map.
 *
 * The faint wheel underneath is a low-chroma colour reference — built
 * once with 36 × 5 wedges via labToHex(60, C·cosθ, C·sinθ), so the
 * region under each cell is tinted with the colour the palette is
 * trying to land in. Out-of-gamut wedges clip toward the boundary
 * rather than going solid black, which keeps the visual cue legible
 * for the deep blues / reds that aren't really in sRGB.
 */

export function StabilityPolar({
  cells,
  series,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onBackgroundClear,
  simulationActive,
}: Props) {
  const W = 640;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2;
  const radius = 260;

  // Compute (expected, measured, ΔE, hex) per cell. Filter out cells
  // with no measurements at all.
  const points = useMemo(() => {
    type CellPoint = {
      cellIndex: number;
      expectedC: number;
      expectedH: number; // radians
      measuredC: number;
      measuredH: number;
      deltaE: number;
      expectedHex: string;
      measuredHex: string;
    };
    const out: CellPoint[] = [];
    for (const c of cells) {
      const exp = c.expected_lab as number[];
      if (!Array.isArray(exp) || exp.length !== 3) continue;
      const expected: Lab = [exp[0], exp[1], exp[2]];
      const labs: Lab[] = [];
      for (const s of series) {
        const m = s.cells.get(c.cell_index);
        if (m) labs.push(m.lab);
      }
      if (labs.length === 0) continue;
      const r = robustMeanLab(labs);
      if (r == null) continue;
      const measured = r.lab;
      const expectedC = Math.hypot(expected[1], expected[2]);
      const expectedH = Math.atan2(expected[2], expected[1]);
      const measuredC = Math.hypot(measured[1], measured[2]);
      const measuredH = Math.atan2(measured[2], measured[1]);
      const dL = expected[0] - measured[0];
      const dA = expected[1] - measured[1];
      const dB = expected[2] - measured[2];
      const deltaE = Math.sqrt(dL * dL + dA * dA + dB * dB);
      out.push({
        cellIndex: c.cell_index,
        expectedC,
        expectedH,
        measuredC,
        measuredH,
        deltaE,
        expectedHex: c.expected_hex,
        measuredHex: labToHex(measured),
      });
    }
    return out;
  }, [cells, series]);

  // Auto-scale so the largest expected/measured chroma + a 10-unit
  // buffer fills the wheel. Degenerate empty case → fallback 60.
  const maxC = useMemo(() => {
    let m = 0;
    for (const p of points) {
      if (p.expectedC > m) m = p.expectedC;
      if (p.measuredC > m) m = p.measuredC;
    }
    return Math.max(20, Math.ceil((m + 10) / 10) * 10);
  }, [points]);

  const polar = (cVal: number, hRad: number) => {
    const r = (cVal / maxC) * radius;
    return {
      x: cx + r * Math.cos(hRad),
      y: cy - r * Math.sin(hRad),
    };
  };

  const wheelTiles = useMemo(() => buildWheelTiles(cx, cy, radius), [cx, cy, radius]);
  const ringValues = useMemo(() => {
    // 4 evenly-spaced chroma rings (25 / 50 / 75 / 100 % of maxC)
    return [0.25, 0.5, 0.75, 1].map((f) => Math.round(maxC * f));
  }, [maxC]);
  const hueLabels: { angle: number; label: string }[] = [
    { angle: 0, label: "+a" },
    { angle: 90, label: "+b" },
    { angle: 180, label: "-a" },
    { angle: 270, label: "-b" },
  ];

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const focusIdx =
    focusedCell?.kind === "pinned"
      ? focusedCell.cellIndex
      : focusedCell?.kind === "transient"
        ? focusedCell.cellIndex
        : null;

  return (
    <div className="relative h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]"
        onClick={(e) => {
          if ((e.target as SVGElement).tagName === "svg") {
            onBackgroundClear(POLAR_SOURCE);
          }
        }}
        onMouseLeave={() => {
          setHoverIdx(null);
          onHoverLeave(POLAR_SOURCE);
        }}
      >
        {/* Faint colour-wheel reference */}
        <g aria-hidden opacity={0.55}>
          {wheelTiles.map((t) => (
            <path key={t.key} d={t.d} fill={t.fill} />
          ))}
        </g>
        {/* Chroma rings */}
        {ringValues.map((cVal) => {
          const r = (cVal / maxC) * radius;
          return (
            <g key={`ring-${cVal}`}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="var(--color-border-strong)"
                strokeWidth={0.5}
                strokeDasharray="3 4"
                opacity={0.55}
              />
              <text
                x={cx + r + 4}
                y={cy - 4}
                fill="var(--color-ink-subtle)"
                style={{
                  font: "9.5px var(--font-mono)",
                }}
              >
                C* {cVal}
              </text>
            </g>
          );
        })}
        {/* Hue spokes + axis labels */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x2 = cx + radius * Math.cos(rad);
          const y2 = cy - radius * Math.sin(rad);
          return (
            <line
              key={`spoke-${deg}`}
              x1={cx}
              y1={cy}
              x2={x2}
              y2={y2}
              stroke="var(--color-border)"
              strokeWidth={0.5}
              opacity={0.4}
            />
          );
        })}
        {hueLabels.map((h) => {
          const rad = (h.angle * Math.PI) / 180;
          const x = cx + (radius + 18) * Math.cos(rad);
          const y = cy - (radius + 18) * Math.sin(rad);
          return (
            <text
              key={h.label}
              x={x}
              y={y + 3}
              textAnchor="middle"
              fill="var(--color-ink-subtle)"
              style={{
                font: "600 9.5px var(--font-mono)",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              {h.label}
            </text>
          );
        })}

        {/* Per-cell arrows (expected → measured). Coloured by ΔE — a
            ΔE bucket scale that mirrors the rest of the page's
            "imperceptible / noticeable / clearly off" thresholds. */}
        <g>
          {points.map((p) => {
            const e = polar(p.expectedC, p.expectedH);
            const m = polar(p.measuredC, p.measuredH);
            const isFocused = focusIdx === p.cellIndex;
            const colour = arrowColour(p.deltaE);
            const opacity = focusIdx == null || isFocused ? 1 : 0.25;
            const dx = m.x - e.x;
            const dy = m.y - e.y;
            const len = Math.hypot(dx, dy);
            return (
              <g
                key={p.cellIndex}
                opacity={opacity}
                onMouseEnter={() => {
                  setHoverIdx(p.cellIndex);
                  onHover(p.cellIndex, POLAR_SOURCE);
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onClick(p.cellIndex, POLAR_SOURCE);
                }}
                style={{ cursor: "pointer" }}
              >
                {/* Hit area: a wider transparent line for forgiving
                    pointer targeting on small arrows. */}
                <line
                  x1={e.x}
                  y1={e.y}
                  x2={m.x}
                  y2={m.y}
                  stroke="transparent"
                  strokeWidth={12}
                />
                {/* Drift line + arrowhead — only render if the cells
                    actually moved (length ≥ 1.5 px); otherwise the
                    expected dot below is the only mark we need. */}
                {len >= 1.5 && (
                  <>
                    <line
                      x1={e.x}
                      y1={e.y}
                      x2={m.x}
                      y2={m.y}
                      stroke={colour}
                      strokeWidth={isFocused ? 2.4 : 1.4}
                      opacity={0.85}
                    />
                    <ArrowHead
                      from={e}
                      to={m}
                      colour={colour}
                      length={isFocused ? 8 : 6}
                    />
                  </>
                )}
                {/* Expected swatch (filled with the palette hex) */}
                <circle
                  cx={e.x}
                  cy={e.y}
                  r={isFocused ? 5 : 3.4}
                  fill={p.expectedHex}
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth={isFocused ? 1.4 : 0.6}
                />
                {/* Measured marker — hollow ring filled with the
                    measured hex so the eye reads "this is where it
                    landed". */}
                {len >= 1.5 && (
                  <circle
                    cx={m.x}
                    cy={m.y}
                    r={isFocused ? 4 : 2.6}
                    fill={p.measuredHex}
                    stroke={colour}
                    strokeWidth={isFocused ? 1.4 : 0.9}
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* Legend strip — top-right; lists the ΔE bucket colours so
            the user can read "is this drift acceptable or not?". */}
        <g transform={`translate(${W - 130} 12)`}>
          <text
            x={0}
            y={0}
            fill="var(--color-ink-subtle)"
            style={{
              font: "600 8.5px var(--font-mono)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            ΔE buckets
          </text>
          {[
            { label: "≤ 2 imperceptible", colour: arrowColour(1) },
            { label: "≤ 5 noticeable", colour: arrowColour(4) },
            { label: "≤ 10 clearly off", colour: arrowColour(8) },
            { label: "> 10 wrong", colour: arrowColour(15) },
          ].map((row, i) => (
            <g key={i} transform={`translate(0 ${10 + i * 11})`}>
              <line
                x1={0}
                y1={0}
                x2={12}
                y2={0}
                stroke={row.colour}
                strokeWidth={2}
              />
              <text
                x={16}
                y={3}
                fill="var(--color-ink-muted)"
                style={{ font: "9px var(--font-mono)" }}
              >
                {row.label}
              </text>
            </g>
          ))}
        </g>

        {simulationActive && (
          <text
            x={W - 12}
            y={H - 10}
            textAnchor="end"
            fill="var(--color-primary)"
            style={{
              font: "600 9.5px var(--font-mono)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Simulated
          </text>
        )}
      </svg>

      {/* Hover hint — small tooltip at the bottom-left, simpler than
          the scatter's full hover card since the polar view's whole
          point is the visual drift; the focus panel on the right
          carries the numbers. */}
      {hoverIdx != null && (() => {
        const p = points.find((q) => q.cellIndex === hoverIdx);
        if (!p) return null;
        return (
          <div className="absolute left-3 bottom-3 z-10 px-2.5 py-1.5 rounded-[4px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-md font-mono text-[10px] tabular-nums text-[color:var(--color-ink)] flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-[2px] border border-[color:var(--color-border-strong)]"
              style={{ background: p.expectedHex }}
            />
            <span className="text-[color:var(--color-ink-subtle)]">
              cell #{p.cellIndex}
            </span>
            <span>ΔE {p.deltaE.toFixed(1)}</span>
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-[2px] border border-[color:var(--color-border-strong)]"
              style={{ background: p.measuredHex }}
            />
          </div>
        );
      })()}
    </div>
  );
}

/* ─── Arrowhead ────────────────────────────────────────────────────────── */

function ArrowHead({
  from,
  to,
  colour,
  length,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  colour: string;
  length: number;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  const tipLen = length;
  const tipAngle = Math.PI / 6;
  const x1 = to.x - tipLen * Math.cos(angle - tipAngle);
  const y1 = to.y - tipLen * Math.sin(angle - tipAngle);
  const x2 = to.x - tipLen * Math.cos(angle + tipAngle);
  const y2 = to.y - tipLen * Math.sin(angle + tipAngle);
  return (
    <polygon
      points={`${to.x},${to.y} ${x1},${y1} ${x2},${y2}`}
      fill={colour}
      opacity={0.85}
    />
  );
}

/* ─── Wheel tile generator ────────────────────────────────────────────── */

interface WheelTile {
  key: string;
  d: string;
  fill: string;
}

function buildWheelTiles(
  cx: number,
  cy: number,
  radius: number,
): WheelTile[] {
  const HUE_DIVS = 36;
  const RING_DIVS = 5;
  const out: WheelTile[] = [];
  for (let h = 0; h < HUE_DIVS; h++) {
    const a0 = (h * 360) / HUE_DIVS;
    const a1 = ((h + 1) * 360) / HUE_DIVS;
    const r0Frac = 0;
    for (let ri = 0; ri < RING_DIVS; ri++) {
      const r1Frac = (ri + 1) / RING_DIVS;
      const r0 = (ri === 0 ? r0Frac : ri / RING_DIVS) * radius;
      const r1 = r1Frac * radius;
      // Centre of the wedge → colour. L=60 chosen so the tinted
      // wheel sits clearly behind cell dots (which span L 0..100)
      // without competing for the eye.
      const cMid = (((ri + 0.5) / RING_DIVS) * radius) /
        radius * 70; // approximate chroma scale at ring centre
      const hMid = ((a0 + a1) / 2) * (Math.PI / 180);
      const aLab = cMid * Math.cos(hMid);
      const bLab = cMid * Math.sin(hMid);
      const fill = labToHex([60, aLab, bLab]);
      out.push({
        key: `tile-${h}-${ri}`,
        d: annulusWedgePath(cx, cy, r0, r1, a0, a1),
        fill,
      });
    }
  }
  return out;
}

function annulusWedgePath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0Deg: number,
  a1Deg: number,
): string {
  const a0 = (a0Deg * Math.PI) / 180;
  const a1 = (a1Deg * Math.PI) / 180;
  const p = (r: number, a: number) => ({
    x: cx + r * Math.cos(a),
    y: cy - r * Math.sin(a),
  });
  const p0o = p(r1, a0);
  const p1o = p(r1, a1);
  const p1i = p(r0, a1);
  const p0i = p(r0, a0);
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  // SVG arc sweep flag: 0 = counter-clockwise from start to end (we
  // increase angle, but Y is flipped, so visually the arc bows in
  // the right direction with sweep=0). For the inner arc we sweep
  // back the other way (sweep=1).
  const dOuter = `M ${p0o.x} ${p0o.y} A ${r1} ${r1} 0 ${largeArc} 0 ${p1o.x} ${p1o.y}`;
  const lTo1i = `L ${p1i.x} ${p1i.y}`;
  const dInner =
    r0 > 0
      ? `A ${r0} ${r0} 0 ${largeArc} 1 ${p0i.x} ${p0i.y}`
      : "";
  return `${dOuter} ${lTo1i} ${dInner} Z`;
}

/* ─── ΔE bucket colour ────────────────────────────────────────────────── */

function arrowColour(de: number): string {
  // Diverging ΔE scale: green (acceptable) → amber → red. Buckets
  // mirror the rest of the page's "≤ 2 / ≤ 5 / ≤ 10" wording.
  if (de <= 2) return "var(--color-success)";
  if (de <= 5) return "#9aaf2c";
  if (de <= 10) return "var(--color-warning)";
  return "var(--color-destructive)";
}

// Re-export for tests that want to verify the bucket ranges.
export const __testing__ = { arrowColour };
