// web/src/components/forge/SpiralCanvas.tsx
//
// Schematic preview of a spiral cut. The real toolpath is ~20 concentric arms a
// pitch (~0.04mm) apart — at fit-to-part zoom they collapse into a solid band,
// which tells the user nothing. So this draws a *legible schematic*: a handful
// of concentric arms at exaggerated, evenly-spaced offsets on the scrap side,
// revealed outer→inner so the eye reads the spiral winding onto the part. It is
// labelled "schematic" and captioned with the true arm count + pitch.
//
// When neck-splitting is on it mirrors the generator's split (splitLobesAtNecks)
// and tints the split-off DETAIL lobes amber against the pink main lobe, so the
// user can see what will be cut as its own heat-retaining loop before cutting.
//
// Purely presentational: arms are computed here from the cut contour via the
// synchronous clipper offsetter (lib/forge/offset.ts) — no worker/pipeline
// involvement. The literal cut still drives the estimate/debug elsewhere.
import { useEffect, useRef, useState } from "react";
import type { Contour, Pt } from "../../lib/forge/types";
import { offsetRegion, simplifyLoop, buildFillRegion, buildPartRegion, splitLobesAtNecks, unionRegions, subtractRegion, regionComponents } from "../../lib/forge/offset";

const SPIRAL = "#ec4899"; // brand pink — main lobe / matches CLASS_COLOR.spiral
const DETAIL = "#f59e0b"; // amber — split-off detail lobes (CUT_09_SPIRAL_DETAIL)
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
  /** True for a doubled-wall incise target (INTAGLIO): rebuild the solid object
   *  with buildPartRegion to match the generator, instead of the even-odd fill. */
  intaglio: boolean;
  /** Mirror the generator's neck split in the preview (and tint detail lobes). */
  splitNecks: boolean;
  neckThresholdPct: number;
  neckOverlapMm: number;
  width: number;
  height: number;
}

/** One lobe's concentric arms (outermost first, contour last) + its kind. */
interface ArmGroup {
  arms: Pt[][][];
  kind: "main" | "detail";
}

