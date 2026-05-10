import * as React from "react";
import type { Polygon } from "./proposeTestMath";

interface Props {
  /** SVG bounds in pixels; the component renders a transparent <rect>
   *  this big to capture clicks. */
  width: number;
  height: number;
  /** Convert SVG (px, px) to index-space (xKey, yKey). */
  fromSvg: (sx: number, sy: number) => readonly [number, number];
  /** Current in-progress polygon (vertices added so far). */
  vertices: Polygon;
  /** Called every time a vertex is added (single click). */
  onVertexAdd: (point: readonly [number, number]) => void;
  /** Called when the polygon is closed (double-click or Enter). */
  onClose: () => void;
  /** Called when the user cancels (Esc). */
  onCancel: () => void;
}

export const ExposurePolygonDraw: React.FC<Props> = ({
  width, height, fromSvg, vertices, onVertexAdd, onClose, onCancel,
}) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onCancel]);

  const handleClick = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = (e.currentTarget.ownerSVGElement as SVGSVGElement);
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    onVertexAdd(fromSvg(local.x, local.y));
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGRectElement>) => {
    e.preventDefault();
    if (vertices.length >= 3) onClose();
  };

  return (
    <g data-role="propose-draw">
      <rect
        x={0} y={0} width={width} height={height}
        fill="transparent"
        style={{ cursor: "crosshair" }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />
    </g>
  );
};
