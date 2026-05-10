import * as React from "react";
import type { Polygon } from "./proposeTestMath";

interface Props {
  /** Polygon vertices in *index-space* (xKey, yKey) units. */
  polygon: Polygon;
  /** Project an (x, y) index-space point into SVG (px, px). */
  toSvg: (x: number, y: number) => readonly [number, number];
  /** Inverse projection. Required when onVertexMove is set so the drag
   *  handler can map mouse coords back to index space. */
  fromSvg?: (sx: number, sy: number) => readonly [number, number];
  /** True while the user is still adding vertices (dashed stroke). */
  drawing: boolean;
  /** Called continuously during a vertex drag with the new index-space
   *  coords. Pass undefined to disable dragging. */
  onVertexMove?: (vertexIndex: number, newPoint: readonly [number, number]) => void;
}

export const ExposurePolygon: React.FC<Props> = ({
  polygon, toSvg, fromSvg, drawing, onVertexMove,
}) => {
  if (polygon.length < 2) return null;
  const projected = polygon.map(([x, y]) => toSvg(x, y));
  const points = projected.map(([sx, sy]) => `${sx},${sy}`).join(" ");
  const draggable = !drawing && !!onVertexMove && !!fromSvg;

  const handleVertexMouseDown = (
    e: React.MouseEvent<SVGCircleElement>,
    vertexIndex: number,
  ) => {
    if (!draggable) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const inv = ctm.inverse();
    const move = (ev: MouseEvent) => {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const local = pt.matrixTransform(inv);
      onVertexMove!(vertexIndex, fromSvg!(local.x, local.y));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

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
          r={5}
          fill="#c35a46"
          stroke="#fff"
          strokeWidth={1.5}
          style={{ cursor: draggable ? "move" : "default" }}
          onMouseDown={draggable ? (e) => handleVertexMouseDown(e, i) : undefined}
        />
      ))}
    </g>
  );
};