interface Schematic {
  groups: ArmGroup[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** True arm count of the real cut (ceil(channel/pitch)) — for the caption. */
  trueArms: number;
  /** Max arms actually drawn in any lobe (≤ trueArms; fewer if capped/collapsed). */
  shownArms: number;
  /** Number of detail lobes split off (0 when splitting is off / finds no neck). */
  detailLobes: number;
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

/** Build the schematic: per lobe, the contour plus a few offset arms spread
 *  across an exaggerated band (so the concentric structure is visible at any
 *  zoom). When `splitNecks` is on, the region is split into main/detail lobes
 *  first so the preview matches what the generator emits. */
function buildSchematic(
  source: Contour[],
  channelWidthMm: number,
  pitchMm: number,
  side: "outside" | "inside",
  intaglio: boolean,
  splitNecks: boolean,
  neckThresholdPct: number,
  neckOverlapMm: number,
): Schematic | null {
  // Reconstruct the region the SAME way the generator (pipeline.ts) does, so the
  // preview matches the cut: a doubled-wall INTAGLIO target → buildPartRegion (the
  // solid object); a single-walled VECTOR/SVG silhouette → buildFillRegion (the
  // canonical even-odd fill, which keeps the outer outline and is winding-robust).
  const region0 = (intaglio ? buildPartRegion(source) : buildFillRegion(source)).filter((pts) => pts.length >= 3);
  if (region0.length === 0) return null;

  const cb = bboxOf(region0);
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
  const part = region0.map(simp);

  // The schematic shows the REAL arm count (ceil(channel/pitch)) so it reflects
  // the actual cut — N concentric passes hugging the part. Spacing is NOT to
  // scale (the true ~0.04mm pitch would overlap), but kept MODEST so the arms
  // stay a tight ribbon hugging the contour rather than ballooning into a wide
  // halo that merges fine detail. ~0.5% of the part per arm, lightly clamped.
  const trueArms = Math.max(1, Math.ceil(channelWidthMm / Math.max(pitchMm, 1e-6)));
  const drawArms = Math.min(trueArms, ARM_CAP);
  const maxFrac = side === "inside" ? 0.1 : 0.14;
  const bandFrac = Math.min(maxFrac, Math.max(0.04, drawArms * 0.0055));

  // The exaggerated fan width for a lobe, scaled to that LOBE's own size (not the
  // whole part) so a small split-off detail draws a tight ribbon instead of a
  // part-sized balloon. Clamped to the part band so the main never under-fans.
  const lobeBand = (region: Pt[][]): number => {
    const b = bboxOf(region);
    const m = Math.min(b.maxX - b.minX, b.maxY - b.minY);
    return (isFinite(m) && m > 0 ? m : partMin) * bandFrac;
  };

  // Concentric arms for one lobe region: index 0 = contour; the rest fan out (or
  // in) evenly across the lobe's band. Each offset ring is re-simplified — large
  // round-join offsets emit many arc points. Returned outermost-first for draw-on.
  // `exclude` keeps external pieces' arms out of internal pieces' zone so the
  // preview tiles (no pink halo over the amber) — mirrors the generator's keep-out.
  // `inward` reverses the fan direction for holes (which grow inward regardless of
  // the global side). Internal pieces are guaranteed at least MIN_INTERNAL_RINGS so
  // they always read as a spiral (not a single-ring blob).
  const MIN_INTERNAL_RINGS = 3;
  const buildArms = (region: Pt[][], inward: boolean, exclude?: Pt[][]): Pt[][][] => {
    const clip = (rings: Pt[][]) => (exclude && exclude.length ? subtractRegion(rings, exclude) : rings);
    const r = region.map(simp).filter((p) => p.length >= 3);
    if (r.length === 0) return [];
    const lb = lobeBand(r);
    const dir = inward ? -1 : sign; // holes fan inward regardless of global side
    const want = Math.max(drawArms, MIN_INTERNAL_RINGS);
    const c0 = clip(r).map(simp).filter((p) => p.length >= 3);
    const inner: Pt[][][] = [c0.length > 0 ? c0 : r];
    for (let k = 1; k < want; k++) {
      const dist = dir * (k / Math.max(1, want - 1)) * lb;
      const raw = offsetRegion(r, dist);
      if (raw.length === 0) break; // collapsed — stop, draw what fits
      const rings = clip(raw).map(simp).filter((p) => p.length >= 3);
      if (rings.length > 0) inner.push(rings);
    }
    return inner.slice().reverse();
  };

  // Split into lobes (mirroring the generator) when enabled; otherwise one main
  // lobe over the whole region (identical to the un-split preview).
  const lobes = splitNecks
    ? splitLobesAtNecks(part, (neckThresholdPct / 100) * channelWidthMm, neckOverlapMm ?? channelWidthMm)
    : [{ region: part, kind: "main" as const }];

  // Decompose into drawable pieces with an explicit class. The MAIN lobe splits
  // into the largest body's outer (external) + each hole / other component
  // (internal). Neck-split DETAIL lobes are wholly internal.
  type Piece = { region: Pt[][]; cls: "external" | "internal"; inward: boolean };
  const ringAbsArea = (loop: Pt[]): number => {
    let a = 0;
    for (let i = 0, n = loop.length; i < n; i++) { const j = (i + 1) % n; a += loop[i].x * loop[j].y - loop[j].x * loop[i].y; }
    return Math.abs(a) / 2;
  };
  const pieces: Piece[] = [];
  for (const lobe of lobes) {
    if (lobe.kind === "detail") { pieces.push({ region: lobe.region, cls: "internal", inward: false }); continue; }
    const comps = regionComponents(lobe.region); // [outer, ...holes][]
    if (comps.length === 0) { pieces.push({ region: lobe.region, cls: "external", inward: false }); continue; }
    let bi = 0;
    for (let i = 1; i < comps.length; i++) if (ringAbsArea(comps[i][0]) > ringAbsArea(comps[bi][0])) bi = i;
    comps.forEach((comp, i) => {
      if (i === bi) {
        pieces.push({ region: [comp[0]], cls: "external", inward: false }); // largest body's outer solid (holes filled)
        for (let h = 1; h < comp.length; h++) pieces.push({ region: [comp[h]], cls: "internal", inward: true }); // its holes vent inward
      } else {
        pieces.push({ region: [comp[0]], cls: "internal", inward: false }); // separate island
        for (let h = 1; h < comp.length; h++) pieces.push({ region: [comp[h]], cls: "internal", inward: true });
      }
    });
  }

  // Internal pieces' keep-out: external pieces pull back past each internal
  // piece's drawn fan + a gap, so no pink hugs the amber.
  const internalKeepOut = unionRegions(
    pieces.filter((p) => p.cls === "internal").map((p) => offsetRegion(p.region, 2 * lobeBand(p.region))),
  );
  const groups: ArmGroup[] = pieces
    .map((p) => ({
      arms: buildArms(p.region, p.inward, p.cls === "external" ? internalKeepOut : undefined),
      kind: p.cls === "internal" ? ("detail" as const) : ("main" as const),
    }))
    .filter((g) => g.arms.length > 0);
  if (groups.length === 0) return null;

  const allLoops = groups.flatMap((g) => g.arms.flat());
  const shownArms = Math.max(...groups.map((g) => g.arms.length));
  const detailLobes = groups.filter((g) => g.kind === "detail").length;
  return { groups, bbox: bboxOf(allLoops), trueArms, shownArms, detailLobes };
}

export function SpiralCanvas({ source, channelWidthMm, pitchMm, side, intaglio, splitNecks, neckThresholdPct, neckOverlapMm, width, height }: SpiralCanvasProps) {
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
      () => setSchematic(buildSchematic(source, channelWidthMm, pitchMm, side, intaglio, splitNecks, neckThresholdPct, neckOverlapMm)),
      110,
    );
    return () => clearTimeout(t);
  }, [source, channelWidthMm, pitchMm, side, intaglio, splitNecks, neckThresholdPct, neckOverlapMm]);

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
    // the same light weight, no depth emphasis, no fill. The innermost loop of
    // each lobe is its contour (the actual edge), given a touch more presence.
    // Detail lobes (split off at necks) are tinted amber against the pink main.
    const hair = Math.max(0.5, 1 / dpr);
    for (const group of schematic.groups) {
      const color = group.kind === "detail" ? DETAIL : SPIRAL;
      const arms = group.arms; // outermost..contour
      for (let k = 0; k < arms.length; k++) {
        const isContour = k === arms.length - 1;
        ctx.globalAlpha = isContour ? 0.85 : 0.55;
        ctx.strokeStyle = color;
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
      // A small entry dot on each lobe's outermost arm — where its spiral begins.
      const o = arms[0]?.[0];
      if (o && o.length > 0) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X(o[0].x), Y(o[0].y), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }, [schematic, width, height]);

  const trueArms = schematic?.trueArms ?? 0;
  const shownArms = schematic?.shownArms ?? 0;
  const detailLobes = schematic?.detailLobes ?? 0;
  const pitchTxt = pitchMm >= 0.01 ? pitchMm.toFixed(2) : pitchMm.toPrecision(1);
  const capped = schematic ? shownArms < trueArms : false;
  const armsTxt = capped ? `~${trueArms} arms (showing ${shownArms})` : `${trueArms} arm${trueArms === 1 ? "" : "s"}`;
  const splitTxt = detailLobes > 0 ? ` · ${detailLobes} split off` : "";

  return (
    <div className="relative h-full w-full">
      <canvas ref={ref} style={{ width, height }} className="block rounded bg-[var(--color-surface)]" />
      {/* schematic caption — mono, lower-left, blueprint register */}
      <div className="pointer-events-none absolute left-3 bottom-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-subtle)]">
        <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: SPIRAL }} aria-hidden />
        {detailLobes > 0 && (
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: DETAIL }} aria-hidden />
        )}
        <span>schematic · not to scale</span>
        {schematic && (
          <span className="tracking-[0.06em] normal-case text-[var(--color-ink-muted)]">
            · {armsTxt} · {pitchTxt} mm pitch · {side}{splitTxt}
          </span>
        )}
      </div>
      <span className="sr-only">
        Schematic spiral-cut preview: {armsTxt} at {pitchTxt} mm pitch on the {side} of the part, spacing exaggerated for legibility.{detailLobes > 0 ? ` ${detailLobes} detail ${detailLobes === 1 ? "lobe" : "lobes"} split off at necks, shown in amber.` : ""}
      </span>
    </div>
  );
}
