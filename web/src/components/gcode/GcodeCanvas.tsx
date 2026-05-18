import { useEffect, useRef } from "react";
import type { BBox, Block } from "../../lib/gcode/types";

/** A block paired with the configured peak power of its parent layer.
 * Used so the canvas can detect cleanup passes (peakS << configured)
 * even when the canvas is showing blocks from multiple layers at once. */
export interface GcodeRenderItem {
  block: Block;
  /** Configured peak S for this block's parent layer. null when the
   * config doesn't expose a power[] (e.g. vector blocks). */
  configuredPeak: number | null;
}

interface GcodeCanvasProps {
  items: GcodeRenderItem[];
  bbox: BBox;
  /** Render footprint in CSS pixels. Component upscales the backing
   * store by devicePixelRatio for crisp lines. */
  width: number;
  height: number;
  /** Show faint grey dashed lines for G0 rapids + S=0 G1 moves. */
  showTravels?: boolean;
  /** Caption text rendered next to the bbox readout. */
  caption?: string;
  /** Optional single block to highlight on top of the base render.
   * Painted as a cyan glow + bold white stroke so it pops against
   * the warm ramp. Changing this prop re-uses the cached base render
   * (offscreen canvas) so scrubbing is O(1) per tick. */
  highlight?: Block | null;
}

/** Number of power buckets for batched stroking. Visually
 * indistinguishable from per-segment colour at 16 bands. */
const POWER_BANDS = 16;

/** A block is treated as a "cleanup pass" when its peak S falls
 * below this fraction of the configured peak power. */
const CLEANUP_PEAK_RATIO = 0.5;

function isCleanup(item: GcodeRenderItem): boolean {
  if (item.configuredPeak == null) return false;
  if (item.block.peakS <= 0) return false;
  return item.block.peakS < item.configuredPeak * CLEANUP_PEAK_RATIO;
}

interface Transform {
  scale: number;
  ox: number;
  oy: number;
  bw: number;
  bh: number;
}

function computeTransform(bbox: BBox, width: number, height: number): Transform | null {
  const bw = bbox.maxX - bbox.minX;
  const bh = bbox.maxY - bbox.minY;
  if (!Number.isFinite(bw) || !Number.isFinite(bh) || bw <= 0 || bh <= 0) {
    return null;
  }
  const pad = 12;
  const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const ox = pad + (width - pad * 2 - bw * scale) / 2 - bbox.minX * scale;
  const oy = pad + (height - pad * 2 - bh * scale) / 2 - bbox.minY * scale;
  return { scale, ox, oy, bw, bh };
}

/**
 * Stateless canvas renderer. Caches the base render (all `items` +
 * chrome) on an offscreen canvas; on `highlight` changes it just
 * blits the cache and overlays the highlighted block. This keeps
 * the all-layers slider scrub at O(highlight) instead of O(items).
 */
