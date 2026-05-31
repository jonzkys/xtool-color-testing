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
// Every generated pass operates on the reconstructed PART REGION (a polygon with
// holes). A band is the scrap-side ring set Difference(Inflate(part,±w), part):
// the part body is a hole in every band (even-odd / non-zero), so only the kerf
// sliver is engraved (the part body stays a hole). One whole-part band per stage keeps the cloned display
// transform/bbox correct. Perforation pockets are the exception — single solid
// loops walked along the part's outer silhouette.
//
import type { ForgeConfig, GeneratedPath, Pt, SideMode } from "./types";
import {
  bandFromRegion,
  partOuterLoop,
  sampleLoopWithNormals,
  outwardNormalAt,
} from "./offset";
import { detectCorners } from "./contour";

/** Stage 1 — seed. Shallow scrap-side conditioning band, one operation. */
export function generateSeedPaths(
  part: Pt[][],
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.seed.enabled) return [];
  const side: SideMode = cfg.seed.outsideOnly ? "outside" : cfg.sideMode;
  const widthMm = cfg.seed.widthMultiplier * cfg.beamWidthMm;
  const rings = bandFromRegion(part, widthMm, side);
  // Drop a degenerate band (collapsed / single-ring) rather than emitting a
  // flood fill or an empty-ring phantom display — same guard as the clean stage.
  if (rings.length < 2) return [];
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
  part: Pt[][],
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.perforate.enabled) return [];
  const outerLoop = partOuterLoop(part);
  if (outerLoop.length < 3) return [];

  // Anchors along the part silhouette, each with its OUTWARD normal so pockets
  // can be pushed onto the scrap side regardless of edge orientation.
  const anchors = sampleLoopWithNormals(outerLoop, cfg.perforate.spacingMm);

  // extra anchors at sharp corners (high heat-accumulation spots)
  if (cfg.perforate.cornerBoost) {
    for (const idx of detectCorners({ points: outerLoop, closed: true }, cfg.perforate.cornerAngleThresholdDeg)) {
      const norm = outwardNormalAt(outerLoop, idx);
      anchors.push({ pt: outerLoop[idx], nx: norm.nx, ny: norm.ny });
    }
  }

  const half = cfg.perforate.pocketSizeMm / 2;
  // Push the pocket centre one pocket-width onto the scrap side so the whole
  // pocket clears the part edge (its inner edge lands ~half a pocket out).
  const biasDist = cfg.perforate.outsideBias ? cfg.perforate.pocketSizeMm : 0;
  const out: GeneratedPath[] = [];
  let order = 0;
  for (const a of anchors) {
    const cx = a.pt.x + a.nx * biasDist;
    const cy = a.pt.y + a.ny * biasDist;
    const square: Pt[] = [
      { x: cx - half, y: cy - half },
      { x: cx + half, y: cy - half },
      { x: cx + half, y: cy + half },
      { x: cx - half, y: cy + half },
    ];
    out.push({
      sourceObjectId,
      generatedClass: "perforate",
      groupName: "CUT_02_PERFORATE",
      layerStart: 0,
      layerEnd: 0,
      widthMultiplier: 1,
      offsetMm: biasDist,
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
  part: Pt[][],
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  const out: GeneratedPath[] = [];
  let order = 0;
  const side: SideMode = cfg.deepen.outsideOnly ? "outside" : cfg.sideMode;

  for (const group of cfg.deepen.groups) {
    if (!group.enabled) continue;
    const widthMm = group.widthMultiplier * cfg.beamWidthMm;
    const rings = bandFromRegion(part, widthMm, side);
    // Skip a degenerate band (collapsed inward offset, or width ≤ 0) so it never
    // becomes a single-ring flood fill or an empty-ring phantom display.
    if (rings.length < 2) continue;
    out.push({
      sourceObjectId,
      generatedClass: "deepen",
      groupName: group.name,
      layerStart: 0,
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
  part: Pt[][],
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
    const rings = bandFromRegion(part, wallWidth, side);
    // Skip a degenerate wall (e.g. an inner band that collapsed on a tiny part)
    // rather than emitting a single-loop flood fill.
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
