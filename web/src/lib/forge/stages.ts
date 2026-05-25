// web/src/lib/forge/stages.ts
//
// Stage generators. Each path class has a distinct PURPOSE:
//   seed      — improves initial coupling by roughening/darkening the future
//               kerf (surface conditioning only; NOT a deep cut).
//   perforate — creates distributed starter/ejection points so melt, vapour and
//               debris can escape; denser near corners/high curvature.
//   deepen    — builds depth via PROGRESSIVE WIDENING + thermal interlacing,
//               not by repeating one line; widening is scrap-side biased.
//   clean     — removes recast/oxide from the trench WALLS without trying to
//               force more depth (a separate path class, not another deepen).
//
import type { Contour, ForgeConfig, GeneratedPath, Pt, SideMode } from "./types";
import { generateOffsetStack, offsetContour } from "./offset";
import {
  detectCorners,
  inferWindingAndOutside,
  normaliseContour,
  resampleByArcLength,
  segmentContour,
} from "./contour";
import { orderSegmentsInterlaced } from "./schedule";

const SEED_MAX_LAYERS = 5;

function ring(
  contour: Contour,
  meta: Omit<GeneratedPath, "points" | "closed">,
): GeneratedPath {
  return { ...meta, points: contour.points, closed: contour.closed };
}

/** Stage 1 — seed. Shallow scrap-side conditioning track, ≤5 layers. */
export function generateSeedPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.seed.enabled) return [];
  const side: SideMode = cfg.seed.outsideOnly ? "outside" : cfg.sideMode;
  const stack = generateOffsetStack(contour, cfg.seed.widthMultiplier, cfg.beamWidthMm, side);
  const layers = Math.min(SEED_MAX_LAYERS, Math.max(1, cfg.seed.layerCount));
  const out: GeneratedPath[] = [];
  let order = 0;
  for (let layer = 0; layer < layers; layer++) {
    for (const r of stack) {
      out.push(
        ring(r, {
          sourceObjectId,
          generatedClass: "seed",
          groupName: "CUT_01_SEED",
          layerStart: layer,
          layerEnd: layer,
          widthMultiplier: cfg.seed.widthMultiplier,
          offsetMm: 0,
          sideMode: side,
          direction: "forward",
          operationOrder: order++,
          enabled: true,
        }),
      );
    }
  }
  return out;
}

/** Stage 2 — perforate. Tiny scrap-side pockets at intervals + extra at corners. */
export function generatePerforationPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.perforate.enabled) return [];
  const norm = normaliseContour(contour);
  const winding = inferWindingAndOutside(norm);
  const outSign: 1 | -1 = winding.outsideSign;

  // base perforation anchor points spaced along the contour
  const anchors: Pt[] = resampleByArcLength(norm, cfg.perforate.spacingMm);

  // extra anchors at sharp corners
  if (cfg.perforate.cornerBoost) {
    for (const idx of detectCorners(norm, cfg.perforate.cornerAngleThresholdDeg)) {
      anchors.push(norm.points[idx]);
    }
  }

  const half = cfg.perforate.pocketSizeMm / 2;
  const out: GeneratedPath[] = [];
  let order = 0;
  for (const a of anchors) {
    // micro-segment: a short stub crossing the kerf, biased to scrap side.
    // Bias direction approximated by nudging along the outward normal estimate.
    const biasMm = cfg.perforate.outsideBias ? half * outSign : 0;
    const seg: Contour = {
      points: [
        { x: a.x - half, y: a.y + biasMm },
        { x: a.x + half, y: a.y + biasMm },
      ],
      closed: false,
    };
    out.push(
      ring(seg, {
        sourceObjectId,
        generatedClass: "perforate",
        groupName: "CUT_02_PERFORATE",
        layerStart: 0,
        layerEnd: 0,
        widthMultiplier: 1,
        offsetMm: biasMm,
        sideMode: cfg.perforate.outsideBias ? "outside" : cfg.sideMode,
        direction: "forward",
        operationOrder: order++,
        enabled: true,
      }),
    );
  }
  return out;
}

