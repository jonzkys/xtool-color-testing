import * as React from "react";

interface Props {
  /** Optional dashed curve to draw (curve mode). */
  curve?: ReadonlyArray<{ x: number; y: number }> | null;
  /** N proposed cells. Each rendered as a filled circle. */
  cells: ReadonlyArray<{ x: number; y: number }>;
  /** Project (xIndex, yIndex) → SVG (px, px). */
  toSvg: (x: number, y: number) => readonly [number, number];
}

export const ExposureCellsPreview: React.FC<Props> = ({ curve, cells, toSvg }) => {
  const cellPath = cells.map((c) => toSvg(c.x, c.y));
  const curvePath = (curve ?? []).map((p) => toSvg(p.x, p.y));
  return (
    <g data-role="propose-cells">
      {curvePath.length > 1 && (
        <polyline
          points={curvePath.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="#1a6ec0"
          strokeWidth={1.6}
          strokeDasharray="3,2"
          opacity={0.85}
          pointerEvents="none"
        />
      )}
      {cellPath.map(([sx, sy], i) => (
        <circle
          key={i}
          cx={sx}
          cy={sy}
          r={5.5}
          fill="#c35a46"
          stroke="#fff"
          strokeWidth={1.5}
          opacity={0.95}
          pointerEvents="none"
        />
      ))}
    </g>
  );
};
