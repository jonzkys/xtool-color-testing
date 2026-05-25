// web/src/components/forge/ForgeCanvas.tsx
import { useEffect, useRef } from "react";
import type { Contour, GeneratedClass, GeneratedPath } from "../../lib/forge/types";

/** Colour per path class — distinct, readable on the dark workbench. */
const CLASS_COLOR: Record<GeneratedClass, string> = {
  seed: "#7dd3fc", // sky
  perforate: "#facc15", // amber
  deepen: "#f97316", // orange (depth)
  clean: "#a3e635", // lime
};
const SOURCE_COLOR = "#64748b"; // slate — the original contour

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(paths: GeneratedPath[], source: Contour | null): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  source?.points.forEach((p) => eat(p.x, p.y));
  paths.forEach((pa) => pa.points.forEach((p) => eat(p.x, p.y)));
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

export interface ForgeCanvasProps {
  source: Contour | null;
  paths: GeneratedPath[];
  /** which classes to draw */
  visible: Record<GeneratedClass, boolean>;
  width: number;
  height: number;
}

export function ForgeCanvas({ source, paths, visible, width, height }: ForgeCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bb = bboxOf(paths, source);
    const pad = 16;
    const w = bb.maxX - bb.minX || 1;
    const h = bb.maxY - bb.minY || 1;
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = pad + (width - 2 * pad - w * scale) / 2 - bb.minX * scale;
    const oy = pad + (height - 2 * pad - h * scale) / 2 - bb.minY * scale;
    const X = (x: number) => x * scale + ox;
    const Y = (y: number) => y * scale + oy;

    const stroke = (pts: { x: number; y: number }[], closed: boolean, color: string, wpx: number) => {
      if (pts.length < 1) return;
      ctx.beginPath();
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
      if (closed) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = wpx;
      ctx.stroke();
    };

    // source contour first (faint dashed)
    if (source) {
      ctx.setLineDash([4, 3]);
      stroke(source.points, source.closed, SOURCE_COLOR, 1);
      ctx.setLineDash([]);
    }
    // generated paths, class-coloured
    for (const p of paths) {
      if (!visible[p.generatedClass]) continue;
      stroke(p.points, p.closed, CLASS_COLOR[p.generatedClass], p.generatedClass === "deepen" ? 1.5 : 1);
    }
  }, [source, paths, visible, width, height]);

  return <canvas ref={ref} style={{ width, height }} className="block rounded bg-[var(--color-surface)]" />;
}

export { CLASS_COLOR };
