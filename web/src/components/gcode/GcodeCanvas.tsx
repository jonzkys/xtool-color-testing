import { useEffect, useRef } from "react";
import type { Layer } from "../../lib/gcode/types";

interface GcodeCanvasProps {
  layer: Layer | null;
  /** Render footprint in CSS pixels. Component upscales the backing
   * store by devicePixelRatio for crisp lines. */
  width: number;
  height: number;
  /** Show faint grey dashed lines for G0 rapids + S=0 G1 moves. */
  showTravels?: boolean;
}

/**
 * Stateless canvas renderer for one gcode layer. Auto-fits the
 * layer's bbox into the viewport with 12 px padding, draws burns
 * coloured by S (power 0-1000), and overlays the bbox readout,
 * origin crosshair, and an mm scale bar (design spec §8).
 */
export function GcodeCanvas({
  layer,
  width,
  height,
  showTravels = true,
}: GcodeCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Substrate background — matches the design token for "the
    // physical workpiece" used elsewhere in the app.
    ctx.fillStyle = "#22201C";
    ctx.fillRect(0, 0, width, height);

    if (!layer) return;
    const bbox = layer.bbox;
    const bw = bbox.maxX - bbox.minX;
    const bh = bbox.maxY - bbox.minY;
    if (!Number.isFinite(bw) || !Number.isFinite(bh) || bw <= 0 || bh <= 0) {
      // Degenerate layer (empty blocks) — leave the substrate blank.
      return;
    }

    const pad = 12;
    const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
    const ox = pad + (width - pad * 2 - bw * scale) / 2 - bbox.minX * scale;
    const oy = pad + (height - pad * 2 - bh * scale) / 2 - bbox.minY * scale;

    const toX = (x: number) => x * scale + ox;
    const toY = (y: number) => y * scale + oy;

    // ─── Origin crosshair (if (0,0) falls in the viewport) ───────
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

    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    // ─── Travels (drawn first so burns sit on top) ───────────────
    if (showTravels) {
      ctx.strokeStyle = "rgba(150,150,150,0.30)";
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2, 4]);
      for (const block of layer.blocks) {
        const segs = block.segments;
        for (let i = 1; i < segs.length; i++) {
          const s = segs[i];
          if (!(s.rapid || s.s === 0)) continue;
          const p = segs[i - 1];
          ctx.beginPath();
          ctx.moveTo(toX(p.x), toY(p.y));
          ctx.lineTo(toX(s.x), toY(s.y));
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // ─── Burn segments — colour by power ─────────────────────────
    for (const block of layer.blocks) {
      const segs = block.segments;
      for (let i = 1; i < segs.length; i++) {
        const s = segs[i];
        if (s.rapid || s.s === 0) continue;
        const p = segs[i - 1];
        const t = s.s / 1000;
        const r = Math.round(t * 255);
        const g = Math.round(t * 80);
        const b = Math.round(t * 16);
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.moveTo(toX(p.x), toY(p.y));
        ctx.lineTo(toX(s.x), toY(s.y));
        ctx.stroke();
      }
    }

    // ─── Chrome: bbox readout (bottom-left) ──────────────────────
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `W ${bw.toFixed(1)} mm  ×  H ${bh.toFixed(1)} mm`,
      8,
      height - 8,
    );

    // ─── Chrome: mm scale bar (bottom-right) ─────────────────────
    // Target a bar 40-80 px wide. Pick a round mm value (1, 2, 5, 10, …).
    const targetPx = 60;
    const mmRaw = targetPx / scale;
    const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200];
    let mm = niceSteps[0];
    for (const step of niceSteps) {
      if (step <= mmRaw) mm = step;
    }
    const barPx = mm * scale;
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
  }, [layer, width, height, showTravels]);

  return <canvas ref={ref} aria-label="Gcode layer preview" />;
}
