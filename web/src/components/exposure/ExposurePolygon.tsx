import * as React from "react";
import type { Polygon } from "./proposeTestMath";

interface Props {
  /** Polygon vertices in *index-space* (xKey, yKey) units. */
  polygon: Polygon;
  /** Project an (x, y) index-space point into SVG (px, px). */
  toSvg: (x: number, y: number) => readonly [number, number];
  /** True while the user is still adding vertices (dashed stroke). */
  drawing: boolean;
  /** Optional vertex drag handle callback. Pass undefined to disable. */
  onVertexDrag?: (vertexIndex: number, newPoint: readonly [number, number]) => void;
}

export const ExposurePolygon: React.FC<Props> = ({
  polygon, toSvg, drawing, onVertexDrag,
}) => {
  if (polygon.length < 2) return null;
  const projected = polygon.map(([x, y]) => toSvg(x, y));
  const points = projected.map(([sx, sy]) => `${sx},${sy}`).join(" ");

  return (
    <g data-role="propose-polygon">
      <polygon
        points={points}
        fill="rgba(195, 90, 70, 0.13)"
        stroke="#c35a46"
        strokeWidth={2}
        strokeDasharray={drawing ? "5,4" : undefined}
        pointerEvents="none"
      />
      {projected.map(([sx, sy], i) => (
        <circle
          key={i}
          cx={sx}
          cy={sy}
          r={4}
          fill="#c35a46"
          stroke="#fff"
          strokeWidth={1.5}
          style={{ cursor: onVertexDrag ? "move" : "default" }}
          onMouseDown={onVertexDrag ? (e) => {
            e.preventDefault();
            // Drag is handled by the parent via mousemove on the SVG;
            // this captures only the start. Forward the vertex index +
            // current SVG point so the parent can stash starting state
            // if needed.
            onVertexDrag(i, [sx, sy]);
          } : undefined}
        />
      ))}
    </g>
  );
};
