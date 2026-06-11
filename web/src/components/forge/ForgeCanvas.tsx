// web/src/components/forge/ForgeCanvas.tsx
import { useEffect, useRef } from "react";
import type { Contour, GeneratedClass, GeneratedPath } from "../../lib/forge/types";

/** Colour per path class — distinct, readable on the dark workbench. */
const CLASS_COLOR: Record<GeneratedClass, string> = {
  seed: "#7dd3fc", // sky
  perforate: "#facc15", // amber
  deepen: "#f97316", // orange (depth)
  clean: "#a3e635", // lime
  spiral: "#ec4899", // pink
};
const SOURCE_COLOR = "#64748b"; // slate — the original contour

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(paths: GeneratedPath[], source: Contour[] | null): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  source?.forEach((c) => c.points.forEach((p) => eat(p.x, p.y)));
  paths.forEach((pa) => pa.rings.forEach((r) => r.forEach((p) => eat(p.x, p.y))));
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

export interface ForgeCanvasProps {
  source: Contour[] | null;
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

    const strokeLoop = (pts: { x: number; y: number }[], closed: boolean, color: string, wpx: number) => {
      if (pts.length < 1) return;
      ctx.beginPath();
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
      if (closed) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = wpx;
      ctx.stroke();
    };

    /** Build a Path2D of all a band's rings so it can be filled even-odd
     *  (fills only the kerf sliver, leaving the part body — a ring — empty). */
    const ringsPath = (rings: { x: number; y: number }[][]): Path2D => {
      const path = new Path2D();
      for (const r of rings) {
        if (r.length < 2) continue;
        path.moveTo(X(r[0].x), Y(r[0].y));
        for (let i = 1; i < r.length; i++) path.lineTo(X(r[i].x), Y(r[i].y));
        path.closePath();
      }
      return path;
    };
    const fillBand = (rings: { x: number; y: number }[][], color: string, fillAlpha: number) => {
      const path = ringsPath(rings);
      ctx.fillStyle = color;
      ctx.globalAlpha = fillAlpha;
      ctx.fill(path, "evenodd");
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.75;
      ctx.stroke(path);
      ctx.globalAlpha = 1;
    };

    // source contours first (faint dashed) — one per subpath
    if (source && source.length > 0) {
      ctx.setLineDash([4, 3]);
      for (const c of source) {
        strokeLoop(c.points, c.closed, SOURCE_COLOR, 1);
      }
      ctx.setLineDash([]);
    }

    const drawn = paths.filter((p) => visible[p.generatedClass]);
    // Layer back-to-front so the staging reads cleanly: widest deepen bands
    // first (background), then seed, clean, and finally perforation pockets.
    const deepen = drawn
      .filter((p) => p.generatedClass === "deepen")
      .sort((a, b) => b.widthMultiplier - a.widthMultiplier);
    const seed = drawn.filter((p) => p.generatedClass === "seed");
    const clean = drawn.filter((p) => p.generatedClass === "clean");
    const perforate = drawn.filter((p) => p.generatedClass === "perforate");

    for (const p of deepen) fillBand(p.rings, CLASS_COLOR.deepen, 0.22);
    for (const p of seed) fillBand(p.rings, CLASS_COLOR.seed, 0.3);
    for (const p of clean) fillBand(p.rings, CLASS_COLOR.clean, 0.35);
    // perforation pockets are small solid features — fill opaque-ish
    for (const p of perforate) fillBand(p.rings, CLASS_COLOR.perforate, 0.85);
  }, [source, paths, visible, width, height]);

  return <canvas ref={ref} style={{ width, height }} className="block rounded bg-[var(--color-surface)]" />;
}

export { CLASS_COLOR };
