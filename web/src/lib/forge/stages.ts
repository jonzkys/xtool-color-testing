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
  sampleLoopWithNormals,
  outwardNormalAt,
} from "./offset";
import { detectCorners } from "./contour";
import { STAGE_GROUPS } from "./config";
import { detectNearGaps, buildSlotRect, slotInScrap } from "./nearGap";

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
      groupName: STAGE_GROUPS.seed,
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

/** Stage 2 — perforate / relief. Scrap-side pockets or slots at edges, corners,
 *  and near-gaps (scrap necks), over ALL loops of the part region. */
export function generatePerforationPaths(
  part: Pt[][],
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.perforate.enabled) return [];
  const beam = cfg.beamWidthMm;
  const half = cfg.perforate.pocketSizeMm / 2;
  const biasDist = cfg.perforate.outsideBias ? cfg.perforate.pocketSizeMm : 0;
  const useSlot = cfg.perforate.shape === "slot";

  // anchors: edge + corner over EVERY loop, plus near-gap necks.
  type Anchor = { pt: Pt; dirX: number; dirY: number; kind: "edge" | "gap" };
  const anchors: Anchor[] = [];
  for (const loop of part) {
    if (loop.length < 3) continue;
    for (const a of sampleLoopWithNormals(loop, cfg.perforate.spacingMm)) {
      anchors.push({ pt: a.pt, dirX: a.nx, dirY: a.ny, kind: "edge" });
    }
    if (cfg.perforate.cornerBoost) {
      for (const idx of detectCorners({ points: loop, closed: true }, cfg.perforate.cornerAngleThresholdDeg)) {
        const norm = outwardNormalAt(loop, idx);
        anchors.push({ pt: loop[idx], dirX: norm.nx, dirY: norm.ny, kind: "edge" });
      }
    }
  }
  if (cfg.perforate.nearGap) {
    for (const g of detectNearGaps(part, cfg.perforate.gapThresholdMm)) {
      anchors.push({ pt: g.pt, dirX: g.dirX, dirY: g.dirY, kind: "gap" });
    }
  }

  const out: GeneratedPath[] = [];
  let order = 0;
  for (const a of anchors) {
    let rings: Pt[][] | null = null;
    if (useSlot) {
      // Edge slots start AT the kerf (½ a beam onto the scrap side — enough to
      // clear the part for the guard) and extend OUTWARD, so they overlap the
      // main/widen cut band and connect the choking kerf to open scrap. Gap slots
      // are centred on the neck midpoint (the detector already placed it in scrap).
      const innerOffset = beam / 2;
      let len = cfg.perforate.slotLengthMm;
      while (len >= beam) {
        const off = a.kind === "edge" ? innerOffset + len / 2 : 0;
        const center = { x: a.pt.x + a.dirX * off, y: a.pt.y + a.dirY * off };
        const rect = buildSlotRect(center, a.dirX, a.dirY, len, beam);
        if (slotInScrap(rect, center, a.dirX, a.dirY, len, part)) { rings = [rect]; break; }
        len /= 2;
      }
    } else {
      const cx = a.pt.x + a.dirX * biasDist;
      const cy = a.pt.y + a.dirY * biasDist;
      rings = [[
        { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
      ]];
    }
    if (!rings) continue;
    out.push({
      sourceObjectId,
      generatedClass: "perforate",
      groupName: STAGE_GROUPS.perforate,
      layerStart: 0,
      layerEnd: 0,
      widthMultiplier: 1,
      offsetMm: biasDist,
      sideMode: cfg.perforate.outsideBias ? "outside" : cfg.sideMode,
      operationOrder: order++,
      enabled: true,
      rings,
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
      groupName: STAGE_GROUPS.clean,
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
