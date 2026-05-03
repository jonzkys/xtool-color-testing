import type { SchematicId } from "./stabilityHelpCopy";

/* ─── Inline schematics for the tier-2 info card ─────────────────────────
 *
 * Each schematic illustrates a *family* of metrics rather than a single
 * pill — most pills slot into one of these five-ish concepts:
 *
 *   rotation  → arc + arrow (hue rotation, trend)
 *   magnitude → two dots + connecting segment (ΔE, chroma)
 *   residual  → signed axis with + / − labels (ΔL, Δa, Δb, EXP-*)
 *   spread    → cluster of dots around a centroid (CAMERA σ)
 *   pair      → quadrant split (BURN ΔE × CAMERA σ)
 *   wheel     → quartered colour wheel (EXP h°, measured h°)
 *   cycle     → ordered cells (CELL #, mode)
 *
 * Strokes use ``--color-primary`` at 80 % opacity over a faint border
 * background; labels in mono 9 px tracking-[0.16em] uppercase. ~140×80
 * px viewBox, drawn at 2× internal so we can stay sharp on retina.
 */

const VB_W = 140;
const VB_H = 80;
const STROKE = "var(--color-primary)";
const STROKE_OP = 0.8;
const FAINT = "var(--color-border)";
const LABEL = "var(--color-ink-subtle)";

interface Props {
  schematic: SchematicId;
}

export function StabilityHelpSchematic({ schematic }: Props) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width="140"
      height="80"
      className="block"
      aria-hidden
    >
      <rect
        x={0.5}
        y={0.5}
        width={VB_W - 1}
        height={VB_H - 1}
        rx={4}
        ry={4}
        fill="transparent"
        stroke={FAINT}
        strokeOpacity={0.6}
      />
      {renderBody(schematic)}
    </svg>
  );
}

function renderBody(id: SchematicId) {
  switch (id) {
    case "rotation":
      return <RotationSchematic />;
    case "magnitude":
      return <MagnitudeSchematic />;
    case "residual":
      return <ResidualSchematic />;
    case "spread":
      return <SpreadSchematic />;
    case "pair":
      return <PairSchematic />;
    case "wheel":
      return <WheelSchematic />;
    case "cycle":
      return <CycleSchematic />;
  }
}

/* ─── Rotation: quarter-arc with arrow ─────────────────────────────────── */

function RotationSchematic() {
  const cx = 70;
  const cy = 50;
  const r = 26;
  // Quarter arc from 0° (right) sweeping clockwise to ~70°
  const a0 = 0;
  const a1 = (70 * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy - r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy - r * Math.sin(a1);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      <path
        d={`M ${x0} ${y0} A ${r} ${r} 0 0 0 ${x1} ${y1}`}
        fill="none"
        stroke={STROKE}
        strokeOpacity={STROKE_OP}
        strokeWidth={1.5}
      />
      {/* Arrow head pointing along the arc tangent at (x1,y1) */}
      <ArrowHead x={x1} y={y1} angleRad={a1 + Math.PI / 2} />
      {/* Centre dot + radial reference */}
      <circle cx={cx} cy={cy} r={1.5} fill={STROKE} fillOpacity={STROKE_OP} />
      <line x1={cx} y1={cy} x2={x0} y2={y0} stroke={FAINT} strokeOpacity={0.6} strokeDasharray="1 2" />
      <text x={cx + r + 4} y={cy + 3} {...labelProps()}>0°</text>
      <text x={x1 - 16} y={y1 - 6} {...labelProps()}>+Δh°</text>
    </g>
  );
}

/* ─── Magnitude: two dots + connecting line + formula ──────────────────── */

