/**
 * Relief — inspect strip.
 *
 * Three lightweight read-outs over the smoothed depth map so the user can
 * judge a smoothing profile without eyeballing the wipe alone:
 *
 *   1. a 256-bin luminance HISTOGRAM of the cleaned image (the original is
 *      overlaid faintly when both are present);
 *   2. a small GRADIENT-MAGNITUDE thumbnail (Sobel on luminance) so it's
 *      obvious where edges survived the smooth;
 *   3. a "% pixels changed" stat — fraction of pixels whose luminance moved
 *      by more than one level. Only shown when the two images share
 *      dimensions; otherwise a muted placeholder (preview downscaling can
 *      leave them mismatched, and we never crash on that).
 *
 * Everything is drawn with the 2D canvas API — no new deps. Colours are
 * read from the live theme tokens at paint time so the panel tracks the
 * light / dark toggle.
 */

import { useEffect, useMemo, useRef } from "react";
import { Section } from "../../ui";
import { histogram } from "./stretch";

export interface ReliefInspectProps {
  originalData: ImageData | null;
  cleanedData: ImageData | null;
  /** Active tone-stretch LUT — drawn as a transfer curve over the histogram.
   *  Null/absent (none/clahe modes) → no curve. */
  lut?: Uint8Array | null;
}

/** Rec. 601 luma — cheap and good enough for a grayscale depth map. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Read a CSS custom property off the document root, with a fallback. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/**
 * Fraction (0..1) of pixels whose luminance shifted by more than one level.
 * Returns null when dimensions differ — the caller renders a placeholder.
 */
function percentChanged(a: ImageData, b: ImageData): number | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  const pa = a.data;
  const pb = b.data;
  let changed = 0;
  const n = pa.length / 4;
  for (let i = 0; i < pa.length; i += 4) {
    const la = luma(pa[i], pa[i + 1], pa[i + 2]);
    const lb = luma(pb[i], pb[i + 1], pb[i + 2]);
    if (Math.abs(la - lb) > 1) changed++;
  }
  return n > 0 ? changed / n : 0;
}

