/**
 * Before/after split-compare for the Relief depth-map smoother.
 *
 * Loads the ORIGINAL and CLEANED depth maps and renders them into a
 * single canvas with a draggable vertical wipe handle: everything left
 * of the handle shows the original, everything right shows the cleaned
 * result. Both images are contain-fit + centred into the host's CSS
 * box, and the backing store is upscaled by ``devicePixelRatio`` so the
 * depth-map gradients stay crisp on retina displays (mirrors the dpr
 * handling in ``GcodeCanvas``).
 *
 * The component is deliberately self-contained — it owns nothing but
 * the two image URLs and its own split position. The page orchestrates
 * everything upstream.
 */

import { useEffect, useRef, useState } from "react";

export interface ReliefCompare2DProps {
  originalUrl: string | null;
  cleanedUrl: string | null;
  /** Host box in CSS px, fed from the page's ResizeObserver. */
  width: number;
  height: number;
}

/** Load an image URL into a decoded ``HTMLImageElement`` (or null). */
function useLoadedImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    let cancelled = false;
    const el = new Image();
    el.onload = () => {
      if (!cancelled) setImg(el);
    };
    el.onerror = () => {
      if (!cancelled) setImg(null);
    };
    el.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return img;
}

interface FitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Contain-fit ``src`` (w×h) into a ``cw × ch`` box, centred, with pad. */
function containFit(
  srcW: number,
  srcH: number,
  cw: number,
  ch: number,
  pad: number,
): FitRect | null {
  if (srcW <= 0 || srcH <= 0 || cw <= 0 || ch <= 0) return null;
  const availW = Math.max(1, cw - pad * 2);
  const availH = Math.max(1, ch - pad * 2);
  const scale = Math.min(availW / srcW, availH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

const PAD = 14;

export function ReliefCompare2D({
  originalUrl,
  cleanedUrl,
  width,
  height,
}: ReliefCompare2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const original = useLoadedImage(originalUrl);
  const cleaned = useLoadedImage(cleanedUrl);

  // Split position as a fraction (0..1) of the host width. The handle
  // is dragged in CSS-px space and clamped a little off each edge so a
  // sliver of both sides always stays visible.
  const [split, setSplit] = useState(0.5);
  const draggingRef = useRef(false);

  const empty = !original && !cleaned;

  // ── Paint pass ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear to transparent so removed-background (alpha 0) regions — and the
    // padding margins — reveal the checkerboard backdrop behind the canvas.
    ctx.clearRect(0, 0, width, height);

    if (empty || width <= 0 || height <= 0) return;

    // Fit both halves to the SAME rect so the wipe lines up pixel-for-
    // pixel. Prefer the cleaned image's intrinsic size; fall back to the
    // original (they share dimensions in practice, but be defensive).
    const ref = cleaned ?? original;
    if (!ref) return;
    const fit = containFit(ref.naturalWidth, ref.naturalHeight, width, height, PAD);
    if (!fit) return;

    const splitX = width * split;

    // Left half: ORIGINAL, clipped to [0, splitX].
    if (original) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, height);
      ctx.clip();
      ctx.drawImage(original, fit.x, fit.y, fit.w, fit.h);
      ctx.restore();
    }

    // Right half: CLEANED, clipped to [splitX, width].
    if (cleaned) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, width - splitX, height);
      ctx.clip();
      ctx.drawImage(cleaned, fit.x, fit.y, fit.w, fit.h);
      ctx.restore();
    }

    // Image footprint frame.
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.strokeRect(fit.x + 0.5, fit.y + 0.5, fit.w - 1, fit.h - 1);

    // ── Wipe handle ─────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(232,90,31,0.95)"; // --color-primary (dark)
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, height);
    ctx.stroke();

    // Grip knob.
    const knobR = 13;
    const knobY = height / 2;
    ctx.fillStyle = "rgba(232,90,31,0.95)";
    ctx.beginPath();
    ctx.arc(splitX, knobY, knobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(splitX - 4, knobY - 4);
    ctx.lineTo(splitX - 7, knobY);
    ctx.lineTo(splitX - 4, knobY + 4);
    ctx.moveTo(splitX + 4, knobY - 4);
    ctx.lineTo(splitX + 7, knobY);
    ctx.lineTo(splitX + 4, knobY + 4);
    ctx.stroke();

    // ── Labels ──────────────────────────────────────────────────────
    ctx.font =
      "10px ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    if (original) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.textAlign = "left";
      ctx.fillText("ORIGINAL", fit.x + 6, fit.y + 6);
    }
    if (cleaned) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.textAlign = "right";
      ctx.fillText("CLEANED", fit.x + fit.w - 6, fit.y + 6);
    }
    ctx.textAlign = "left";
  }, [original, cleaned, width, height, split, empty]);

  // ── Drag handling ─────────────────────────────────────────────────
  const updateSplitFromClientX = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    setSplit(Math.min(0.98, Math.max(0.02, frac)));
  };

  useEffect(() => {
    if (empty) return;
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      updateSplitFromClientX(e.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- width read inside handler
  }, [empty, width]);

  if (empty) {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded-[8px] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]"
        style={{ minHeight: 200 }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">
            No depth map
          </span>
          <span className="max-w-[260px] text-[12px] text-[color:var(--color-ink-muted)]">
            Upload a grayscale depth map to compare the raw input against
            the smoothed result.
          </span>
        </div>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="Relief before/after comparison"
      className="block rounded-[8px] touch-none select-none cursor-ew-resize"
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        updateSplitFromClientX(e.clientX);
      }}
    />
  );
}