/** Stage 3 — deepen. Progressive widening + interlaced segment ordering. */
export function generateDeepenPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  const out: GeneratedPath[] = [];
  let order = 0;
  const side: SideMode = cfg.deepen.outsideOnly ? "outside" : cfg.sideMode;

  cfg.deepen.groups.forEach((group, gi) => {
    if (!group.enabled) return;
    const stack = generateOffsetStack(contour, group.widthMultiplier, cfg.beamWidthMm, side);

    stack.forEach((ringContour, ri) => {
      if (!cfg.deepen.interlaceEnabled) {
        out.push(
          ring(ringContour, {
            sourceObjectId,
            generatedClass: "deepen",
            groupName: group.name,
            layerStart: group.fromLayer,
            layerEnd: group.toLayer,
            widthMultiplier: group.widthMultiplier,
            offsetMm: ri * cfg.beamWidthMm,
            sideMode: side,
            direction: "forward",
            operationOrder: order++,
            enabled: true,
          }),
        );
        return;
      }
      const segs = segmentContour(ringContour, cfg.deepen.segmentLengthMm);
      const ord = orderSegmentsInterlaced(segs.length, {
        stride: cfg.deepen.interlaceStride,
        reverse: cfg.deepen.reverseAlternatePasses,
        stagger: cfg.deepen.staggerStartPoint,
        pass: gi * stack.length + ri,
      });
      ord.forEach((segIdx) => {
        const seg = segs[segIdx];
        const reversed = cfg.deepen.reverseAlternatePasses && (gi + ri) % 2 === 1;
        const pts = reversed ? [...seg.points].reverse() : seg.points;
        out.push({
          sourceObjectId,
          generatedClass: "deepen",
          groupName: group.name,
          layerStart: group.fromLayer,
          layerEnd: group.toLayer,
          widthMultiplier: group.widthMultiplier,
          offsetMm: ri * cfg.beamWidthMm,
          sideMode: side,
          direction: reversed ? "reverse" : "forward",
          segmentIndex: segIdx,
          operationOrder: order++,
          enabled: true,
          points: pts,
          closed: false,
        });
      });
    });
  });
  return out;
}

/** Stage 4 — clean. Follow trench walls (inner + outer), low-energy placeholder. */
export function generateCleanPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.clean.enabled) return [];
  const winding = inferWindingAndOutside(contour);
  const outSign: 1 | -1 = winding.outsideSign;
  const inSign: 1 | -1 = outSign === 1 ? -1 : 1;
  const wallOffset = cfg.beamWidthMm; // walls one beam-width either side of centreline

  const walls: Array<{ c: Contour; offsetMm: number; side: SideMode }> = [];
  // offsetContour can return [] if a wall pass shrinks a small pocket to
  // nothing — guard against indexing an empty result (would emit an undefined
  // ring and crash the renderer/export).
  if (cfg.clean.offsetSelection !== "inner") {
    const outer = offsetContour(contour, wallOffset, outSign);
    if (outer.length > 0) {
      walls.push({ c: outer[0], offsetMm: wallOffset, side: "outside" });
    }
  }
  if (cfg.clean.offsetSelection !== "outer") {
    const inner = offsetContour(contour, wallOffset, inSign);
    if (inner.length > 0) {
      walls.push({ c: inner[0], offsetMm: wallOffset, side: "inside" });
    }
  }

  const out: GeneratedPath[] = [];
  let order = 0;
  for (let pass = 0; pass < Math.max(1, cfg.clean.passes); pass++) {
    for (const w of walls) {
      out.push(
        ring(w.c, {
          sourceObjectId,
          generatedClass: "clean",
          groupName: "CUT_07_CLEAN",
          layerStart: 0,
          layerEnd: 0,
          widthMultiplier: 1,
          offsetMm: w.offsetMm,
          sideMode: w.side,
          direction: pass % 2 === 1 ? "reverse" : "forward",
          operationOrder: order++,
          enabled: true,
        }),
      );
    }
  }
  return out;
}
