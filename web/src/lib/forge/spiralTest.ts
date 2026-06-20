// web/src/lib/forge/spiralTest.ts
// 2D spiral-test grid with selectable X/Y axis parameters. Each cell's spiral is
// generated and cut with that cell's (x-param, y-param) values; every other
// sweepable param stays fixed. Geometry params (channel width, pitch) shape the
// spiral; profile params (speed/passes/power/frequency/pulse width/focus step/
// focus interval) only change the VECTOR_CUTTING settings. Profiles are deduped
// into CUT_<n> groups so a geometry-only sweep stays one profile. Pure geometry.
import type { GeneratedPath, Pt, StageParams } from "./types";
import { spiralFromRegion } from "./spiral";
import { renderText, textWidth } from "./textPaths";
import { PARAMS, PARAM_ORDER, PROFILE_KEYS, formatValue, type AxisSpec, type ParamKey } from "./spiralParams";
import { clampParam, resolveAxisValues } from "./spiralLimits";
import type { ValidationProfile } from "../../types";
import { shapeRegion, type CellShape } from "./spiralShapes";

export type { AxisSpec, ParamKey } from "./spiralParams";
export { resolveAxis } from "./spiralParams";

export { circleRegion } from "./spiralShapes";
export type { CellShape } from "./spiralShapes";

export interface SpiralTestConfig {
  xParam: ParamKey;
  yParam: ParamKey;                  // must differ from xParam
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  fixed: Record<ParamKey, number>;   // value used when a param is OFF-axis
  diameterMm: number;
  cellShape?: CellShape;             // cut-out shape (default "circle")
  side: "outside" | "inside";
  minChannelMm: number;
  gapMm: number;
  bedMm: { w: number; h: number };
  focusInitialMm: number;            // fixed initial focus drop (not sweepable)
  laser: "red" | "blue" | "uv";      // cut laser (fixed)
  labels: { show: boolean; titlePrefix: string };
  /** Label engrave op (a FILL_VECTOR_ENGRAVING pass over the real-font glyphs). */
  score: {
    laser: "red" | "blue" | "uv"; power: number; speed: number; passes: number;
    linesPerCm: number; scanMode: "bidirectional" | "unidirectional";
    pulseWidth: number; frequency: number;
  };
}

export interface CellInfo {
  row: number; col: number;
  xValue: number; yValue: number;
  centerMm: { x: number; y: number };
  cut: Pt[][];        // the cell's arms (open polylines), positioned in mm
  groupName: string;  // the CUT_<n> profile group this cell belongs to
  warnings: string[];
}

/** One engraved string (title or an axis value) as filled outline rings. */
export interface LabelOutline { text: string; rings: Pt[][]; }

export interface SpiralTestResult {
  cells: CellInfo[];
  cutPaths: GeneratedPath[];                  // one per arm, groupName = CUT_<n>
  stageParams: Record<string, StageParams>;   // keyed by groupName
  labelOutlines: LabelOutline[];
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];
}

const MARGIN_MM = 5;     // outer page margin
const PAD_MM = 1.2;      // padding between grid and axis labels / title

/** The auto title: optional prefix + the two axis param names + a fixed-param
 *  summary (only the params NOT on an axis; always D + initial drop). */
