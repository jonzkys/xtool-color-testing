// web/src/components/forge/SpiralCanvas.tsx
//
// Schematic preview of a spiral cut. The real toolpath is ~20 concentric arms a
// pitch (~0.04mm) apart — at fit-to-part zoom they collapse into a solid band,
// which tells the user nothing. So this draws a *legible schematic*: a handful
// of concentric arms at exaggerated, evenly-spaced offsets on the scrap side,
// revealed outer→inner so the eye reads the spiral winding onto the part. It is
// labelled "schematic" and captioned with the true arm count + pitch.
//
// Purely presentational: arms are computed here from the cut contour via the
// synchronous clipper offsetter (lib/forge/offset.ts) — no worker/pipeline
// involvement. The literal cut still drives the estimate/debug elsewhere.
import { useEffect, useRef, useState } from "react";
import type { Contour, Pt } from "../../lib/forge/types";
import { offsetRegion, simplifyLoop } from "../../lib/forge/offset";

const SPIRAL = "#ec4899"; // brand pink — matches CLASS_COLOR.spiral / the legend
// Cap on rendered arms — the schematic shows the *true* arm count
// (ceil(channel/pitch)) so it reflects the real cut, but a pathological tiny
// pitch could ask for hundreds of lines (a blob again), so cap the draw.
const ARM_CAP = 28;

export interface SpiralCanvasProps {
  /** Cut contour in mm space (one entry per subpath). */
  source: Contour[] | null;
  channelWidthMm: number;
  pitchMm: number;
  side: "outside" | "inside";
  width: number;
  height: number;
}

interface Schematic {
  /** Concentric arms, outermost first, innermost (the contour) last. Each arm
   *  is a set of closed loops in mm space. */
  arms: Pt[][][];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** True arm count of the real cut (ceil(channel/pitch)) — for the caption. */
  trueArms: number;
  /** Arms actually drawn (≤ trueArms; fewer if capped or an offset collapsed). */
  shownArms: number;
}

function bboxOf(loops: Pt[][]): Schematic["bbox"] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) for (const p of loop) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** Build the schematic: the contour plus a few offset arms spread across an
 *  exaggerated band (so the concentric structure is visible at any zoom). */
function buildSchematic(
  source: Contour[],
  channelWidthMm: number,
  pitchMm: number,
  side: "outside" | "inside",
): Schematic | null {
  const raw = source.map((c) => c.points).filter((pts) => pts.length >= 3);
  if (raw.length === 0) return null;

  const cb = bboxOf(raw);
  const partMin = Math.min(cb.maxX - cb.minX, cb.maxY - cb.minY) || 1;
  const sign = side === "inside" ? -1 : 1;

  // Schematic is not-to-scale, so decimate the (bezier-flattened, possibly
  // thousands-of-points) contour to a light outline first. Bounds the cost of
  // the per-arm clipper offsets to keep the preview snappy on complex parts.
  const eps = Math.max(0.02, partMin * 0.004);
  const simp = (loop: Pt[]): Pt[] => {
    const s = simplifyLoop(loop, eps);
    return s.length >= 3 ? s : loop;
  };
  const part = raw.map(simp);

  // The schematic shows the REAL arm count (ceil(channel/pitch)) so it reflects
  // the actual cut — N concentric passes hugging the part. Spacing is NOT to
  // scale (the true ~0.04mm pitch would overlap), but kept MODEST so the arms
  // stay a tight ribbon hugging the contour rather than ballooning into a wide
  // halo that merges fine detail. ~0.5% of the part per arm, lightly clamped.
  const trueArms = Math.max(1, Math.ceil(channelWidthMm / Math.max(pitchMm, 1e-6)));
  const drawArms = Math.min(trueArms, ARM_CAP);
  const maxFrac = side === "inside" ? 0.1 : 0.14;
  const band = partMin * Math.min(maxFrac, Math.max(0.04, drawArms * 0.0055));

  // index 0 = contour; the rest fan out (or in) evenly across the band. Each
  // offset ring is re-simplified — large round-join offsets emit many arc points.
  const inner: Pt[][][] = [part];
  for (let k = 1; k < drawArms; k++) {
    const dist = sign * (k / (drawArms - 1)) * band;
    const rings = offsetRegion(part, dist).map(simp);
    if (rings.length === 0) break; // collapsed — stop, draw what fits
    inner.push(rings);
  }
  const arms = inner.slice().reverse(); // outermost first for the draw-on
  return { arms, bbox: bboxOf(arms.flat()), trueArms, shownArms: inner.length };
}

