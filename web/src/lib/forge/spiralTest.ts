// web/src/lib/forge/spiralTest.ts
// 2D spiral-test grid: a channel-width × pitch sweep of spiral-cut circles with
// engraved per-cell labels. Pure geometry; reuses the Forge spiral generator.
import type { GeneratedPath, Pt } from "./types";
import { spiralFromRegion } from "./spiral";
import { renderLabel, labelWidth } from "./strokeFont";

export interface AxisSpec { min: number; max: number; steps: number; }

/** `steps` values linearly spaced over [min, max] (steps>=1; 1 → [min]). */
export function resolveAxis(a: AxisSpec): number[] {
  const n = Math.max(1, Math.floor(a.steps));
  if (n === 1) return [a.min];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a.min + ((a.max - a.min) * i) / (n - 1));
  return out;
}

/** One closed loop of `segments` points on a circle of diameter `d` at (cx,cy). */
export function circleRegion(cx: number, cy: number, d: number, segments = 96): Pt[][] {
  const r = d / 2;
  const loop: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    loop.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return [loop];
}

/** Per-cell label text: channel width (2 dp) / pitch (3 dp). */
export function formatLabel(channelWidthMm: number, pitchMm: number): string {
  return `${channelWidthMm.toFixed(2)}/${pitchMm.toFixed(3)}`;
}

export interface SpiralTestConfig {
  channelWidth: AxisSpec;   // X axis (mm)
  pitch: AxisSpec;          // Y axis (mm)
  diameterMm: number;
  side: "outside" | "inside";
  minChannelMm: number;
  gapMm: number;
  bedMm: { w: number; h: number };
  label: { sizeMm: number; show: boolean };
  cut: {
    passes: number; focusInitialMm: number; focusStepMm: number; focusIntervalPasses: number;
    power: number; speed: number; frequency: number; pulseWidth: number; laser: "red" | "blue" | "uv";
  };
  score: { power: number; speed: number; passes: number };
}

export interface CellInfo {
  row: number; col: number;
  channelWidthMm: number; pitchMm: number;
  centerMm: { x: number; y: number };
  cut: Pt[][];        // the cell's arms (open polylines), positioned in mm
  label: Pt[][];      // the cell's label strokes, positioned in mm
  labelText: string;
  warnings: string[];
}

export interface SpiralTestResult {
  cells: CellInfo[];
  cutPaths: GeneratedPath[];   // one per arm, group "CUT_SPIRAL"
  labelPaths: GeneratedPath[]; // one per cell, group "SCORE_LABEL"
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];
}

const MARGIN_MM = 5; // grid origin offset from (0,0)

export function buildSpiralTest(cfg: SpiralTestConfig): SpiralTestResult {
  const cws = resolveAxis(cfg.channelWidth);
  const pitches = resolveAxis(cfg.pitch);
  const maxCw = Math.max(...cws);
  const r = cfg.diameterMm / 2;
  const labelBand = cfg.label.show ? cfg.label.sizeMm + 1.5 : 0;
  // Uniform cell box: disc + channel ring (max) + label band + gap.
  const cell = cfg.diameterMm + 2 * maxCw + labelBand + cfg.gapMm;

  const cells: CellInfo[] = [];
  const cutPaths: GeneratedPath[] = [];
  const labelPaths: GeneratedPath[] = [];
  const warnSet = new Set<string>();
  let order = 0;

  for (let row = 0; row < pitches.length; row++) {
    for (let col = 0; col < cws.length; col++) {
      const channelWidthMm = cws[col];
      const pitchMm = pitches[row];
      const cx = MARGIN_MM + cell / 2 + col * cell;
      const cy = MARGIN_MM + cell / 2 + row * cell;

      const region = circleRegion(cx, cy, cfg.diameterMm);
      const res = spiralFromRegion(region, {
        channelWidthMm, pitchMm, side: cfg.side, minChannelMm: cfg.minChannelMm,
      });
      res.warnings.forEach((w) => warnSet.add(w));

      for (const arm of res.arms) {
        cutPaths.push({
          sourceObjectId: "spiral-test", generatedClass: "spiral", groupName: "CUT_SPIRAL",
          layerStart: 0, layerEnd: cfg.cut.passes, widthMultiplier: 1, offsetMm: 0,
          sideMode: cfg.side, operationOrder: order++, enabled: true, rings: [arm],
        });
      }

      const labelText = formatLabel(channelWidthMm, pitchMm);
      let labelStrokes: Pt[][] = [];
      if (cfg.label.show) {
        const w = labelWidth(labelText, cfg.label.sizeMm);
        const lx = cx - w / 2;                       // centred under the disc
        const ly = cy + r + maxCw + 1.0;             // just below the widest channel ring
        labelStrokes = renderLabel(labelText, cfg.label.sizeMm, { x: lx, y: ly });
        // One GeneratedPath per label, but `rings` holds ALL the label's stroke
        // segments (a multi-ring compound) — unlike cutPaths, which are strictly
        // one arm per path. The writer emits every ring as one compound dPath, and
        // the strokes are far under the point cap, so no per-arm split is needed.
        labelPaths.push({
          sourceObjectId: "spiral-test", generatedClass: "spiral", groupName: "SCORE_LABEL",
          layerStart: 0, layerEnd: cfg.score.passes, widthMultiplier: 1, offsetMm: 0,
          sideMode: "outside", operationOrder: order++, enabled: true, rings: labelStrokes,
        });
      }

      cells.push({
        row, col, channelWidthMm, pitchMm, centerMm: { x: cx, y: cy },
        cut: res.arms, label: labelStrokes, labelText, warnings: res.warnings,
      });
    }
  }

  const footprintMm = {
    w: 2 * MARGIN_MM + cws.length * cell,
    h: 2 * MARGIN_MM + pitches.length * cell,
  };
  return {
    cells, cutPaths, labelPaths, footprintMm,
    overBed: footprintMm.w > cfg.bedMm.w || footprintMm.h > cfg.bedMm.h,
    warnings: [...warnSet],
  };
}