export function composeTitle(cfg: SpiralTestConfig): string {
  const axisPart = `X:${PARAMS[cfg.xParam].label}  Y:${PARAMS[cfg.yParam].label}`;
  const offAxis = PARAM_ORDER.filter((k) => k !== cfg.xParam && k !== cfg.yParam);
  const fixedPart = [
    `D:${cfg.diameterMm}`, `ID:${cfg.focusInitialMm}`,
    ...offAxis.map((k) => `${PARAMS[k].abbrev}:${formatValue(k, cfg.fixed[k])}`),
  ].join(" ");
  const body = `${axisPart}   ${fixedPart}`;
  const pre = cfg.labels.titlePrefix.trim();
  return pre ? `${pre}  ${body}` : body;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Bbox of a set of rings; null if empty. */
export function ringsBBox(rings: Pt[][]): { minX: number; minY: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return null;
  return { minX: x0, minY: y0, w: x1 - x0, h: y1 - y0 };
}

/** Stable dedup key over the profile-param subset of a resolved cell map. */
function profileKeyOf(map: Record<ParamKey, number>): string {
  return PROFILE_KEYS.map((k) => `${k}:${map[k]}`).join("|");
}

/** Build a VECTOR_CUTTING StageParams from a cell's resolved param map. */
function stageParamsOf(map: Record<ParamKey, number>, cfg: SpiralTestConfig): StageParams {
  return {
    power: map.power, speed: map.speed, passes: map.passes,
    pulseWidth: map.pulseWidth, frequency: map.frequency, laser: cfg.laser,
    cuttingDrop: true, sinkingMethod: "step",
    firstCuttingDropValue: cfg.focusInitialMm, cuttingDropValue: cfg.focusInitialMm,
    descentIntervalDescent: map.focusInterval, descentPerStep: map.focusStep,
  };
}

export function buildSpiralTest(cfg: SpiralTestConfig, profile: ValidationProfile | null = null): SpiralTestResult {
  const xVals = resolveAxisValues(profile, cfg.xParam, cfg.xAxis);
  const yVals = resolveAxisValues(profile, cfg.yParam, cfg.yAxis);
  const show = cfg.labels.show;

  // Channel-width values present anywhere in the grid → max for a uniform cell.
  const channelValues =
    cfg.xParam === "channelWidth" ? xVals
    : cfg.yParam === "channelWidth" ? yVals
    : [cfg.fixed.channelWidth];
  const maxCw = Math.max(...channelValues);

  const cell = cfg.diameterMm + 2 * maxCw + cfg.gapMm;

  const axisTextMm = show ? clamp(cell * 0.22, 1.2, 4) : 0;
  const gridW = xVals.length * cell;
  const gridH = yVals.length * cell;
  const title = composeTitle(cfg);
  const titleTextMm = show ? Math.min(axisTextMm * 1.4, gridW / Math.max(1, textWidth(title, 1))) : 0;

  // Measure the title's true vertical extent so the top band reserves real glyph
  // height (ascent + descent), not just the em.
  const titleProbe = show ? renderText(title, titleTextMm, { x: 0, y: 0 }) : [];
  const titleProbeBox = ringsBBox(titleProbe);
  const titleH = titleProbeBox ? titleProbeBox.h : 0;

  // Left margin holds the Y values (at the Y param's precision); top band the title.
  const yLabelW = show ? Math.max(...yVals.map((v) => textWidth(formatValue(cfg.yParam, v), axisTextMm))) : 0;
  const leftMargin = show ? yLabelW + PAD_MM : 0;
  const topBand = show ? titleH + PAD_MM * 2 : 0;
  const bottomMargin = show ? axisTextMm + PAD_MM * 2 : 0;

  const gridX0 = MARGIN_MM + leftMargin;
  const gridY0 = MARGIN_MM + topBand;

  const cells: CellInfo[] = [];
  const cutPaths: GeneratedPath[] = [];
  const labelOutlines: LabelOutline[] = [];
  const warnSet = new Set<string>();
  const stageParams: Record<string, StageParams> = {};
  const groupByKey = new Map<string, string>(); // profileKey → groupName
  let order = 0;

  for (let row = 0; row < yVals.length; row++) {
    for (let col = 0; col < xVals.length; col++) {
      const paramMap = Object.fromEntries(
        PARAM_ORDER.map((k) => [k, clampParam(profile, k, cfg.fixed[k])]),
      ) as Record<ParamKey, number>;
      paramMap[cfg.xParam] = xVals[col];
      paramMap[cfg.yParam] = yVals[row];
      const cx = gridX0 + cell / 2 + col * cell;
      const cy = gridY0 + cell / 2 + row * cell;

      const region = shapeRegion(cfg.cellShape ?? "circle", cx, cy, cfg.diameterMm);
      const res = spiralFromRegion(region, {
        channelWidthMm: paramMap.channelWidth, pitchMm: paramMap.pitch,
        side: cfg.side, minChannelMm: cfg.minChannelMm,
      });
      res.warnings.forEach((w) => warnSet.add(w));

      // Resolve (dedup) this cell's cut profile to a CUT_<n> group.
      const pk = profileKeyOf(paramMap);
      let groupName = groupByKey.get(pk);
      if (groupName === undefined) {
        groupName = `CUT_${groupByKey.size}`;
        groupByKey.set(pk, groupName);
        stageParams[groupName] = stageParamsOf(paramMap, cfg);
      }

      for (const arm of res.arms) {
        cutPaths.push({
          sourceObjectId: "spiral-test", generatedClass: "spiral", groupName,
          layerStart: 0, layerEnd: paramMap.passes, widthMultiplier: 1, offsetMm: 0,
          sideMode: cfg.side, operationOrder: order++, enabled: true, rings: [arm],
        });
      }
      cells.push({ row, col, xValue: xVals[col], yValue: yVals[row], centerMm: { x: cx, y: cy }, cut: res.arms, groupName, warnings: res.warnings });
    }
  }

  if (show) {
    // Title — centred over the grid; baseline from the measured ascent.
    const titleBaselineY = MARGIN_MM + (titleProbeBox ? -titleProbeBox.minY : titleTextMm);
    const titleW = textWidth(title, titleTextMm);
    const titleX = gridX0 + Math.max(0, (gridW - titleW) / 2);
    labelOutlines.push({ text: title, rings: renderText(title, titleTextMm, { x: titleX, y: titleBaselineY }) });

    // X axis — value centred under each column, at the X param's precision.
    const xBaselineY = gridY0 + gridH + PAD_MM + axisTextMm;
    for (let col = 0; col < xVals.length; col++) {
      const t = formatValue(cfg.xParam, xVals[col]);
      const w = textWidth(t, axisTextMm);
      const colCx = gridX0 + cell / 2 + col * cell;
      labelOutlines.push({ text: t, rings: renderText(t, axisTextMm, { x: colCx - w / 2, y: xBaselineY }) });
    }

    // Y axis — value right-aligned in the left margin, centred on the row.
    for (let row = 0; row < yVals.length; row++) {
      const t = formatValue(cfg.yParam, yVals[row]);
      const w = textWidth(t, axisTextMm);
      const rowCy = gridY0 + cell / 2 + row * cell;
      labelOutlines.push({ text: t, rings: renderText(t, axisTextMm, { x: gridX0 - PAD_MM - w, y: rowCy + axisTextMm * 0.35 }) });
    }
  }

  const allLabelRings = labelOutlines.flatMap((l) => l.rings);
  const labelBox = ringsBBox(allLabelRings);
  const cutBox = ringsBBox(cutPaths.flatMap((p) => p.rings));
  const right = Math.max(gridX0 + gridW, labelBox ? labelBox.minX + labelBox.w : 0, cutBox ? cutBox.minX + cutBox.w : 0);
  const bottom = Math.max(gridY0 + gridH + bottomMargin, labelBox ? labelBox.minY + labelBox.h : 0);
  const footprintMm = { w: right + MARGIN_MM, h: bottom + MARGIN_MM };

  return {
    cells, cutPaths, stageParams, labelOutlines, footprintMm,
    overBed: footprintMm.w > cfg.bedMm.w || footprintMm.h > cfg.bedMm.h,
    warnings: [...warnSet],
  };
}