export function SpiralCanvas({ source, channelWidthMm, pitchMm, side, width, height }: SpiralCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [schematic, setSchematic] = useState<Schematic | null>(null);

  // Debounced recompute: the per-arm clipper offsets run ~100-200ms on detailed
  // contours, so recomputing on every slider tick janks. Recompute ~110ms after
  // the last change instead; the canvas just holds the previous frame until then.
  useEffect(() => {
    if (!source) {
      setSchematic(null);
      return;
    }
    const t = setTimeout(
      () => setSchematic(buildSchematic(source, channelWidthMm, pitchMm, side)),
      110,
    );
    return () => clearTimeout(t);
  }, [source, channelWidthMm, pitchMm, side]);

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
    if (!schematic) return;

    const bb = schematic.bbox;
    const pad = 22;
    const w = bb.maxX - bb.minX || 1;
    const h = bb.maxY - bb.minY || 1;
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = pad + (width - 2 * pad - w * scale) / 2 - bb.minX * scale;
    const oy = pad + (height - 2 * pad - h * scale) / 2 - bb.minY * scale;
    const X = (x: number) => x * scale + ox;
    const Y = (y: number) => y * scale + oy;

    ctx.lineJoin = "round";
    // Fine, uniform hairlines — match the machine's toolpath preview: every arm
    // the same light weight, no depth emphasis, no fill. The innermost loop is
    // the part contour (the actual edge), given only a touch more presence.
    const hair = Math.max(0.5, 1 / dpr);
    const arms = schematic.arms; // outermost..contour
    for (let k = 0; k < arms.length; k++) {
      const isContour = k === arms.length - 1;
      ctx.globalAlpha = isContour ? 0.8 : 0.55;
      ctx.strokeStyle = SPIRAL;
      ctx.lineWidth = hair;
      for (const r of arms[k]) {
        if (r.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(X(r[0].x), Y(r[0].y));
        for (let i = 1; i < r.length; i++) ctx.lineTo(X(r[i].x), Y(r[i].y));
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // A small entry dot on the outermost arm — where the spiral begins.
    const o = arms[0]?.[0];
    if (o && o.length > 0) {
      ctx.fillStyle = SPIRAL;
      ctx.beginPath();
      ctx.arc(X(o[0].x), Y(o[0].y), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [schematic, width, height]);

  const trueArms = schematic?.trueArms ?? 0;
  const shownArms = schematic?.shownArms ?? 0;
  const pitchTxt = pitchMm >= 0.01 ? pitchMm.toFixed(2) : pitchMm.toPrecision(1);
  const capped = schematic ? shownArms < trueArms : false;
  const armsTxt = capped ? `~${trueArms} arms (showing ${shownArms})` : `${trueArms} arm${trueArms === 1 ? "" : "s"}`;

  return (
    <div className="relative h-full w-full">
      <canvas ref={ref} style={{ width, height }} className="block rounded bg-[var(--color-surface)]" />
      {/* schematic caption — mono, lower-left, blueprint register */}
      <div className="pointer-events-none absolute left-3 bottom-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-subtle)]">
        <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: SPIRAL }} aria-hidden />
        <span>schematic · not to scale</span>
        {schematic && (
          <span className="tracking-[0.06em] normal-case text-[var(--color-ink-muted)]">
            · {armsTxt} · {pitchTxt} mm pitch · {side}
          </span>
        )}
      </div>
      <span className="sr-only">
        Schematic spiral-cut preview: {armsTxt} at {pitchTxt} mm pitch on the {side} of the part, spacing exaggerated for legibility.
      </span>
    </div>
  );
}
