import type { ExposureSchematicId } from "./exposureHelpCopy";

/* ─── Inline schematics for the exposure-side help cards ──────────────────
 *
 * Five family illustrations matching the exposure register. All
 * 140×80 px viewBox, primary stroke at 80 % opacity over a faint
 * border background — same conventions as StabilityHelpSchematic so
 * the two card stacks read as a family.
 *
 *   dot_pitch     → discrete dots along a horizontal line
 *   line_pitch    → stacked parallel hatch lines
 *   pulse_shape   → one pulse waveform with area + peak markers
 *   accumulation  → multiple overlapping passes building density
 *   combination   → two-arrow split (multiplicative or ratio)
 */

const VB_W = 140;
const VB_H = 80;
const STROKE = "var(--color-primary)";
const STROKE_OP = 0.8;
const FAINT = "var(--color-border)";
const LABEL = "var(--color-ink-subtle)";

const LABEL_STYLE = {
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
};

export const EXPOSURE_SCHEMATIC_IDS: readonly ExposureSchematicId[] = [
  "dot_pitch",
  "line_pitch",
  "pulse_shape",
  "accumulation",
  "combination",
];

interface Props {
  schematic: ExposureSchematicId;
}

export function ExposureHelpSchematic({ schematic }: Props) {
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

function renderBody(id: ExposureSchematicId) {
  switch (id) {
    case "dot_pitch":    return <DotPitch />;
    case "line_pitch":   return <LinePitch />;
    case "pulse_shape":  return <PulseShape />;
    case "accumulation": return <Accumulation />;
    case "combination":  return <Combination />;
  }
}

function DotPitch() {
  const cy = 42;
  const dx = 18;
  const x0 = 22;
  return (
    <g>
      <line
        x1={x0 - 6}
        y1={cy}
        x2={x0 + dx * 5 + 6}
        y2={cy}
        stroke={FAINT}
        strokeWidth={1}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle
          key={i}
          cx={x0 + i * dx}
          cy={cy}
          r={3}
          fill={STROKE}
          fillOpacity={STROKE_OP}
        />
      ))}
      <line
        x1={x0}
        y1={cy + 12}
        x2={x0 + dx}
        y2={cy + 12}
        stroke={STROKE}
        strokeOpacity={STROKE_OP}
        strokeWidth={1}
      />
      <text
        x={x0 + dx / 2}
        y={cy + 24}
        style={LABEL_STYLE}
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
      >
        SPACING
      </text>
    </g>
  );
}

function LinePitch() {
  const x0 = 22;
  const x1 = 118;
  const y0 = 18;
  const dy = 11;
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={x0}
          y1={y0 + i * dy}
          x2={x1}
          y2={y0 + i * dy}
          stroke={STROKE}
          strokeOpacity={STROKE_OP}
          strokeWidth={1.5}
        />
      ))}
      <text
        x={70}
        y={75}
        style={LABEL_STYLE}
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
      >
        LINE PITCH
      </text>
    </g>
  );
}

function PulseShape() {
  const baseY = 56;
  const peakX = 70;
  const peakY = 18;
  const w = 28;
  const path = `M ${peakX - w} ${baseY} L ${peakX} ${peakY} L ${peakX + w} ${baseY} Z`;
  return (
    <g>
      <line
        x1={20}
        y1={baseY}
        x2={120}
        y2={baseY}
        stroke={FAINT}
        strokeWidth={1}
      />
      <path
        d={path}
        fill={STROKE}
        fillOpacity={0.18}
        stroke={STROKE}
        strokeOpacity={STROKE_OP}
        strokeWidth={1.5}
      />
      <circle cx={peakX} cy={peakY} r={2.5} fill={STROKE} fillOpacity={STROKE_OP} />
      <text
        x={70}
        y={75}
        style={LABEL_STYLE}
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
      >
        ENERGY · PEAK
      </text>
    </g>
  );
}

function Accumulation() {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={28 + i * 14}
          y={20 + i * 4}
          width={70}
          height={30 - i * 4}
          rx={2}
          ry={2}
          fill={STROKE}
          fillOpacity={0.18 + i * 0.18}
          stroke={STROKE}
          strokeOpacity={STROKE_OP}
          strokeWidth={1}
        />
      ))}
      <text
        x={70}
        y={75}
        style={LABEL_STYLE}
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
      >
        PASSES STACK
      </text>
    </g>
  );
}

function Combination() {
  const cx = 70;
  const cy = 42;
  return (
    <g>
      <line x1={26} y1={cy} x2={cx - 4} y2={cy} stroke={STROKE} strokeOpacity={STROKE_OP} strokeWidth={1.5} />
      <polygon
        points={`${cx - 4},${cy - 4} ${cx},${cy} ${cx - 4},${cy + 4}`}
        fill={STROKE}
        fillOpacity={STROKE_OP}
      />
      <line x1={cx} y1={70} x2={cx} y2={cy + 4} stroke={STROKE} strokeOpacity={STROKE_OP} strokeWidth={1.5} />
      <polygon
        points={`${cx - 4},${cy + 4} ${cx},${cy} ${cx + 4},${cy + 4}`}
        fill={STROKE}
        fillOpacity={STROKE_OP}
      />
      <circle cx={cx} cy={cy} r={3.5} fill={STROKE} fillOpacity={STROKE_OP} />
      <text
        x={42}
        y={cy - 6}
        style={LABEL_STYLE}
        fontSize={8}
        fill={LABEL}
      >
        DOSE
      </text>
      <text
        x={cx + 4}
        y={66}
        style={LABEL_STYLE}
        fontSize={8}
        fill={LABEL}
      >
        INTENSITY
      </text>
    </g>
  );
}