export function GcodeCanvas({
  items,
  bbox,
  width,
  height,
  showTravels = true,
  caption,
  highlight = null,
}: GcodeCanvasProps) {
  const visibleRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const cachedTransformRef = useRef<Transform | null>(null);

  // ── Base render (heavy): items / bbox / dims / travels ─────────────────────
  useEffect(() => {
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement("canvas");
    }
    const off = offscreenRef.current;
    const dpr = window.devicePixelRatio || 1;
    off.width = Math.round(width * dpr);
    off.height = Math.round(height * dpr);
    const ctx = off.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#22201C";
    ctx.fillRect(0, 0, width, height);

    const t = computeTransform(bbox, width, height);
    cachedTransformRef.current = t;
    if (!t) return;
    const toX = (x: number) => x * t.scale + t.ox;
    const toY = (y: number) => y * t.scale + t.oy;

    // Origin crosshair
    const o0x = toX(0);
    const o0y = toY(0);
    if (o0x >= 0 && o0x <= width && o0y >= 0 && o0y <= height) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(o0x - 8, o0y);
      ctx.lineTo(o0x + 8, o0y);
      ctx.moveTo(o0x, o0y - 8);
      ctx.lineTo(o0x, o0y + 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineCap = "round";

    if (items.length > 0) {
      if (showTravels) {
        const travels = new Path2D();
        for (const item of items) {
          const segs = item.block.segments;
          for (let i = 1; i < segs.length; i++) {
            const s = segs[i];
            if (!(s.rapid || s.s === 0)) continue;
            const p = segs[i - 1];
            travels.moveTo(toX(p.x), toY(p.y));
            travels.lineTo(toX(s.x), toY(s.y));
          }
        }
        ctx.strokeStyle = "rgba(150,150,150,0.30)";
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 4]);
        ctx.stroke(travels);
        ctx.setLineDash([]);
      }
      const buckets: Path2D[] = Array.from(
        { length: POWER_BANDS },
        () => new Path2D(),
      );
      const cleanupPath = new Path2D();
      let cleanupSegCount = 0;
      for (const item of items) {
        const cleanup = isCleanup(item);
        const segs = item.block.segments;
        for (let i = 1; i < segs.length; i++) {
          const s = segs[i];
          if (s.rapid || s.s === 0) continue;
          const p = segs[i - 1];
          if (cleanup) {
            cleanupPath.moveTo(toX(p.x), toY(p.y));
            cleanupPath.lineTo(toX(s.x), toY(s.y));
            cleanupSegCount++;
          } else {
            let b = Math.floor((s.s / 1000) * POWER_BANDS);
            if (b < 0) b = 0;
            if (b >= POWER_BANDS) b = POWER_BANDS - 1;
            buckets[b].moveTo(toX(p.x), toY(p.y));
            buckets[b].lineTo(toX(s.x), toY(s.y));
          }
        }
      }
      ctx.lineWidth = 1;
      for (let b = 0; b < POWER_BANDS; b++) {
        const t2 = (b + 0.5) / POWER_BANDS;
        const r = Math.round(t2 * 255);
        const g = Math.round(t2 * 80);
        const bl = Math.round(t2 * 16);
        ctx.strokeStyle = `rgb(${r}, ${g}, ${bl})`;
        ctx.stroke(buckets[b]);
      }
      if (cleanupSegCount > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = 1.2;
        ctx.stroke(cleanupPath);
        ctx.lineWidth = 1;
      }
    }

    // Chrome: bbox readout (bottom-left)
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textBaseline = "bottom";
    const capSuffix = caption ? `   ·   ${caption}` : "";
    ctx.fillText(
      `W ${t.bw.toFixed(1)} mm  ×  H ${t.bh.toFixed(1)} mm${capSuffix}`,
      8,
      height - 8,
    );

    // Chrome: mm scale bar (bottom-right)
    const targetPx = 60;
    const mmRaw = targetPx / t.scale;
    const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200];
    let mm = niceSteps[0];
    for (const step of niceSteps) {
      if (step <= mmRaw) mm = step;
    }
    const barPx = mm * t.scale;
    const barRight = width - 12;
    const barLeft = barRight - barPx;
    const barY = height - 22;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barLeft, barY);
    ctx.lineTo(barRight, barY);
    ctx.moveTo(barLeft, barY - 3);
    ctx.lineTo(barLeft, barY + 3);
    ctx.moveTo(barRight, barY - 3);
    ctx.lineTo(barRight, barY + 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${mm} mm`, barRight, barY + 4);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }, [items, bbox, width, height, showTravels, caption]);

  // ── Paint pass: blit cached base + draw highlight overlay ──────────────────
  useEffect(() => {
    const visible = visibleRef.current;
    if (!visible) return;
    const dpr = window.devicePixelRatio || 1;
    visible.width = Math.round(width * dpr);
    visible.height = Math.round(height * dpr);
    visible.style.width = `${width}px`;
    visible.style.height = `${height}px`;
    const ctx = visible.getContext("2d");
    if (!ctx) return;
    const off = offscreenRef.current;
    if (off) {
      // drawImage in source-pixel units: copy the offscreen pixel grid
      // 1:1 onto the visible canvas (both sized with the same dpr).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off, 0, 0);
    }
    if (!highlight) return;
    const t = cachedTransformRef.current;
    if (!t) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toX = (x: number) => x * t.scale + t.ox;
    const toY = (y: number) => y * t.scale + t.oy;
    const path = new Path2D();
    const segs = highlight.segments;
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i];
      // Include rapids in the highlight outline so the block's full
      // path silhouette is visible — useful when the block is small.
      const p = segs[i - 1];
      path.moveTo(toX(p.x), toY(p.y));
      path.lineTo(toX(s.x), toY(s.y));
    }
    // Cyan glow underlay so the highlight stands out even on a
    // patch of white-stroked cleanup segments.
    ctx.strokeStyle = "rgba(0,200,255,0.45)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke(path);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 1.6;
    ctx.stroke(path);
  }, [items, bbox, width, height, showTravels, caption, highlight]);

  return <canvas ref={visibleRef} aria-label="Gcode layer preview" />;
}
