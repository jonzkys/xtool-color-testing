// web/src/lib/forge/stages.ts
//
// Stage generators. Each path class has a distinct PURPOSE:
//   seed      — improves initial coupling by roughening/darkening the future
//               kerf (surface conditioning only; NOT a deep cut).
//   perforate — creates distributed starter/ejection points so melt, vapour and
//               debris can escape; denser near corners/high curvature.
//   deepen    — builds depth via PROGRESSIVE WIDENING of the scrap-side band,
//               not by repeating one line; depth itself is a per-layer param.
//   clean     — removes recast/oxide from the trench WALLS without trying to
//               force more depth (a separate path class, not another deepen).
//
// Every generated pass is an incise (INTAGLIO) sliver-band: a compound path of
// concentric closed loops emitted even-odd so the fill lands only in the kerf.
// Perforation pockets are the exception — single solid loops (a starter pocket
// is meant to be filled solid).
//
import type { Contour, ForgeConfig, GeneratedPath, Pt, SideMode } from "./types";
import { generateBand } from "./offset";
import {
  detectCorners,
  inferWindingAndOutside,
  normaliseContour,
  resampleByArcLength,
} from "./contour";

/** Stage 1 — seed. Shallow scrap-side conditioning band, one operation. */
export function generateSeedPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.seed.enabled) return [];
  const side: SideMode = cfg.seed.outsideOnly ? "outside" : cfg.sideMode;
  const widthMm = cfg.seed.widthMultiplier * cfg.beamWidthMm;
  const rings = generateBand(contour, widthMm, side);
  return [
    {
      sourceObjectId,
      generatedClass: "seed",
      groupName: "CUT_01_SEED",
      layerStart: 0,
      layerEnd: cfg.seed.layerCount, // informational; depth is tuned per-layer
      widthMultiplier: cfg.seed.widthMultiplier,
      offsetMm: widthMm,
      sideMode: side,
      operationOrder: 0,
      enabled: true,
      rings,
    },
  ];
}

/** Stage 2 — perforate. Tiny solid scrap-side pockets at intervals + corners. */
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
    // Bias the pocket centre to the scrap side by pocketSizeMm along the
    // outward normal estimate (the same simple nudge the old code used).
    const biasMm = cfg.perforate.outsideBias ? cfg.perforate.pocketSizeMm * outSign : 0;
    const cy = a.y + biasMm;
    const square: Pt[] = [
      { x: a.x - half, y: cy - half },
      { x: a.x + half, y: cy - half },
      { x: a.x + half, y: cy + half },
      { x: a.x - half, y: cy + half },
    ];
    out.push({
      sourceObjectId,
      generatedClass: "perforate",
      groupName: "CUT_02_PERFORATE",
      layerStart: 0,
      layerEnd: 0,
      widthMultiplier: 1,
      offsetMm: biasMm,
      sideMode: cfg.perforate.outsideBias ? "outside" : cfg.sideMode,
      operationOrder: order++,
      enabled: true,
      rings: [square],
    });
  }
  return out;
}

/** Stage 3 — deepen. One progressively-wider scrap-side band per pass-group. */
export function generateDeepenPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  const out: GeneratedPath[] = [];
  let order = 0;
  const side: SideMode = cfg.deepen.outsideOnly ? "outside" : cfg.sideMode;

  for (const group of cfg.deepen.groups) {
    if (!group.enabled) continue;
    const widthMm = group.widthMultiplier * cfg.beamWidthMm;
    const rings = generateBand(contour, widthMm, side);
    out.push({
      sourceObjectId,
      generatedClass: "deepen",
      groupName: group.name,
      layerStart: group.fromLayer,
      layerEnd: group.toLayer,
      widthMultiplier: group.widthMultiplier,
      offsetMm: widthMm,
      sideMode: side,
      operationOrder: order++,
      enabled: true,
      rings,
    });
  }
  return out;
}

/** Stage 4 — clean. Thin wall band(s) one beam-width wide, low-energy placeholder. */
export function generateCleanPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.clean.enabled) return [];
  const wallWidth = cfg.beamWidthMm; // thin wall band one beam-width wide

  // offsetSelection picks which wall(s) to follow: outer → outside band,
  // inner → inside band, walls → both (two separate GeneratedPaths).
  const sides: SideMode[] =
    cfg.clean.offsetSelection === "outer"
      ? ["outside"]
      : cfg.clean.offsetSelection === "inner"
        ? ["inside"]
        : ["outside", "inside"];

  const out: GeneratedPath[] = [];
  let order = 0;
  for (const side of sides) {
    const rings = generateBand(contour, wallWidth, side);
    // Skip a degenerate wall (e.g. an inner band that collapsed to one loop on
    // a tiny contour) rather than emitting a single-loop flood fill.
    if (rings.length < 2) continue;
    out.push({
      sourceObjectId,
      generatedClass: "clean",
      groupName: "CUT_07_CLEAN",
      layerStart: 0,
      layerEnd: 0,
      widthMultiplier: 1,
      offsetMm: wallWidth,
      sideMode: side,
      operationOrder: order++,
      enabled: true,
      rings,
    });
  }
  return out;
}
