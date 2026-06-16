// web/src/components/forge/SpiralDurationCanvas.tsx
//
// Accurate-scale heatmap of the REAL generated spiral paths: each path stroked
// in a colour mapped (log scale) from its cut duration, so under-served small
// features (red) and over-served large ones (steel) are visible at a glance.
// Read-only diagnostic — mirrors SpiralCanvas's canvas/DPR setup but draws the
// true polylines (result.paths) rather than the not-to-scale schematic.
import { useEffect, useMemo, useRef } from "react";
import type { ForgeConfig, GeneratedPath, StageParams } from "../../lib/forge/types";
import { spiralPathDurations, fmtDuration } from "../../lib/forge/estimate";
import { logNormalize, durationColor, HEAT_STOPS } from "../../lib/forge/heatmap";

export interface SpiralDurationCanvasProps {
  paths: GeneratedPath[];
  config: ForgeConfig;
  source?: StageParams;
  width: number;
  height: number;
}

export function SpiralDurationCanvas({ paths, config, source, width, height }: SpiralDurationCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const data = useMemo(() => {
    const durs = spiralPathDurations(paths, config, source);
    const seconds = durs.map((d) => d.seconds);
    const t = logNormalize(seconds);
    let dMin = Infinity, dMax = -Infinity;
    for (const s of seconds) { if (s < dMin) dMin = s; if (s > dMax) dMax = s; }
    return { durs, t, dMin: Number.isFinite(dMin) ? dMin : 0, dMax: Number.isFinite(dMax) ? dMax : 0 };
  }, [paths, config, source]);

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
    const { durs, t } = data;
    if (durs.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { path } of durs) for (const ring of path.rings) for (const p of ring) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return;

    const pad = 22;
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = pad + (width - 2 * pad - w * scale) / 2 - minX * scale;
    const oy = pad + (height - 2 * pad - h * scale) / 2 - minY * scale;
    const X = (x: number) => x * scale + ox;
    const Y = (y: number) => y * scale + oy;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(0.5, 1 / dpr); // 1 CSS-px hairline, matching SpiralCanvas
    ctx.globalAlpha = 0.9;
    // No display decimation: acceptable for v1 (paths are the spiral generator's
    // output — typically <50 arms; the stroke loop stays well under a frame).
    durs.forEach(({ path }, i) => {
      ctx.strokeStyle = durationColor(t[i]);
      for (const ring of path.rings) {
        if (ring.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(X(ring[0].x), Y(ring[0].y));
        for (let j = 1; j < ring.length; j++) ctx.lineTo(X(ring[j].x), Y(ring[j].y));
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }, [data, width, height]);

  const has = data.durs.length > 0;
  const gradientCss = `linear-gradient(to right, ${HEAT_STOPS.map((s) => s.hex).join(", ")})`;

  return (
    <div className="relative h-full w-full">
      <canvas ref={ref} style={{ width, height }} className="block rounded bg-[var(--color-surface)]" />
      {has ? (
        <div className="pointer-events-none absolute left-3 right-3 bottom-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-subtle)]">
          <span>{fmtDuration(data.dMin)}</span>
          <span className="h-2 flex-1 rounded-[2px]" style={{ background: gradientCss }} aria-hidden />
          <span>{fmtDuration(data.dMax)}</span>
          <span className="ml-1 normal-case tracking-[0.06em] text-[var(--color-ink-muted)]">time / feature · red = least</span>
        </div>
      ) : (
        <div className="pointer-events-none absolute left-3 bottom-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-subtle)]">
          no cut paths
        </div>
      )}
      <span className="sr-only">
        {has
          ? `Duration heatmap of ${data.durs.length} spiral path${data.durs.length === 1 ? "" : "s"}. Colour scale red = shortest, steel = longest; range ${fmtDuration(data.dMin)} to ${fmtDuration(data.dMax)}.`
          : "Duration heatmap: nothing to show yet."}
      </span>
    </div>
  );
}
