import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";

interface Props {
  rows: readonly ExposureRow[];
  focusedId: number | null;
  /** Square SVG viewport size in CSS px. Default 160. */
  size?: number;
  /** a* / b* range plotted before the disc edge. Defaults to ±60. */
  range?: number;
  onHover?: (id: number) => void;
  onLeave?: () => void;
  onClick?: (id: number) => void;
}

/**
 * The a* / b* chromaticity disc. Every entry is rendered as a small
 * swatch-coloured dot at its measured (a, b). Concentric rings at
 * chroma = 20, 40, 60. Conventional CIE Lab orientation: +b* up,
 * +a* right.
 *
 * The focused entry gets an outer ring + crosshair guides. Used in
 * the Focused card at idle (focusedId=null, just dots) and active
 * (focusedId=N, dot + crosshair) states.
 */
export const ExposureChromaDisc: React.FC<Props> = ({
  rows,
  focusedId,
  size = 160,
  range = 60,
  onHover,
  onLeave,
  onClick,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;

  const project = (a: number, b: number): [number, number] => {
    const x = cx + (a / range) * r;
    const y = cy - (b / range) * r;
    return [x, y];
  };

  const focused = focusedId == null ? null : rows.find((row) => row.id === focusedId);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="a* / b* chromaticity disc"
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="0.6" />
      <circle cx={cx} cy={cy} r={r * 2 / 3} fill="none" stroke="var(--color-border)" strokeWidth="0.4" />
      <circle cx={cx} cy={cy} r={r / 3} fill="none" stroke="var(--color-border)" strokeWidth="0.4" />
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="var(--color-border)" strokeWidth="0.4" />
      <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="var(--color-border)" strokeWidth="0.4" />
      <text x={cx + r + 4} y={cy + 3} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)">+a</text>
      <text x={cx - r - 4} y={cy + 3} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)" textAnchor="end">−a</text>
      <text x={cx} y={cy - r - 4} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)" textAnchor="middle">+b</text>
      <text x={cx} y={cy + r + 9} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)" textAnchor="middle">−b</text>

      {rows.map((row) => {
        const [, a, b] = row.lab;
        const [px, py] = project(a, b);
        const isFocused = row.id === focusedId;
        return (
          <circle
            key={row.id}
            data-role="entry-dot"
            cx={px}
            cy={py}
            r={isFocused ? 4 : 2.5}
            fill={row.hex}
            stroke="var(--color-surface)"
            strokeWidth={0.5}
            onMouseEnter={() => onHover?.(row.id)}
            onMouseLeave={() => onLeave?.()}
            onClick={() => onClick?.(row.id)}
            style={{ cursor: onClick ? "pointer" : undefined }}
          />
        );
      })}

      {focused && (() => {
        const [, a, b] = focused.lab;
        const [px, py] = project(a, b);
        return (
          <g>
            <circle
              data-role="focus-ring"
              cx={px}
              cy={py}
              r={7}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1.4}
            />
            <line
              data-role="focus-crosshair"
              x1={px - 12}
              y1={py}
              x2={px + 12}
              y2={py}
              stroke="var(--color-primary)"
              strokeWidth={0.6}
              opacity={0.7}
            />
            <line
              data-role="focus-crosshair"
              x1={px}
              y1={py - 12}
              x2={px}
              y2={py + 12}
              stroke="var(--color-primary)"
              strokeWidth={0.6}
              opacity={0.7}
            />
          </g>
        );
      })()}
    </svg>
  );
};