export function ReliefInspect({
  originalData,
  cleanedData,
  lut,
}: ReliefInspectProps) {
  const histRef = useRef<HTMLCanvasElement>(null);
  const gradRef = useRef<HTMLCanvasElement>(null);

  const changed = useMemo(() => {
    if (!originalData || !cleanedData) return null;
    return percentChanged(originalData, cleanedData);
  }, [originalData, cleanedData]);

  const empty = !cleanedData && !originalData;

  // ── Histogram paint ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = histRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 240;
    const cssH = 88;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ink = cssVar("--color-ink-subtle", "#8A847E");
    const primary = cssVar("--color-primary", "#B8410E");
    const grid = cssVar("--color-border", "#E8E3DC");

    ctx.clearRect(0, 0, cssW, cssH);

    // Baseline / mid gridlines.
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cssH - 0.5);
    ctx.lineTo(cssW, cssH - 0.5);
    ctx.stroke();

    if (!cleanedData && !originalData) return;

    const cleaned = cleanedData ? histogram(cleanedData) : null;
    const original = originalData ? histogram(originalData) : null;

    // Shared peak so the two overlays are directly comparable, with a
    // small headroom factor so the tallest bar doesn't touch the top.
    let peak = 1;
    for (const h of [cleaned, original]) {
      if (!h) continue;
      for (let i = 0; i < 256; i++) if (h[i] > peak) peak = h[i];
    }
    const scaleY = (cssH - 4) / peak;
    const barW = cssW / 256;

    // Original — faint outline behind.
    if (original) {
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.28;
      for (let i = 0; i < 256; i++) {
        const h = original[i] * scaleY;
        if (h <= 0) continue;
        ctx.fillRect(i * barW, cssH - h, Math.max(0.5, barW), h);
      }
      ctx.globalAlpha = 1;
    }

    // Cleaned — primary, on top.
    if (cleaned) {
      ctx.fillStyle = primary;
      for (let i = 0; i < 256; i++) {
        const h = cleaned[i] * scaleY;
        if (h <= 0) continue;
        ctx.fillRect(i * barW, cssH - h, Math.max(0.5, barW), h);
      }
    }

    // Transfer curve — the active tone-stretch LUT mapped over the histogram.
    // x = input 0→255 across the width; y = output 0 (baseline) → 255 (top).
    if (lut && lut.length === 256) {
      const secondary = cssVar("--color-secondary", "#3A6E7A");
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * cssW;
        const y = cssH - (lut[i] / 255) * cssH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [originalData, cleanedData, lut]);

  // ── Gradient-magnitude thumbnail paint ────────────────────────────
  useEffect(() => {
    const canvas = gradRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!cleanedData) {
      canvas.width = 1;
      canvas.height = 1;
      ctx.clearRect(0, 0, 1, 1);
      return;
    }

    const { width: w, height: h, data: px } = cleanedData;
    canvas.width = w;
    canvas.height = h;

    // Precompute a luminance plane so the Sobel inner loop stays cheap.
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      lum[p] = luma(px[i], px[i + 1], px[i + 2]);
    }

    const out = ctx.createImageData(w, h);
    const op = out.data;
    const at = (x: number, y: number) => lum[y * w + x];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Clamp-to-edge Sobel.
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < w - 1 ? x + 1 : w - 1;
        const ym = y > 0 ? y - 1 : 0;
        const yp = y < h - 1 ? y + 1 : h - 1;

        const tl = at(xm, ym),
          tc = at(x, ym),
          tr = at(xp, ym),
          ml = at(xm, y),
          mr = at(xp, y),
          bl = at(xm, yp),
          bc = at(x, yp),
          br = at(xp, yp);

        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
        // Magnitude, scaled down (Sobel sums can reach ~1020) and clamped.
        const mag = Math.min(255, Math.hypot(gx, gy) * 0.5);

        const o = (y * w + x) * 4;
        op[o] = op[o + 1] = op[o + 2] = mag;
        op[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }, [cleanedData]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── % changed ─────────────────────────────────────────────── */}
      <Section title="Delta" dense titleHint="Pixels whose luminance moved more than one level.">
        {empty ? (
          <p className="text-[12px] text-[color:var(--color-ink-subtle)]">
            Smooth a depth map to see how much changed.
          </p>
        ) : changed === null ? (
          <p className="text-[12px] text-[color:var(--color-ink-subtle)]">
            Pixels changed — unavailable (preview is downscaled).
          </p>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[22px] font-semibold tabular-nums text-[color:var(--color-primary)]">
              {(changed * 100).toFixed(1)}
              <span className="text-[13px] font-normal text-[color:var(--color-ink-muted)]">
                %
              </span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
              pixels changed
            </span>
          </div>
        )}
      </Section>

      {/* ── Histogram ─────────────────────────────────────────────── */}
      <Section
        title="Luminance"
        dense
        titleHint="256-bin histogram — cleaned in colour, original faint behind."
      >
        <canvas
          ref={histRef}
          className="block w-full rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
          style={{ height: 88 }}
          aria-label="Luminance histogram of the cleaned depth map"
        />
        <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          <Legend swatch="var(--color-primary)" label="cleaned" />
          <Legend swatch="var(--color-ink-subtle)" label="original" faint />
          {lut && <Legend swatch="var(--color-secondary)" label="curve" />}
          <span className="ml-auto">0 → 255</span>
        </div>
      </Section>

      {/* ── Gradient thumbnail ────────────────────────────────────── */}
      <Section
        title="Edges"
        dense
        titleHint="Sobel gradient magnitude — bright = surviving edges."
      >
        {cleanedData ? (
          <canvas
            ref={gradRef}
            className="block w-full rounded-[6px] border border-[color:var(--color-border)] bg-black"
            style={{ imageRendering: "auto", maxHeight: 160, objectFit: "contain" }}
            aria-label="Gradient magnitude of the cleaned depth map"
          />
        ) : (
          <p className="text-[12px] text-[color:var(--color-ink-subtle)]">
            No cleaned map yet.
          </p>
        )}
      </Section>
    </div>
  );
}

function Legend({
  swatch,
  label,
  faint,
}: {
  swatch: string;
  label: string;
  faint?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-[1px]"
        style={{ background: swatch, opacity: faint ? 0.4 : 1 }}
      />
      {label}
    </span>
  );
}