function MagnitudeSchematic() {
  const ax = 36, ay = 32;
  const bx = 96, by = 52;
  return (
    <g>
      {/* Connecting segment */}
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={STROKE} strokeOpacity={STROKE_OP} strokeWidth={1.5} />
      {/* Dashed orthogonal helpers */}
      <line x1={ax} y1={ay} x2={bx} y2={ay} stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      <line x1={bx} y1={ay} x2={bx} y2={by} stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      <circle cx={ax} cy={ay} r={3.5} fill={STROKE} fillOpacity={STROKE_OP} />
      <circle cx={bx} cy={by} r={3.5} fill={STROKE} fillOpacity={STROKE_OP} />
      <text x={ax - 4} y={ay - 6} textAnchor="end" {...labelProps()}>EXP</text>
      <text x={bx + 4} y={by + 4} {...labelProps()}>MEAS</text>
      <text x={(ax + bx) / 2} y={by + 14} textAnchor="middle" {...labelProps()}>ΔE = √(ΔL²+Δa²+Δb²)</text>
    </g>
  );
}

/* ─── Residual: signed axis with + / − labels ──────────────────────────── */

function ResidualSchematic() {
  const cx = VB_W / 2;
  const y = 42;
  const left = 18;
  const right = VB_W - 18;
  // A scattering of dots above/below the zero line at varying signs
  const dots = [
    { x: 32, y: y - 10 },
    { x: 50, y: y - 4 },
    { x: 72, y: y + 8 },
    { x: 90, y: y - 6 },
    { x: 108, y: y + 12 },
  ];
  return (
    <g>
      <line x1={left} y1={y} x2={right} y2={y} stroke={FAINT} strokeOpacity={0.7} />
      <line x1={cx} y1={y - 18} x2={cx} y2={y + 18} stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      <text x={left - 2} y={y + 3} textAnchor="end" {...labelProps()}>−</text>
      <text x={right + 2} y={y + 3} {...labelProps()}>+</text>
      <text x={cx} y={y - 22} textAnchor="middle" {...labelProps()}>0</text>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={2.8} fill={STROKE} fillOpacity={STROKE_OP} />
      ))}
    </g>
  );
}

/* ─── Spread: cluster of dots around a centroid ────────────────────────── */

function SpreadSchematic() {
  const cx = 70;
  const cy = 42;
  const dots = [
    { x: cx - 10, y: cy - 6 },
    { x: cx + 8, y: cy - 9 },
    { x: cx - 6, y: cy + 8 },
    { x: cx + 12, y: cy + 5 },
    { x: cx - 1, y: cy - 11 },
  ];
  return (
    <g>
      <circle cx={cx} cy={cy} r={16} fill="none" stroke={STROKE} strokeOpacity={STROKE_OP * 0.6} strokeDasharray="2 3" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={2.6} fill={STROKE} fillOpacity={STROKE_OP} />
      ))}
      <circle cx={cx} cy={cy} r={1.6} fill={STROKE} fillOpacity={STROKE_OP} />
      <line x1={cx} y1={cy} x2={cx + 16} y2={cy} stroke={STROKE} strokeOpacity={STROKE_OP * 0.5} />
      <text x={cx + 18} y={cy + 3} {...labelProps()}>σ</text>
      <text x={cx} y={cy - 20} textAnchor="middle" {...labelProps()}>RUNS</text>
    </g>
  );
}

/* ─── Pair: quadrant split ─────────────────────────────────────────────── */

function PairSchematic() {
  const x0 = 16, x1 = VB_W - 16;
  const y0 = 12, y1 = VB_H - 18;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dots = [
    { x: x0 + 16, y: y1 - 10 }, // accurate, repeatable
    { x: x1 - 12, y: y1 - 8 },  // noisy, accurate
    { x: x0 + 12, y: y0 + 10 }, // drifted but stable
    { x: x1 - 14, y: y0 + 12 }, // drifted + noisy
    { x: cx + 4, y: cy - 2 },
  ];
  return (
    <g>
      <line x1={x0} y1={y1} x2={x1} y2={y1} stroke={FAINT} strokeOpacity={0.7} />
      <line x1={x0} y1={y0} x2={x0} y2={y1} stroke={FAINT} strokeOpacity={0.7} />
      <line x1={x0} y1={cy} x2={x1} y2={cy} stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      <line x1={cx} y1={y0} x2={cx} y2={y1} stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={2.6} fill={STROKE} fillOpacity={STROKE_OP} />
      ))}
      <text x={x0 - 2} y={y1 + 9} {...labelProps()}>0</text>
      <text x={x1 + 2} y={y1 + 9} textAnchor="end" {...labelProps()}>σ→</text>
      <text x={x0 - 2} y={y0 + 6} {...labelProps()}>ΔE↑</text>
    </g>
  );
}

