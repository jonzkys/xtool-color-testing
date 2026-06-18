// web/src/lib/forge/spiralTest.ts
// 2D spiral-test grid: a channel-width × pitch sweep of spiral-cut circles with
// engraved per-cell labels. Pure geometry; reuses the Forge spiral generator.
import type { Pt } from "./types";

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