/* ─── Wheel: quartered colour wheel ────────────────────────────────────── */

function WheelSchematic() {
  const cx = 70;
  const cy = 40;
  const r = 26;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={STROKE} strokeOpacity={STROKE_OP} strokeWidth={1.4} />
      {/* Cross-hairs for the cardinal hues */}
      <line x1={cx - r - 4} y1={cy} x2={cx + r + 4} y2={cy} stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      <line x1={cx} y1={cy - r - 4} x2={cx} y2={cy + r + 4} stroke={FAINT} strokeOpacity={0.5} strokeDasharray="2 3" />
      {/* Tick dots at 0/90/180/270° */}
      <circle cx={cx + r} cy={cy} r={2} fill={STROKE} fillOpacity={STROKE_OP} />
      <circle cx={cx} cy={cy - r} r={2} fill={STROKE} fillOpacity={STROKE_OP} />
      <circle cx={cx - r} cy={cy} r={2} fill={STROKE} fillOpacity={STROKE_OP} />
      <circle cx={cx} cy={cy + r} r={2} fill={STROKE} fillOpacity={STROKE_OP} />
      <text x={cx + r + 6} y={cy + 3} {...labelProps()}>0°</text>
      <text x={cx} y={cy - r - 6} textAnchor="middle" {...labelProps()}>90°</text>
      <text x={cx - r - 6} y={cy + 3} textAnchor="end" {...labelProps()}>180°</text>
      <text x={cx} y={cy + r + 10} textAnchor="middle" {...labelProps()}>270°</text>
    </g>
  );
}

/* ─── Cycle: ordered grid of cells ─────────────────────────────────────── */

function CycleSchematic() {
  const cols = 6;
  const rows = 3;
  const x0 = 14;
  const y0 = 14;
  const w = VB_W - 28;
  const h = VB_H - 28;
  const cw = w / cols;
  const ch = h / rows;
  const cells: { x: number; y: number; idx: number; on: boolean }[] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: x0 + c * cw,
        y: y0 + r * ch,
        idx,
        on: idx === 0 || idx === 7 || idx === 14,
      });
      idx++;
    }
  }
  return (
    <g>
      {cells.map((c) => (
        <rect
          key={c.idx}
          x={c.x + 1}
          y={c.y + 1}
          width={cw - 2}
          height={ch - 2}
          rx={1}
          fill={c.on ? STROKE : "none"}
          fillOpacity={c.on ? STROKE_OP * 0.7 : 0}
          stroke={FAINT}
          strokeOpacity={0.6}
        />
      ))}
      {/* Sweep arrow along the first row */}
      <path
        d={`M ${x0 + 2} ${y0 + ch / 2} L ${x0 + w - 4} ${y0 + ch / 2}`}
        fill="none"
        stroke={STROKE}
        strokeOpacity={STROKE_OP * 0.6}
        strokeWidth={1.2}
      />
      <ArrowHead x={x0 + w - 4} y={y0 + ch / 2} angleRad={0} />
    </g>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function ArrowHead({ x, y, angleRad }: { x: number; y: number; angleRad: number }) {
  // Drawn as a small triangle. ``angleRad`` is the arrow's heading.
  const len = 5;
  const half = 3;
  const ax = x - Math.cos(angleRad) * len;
  const ay = y - Math.sin(angleRad) * len;
  const px = -Math.sin(angleRad) * half;
  const py = Math.cos(angleRad) * half;
  const p1x = ax + px;
  const p1y = ay + py;
  const p2x = ax - px;
  const p2y = ay - py;
  return (
    <path
      d={`M ${x} ${y} L ${p1x} ${p1y} L ${p2x} ${p2y} Z`}
      fill={STROKE}
      fillOpacity={STROKE_OP}
    />
  );
}

function labelProps() {
  return {
    fill: LABEL,
    style: {
      font: "600 9px var(--font-mono)",
      letterSpacing: "0.16em",
      textTransform: "uppercase" as const,
    },
  };
}
