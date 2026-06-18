import { describe, it, expect } from "vitest";
import { stageSeconds, fmtDuration, DEFAULT_CALIBRATION, vectorCutSeconds } from "./model";
import { ringsBBox, ringsFillArea } from "./geometry";

type Pt = { x: number; y: number };
const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
function band(partW: number, partH: number, t: number) {
  return [rect(0, 0, partW + 2 * t, partH + 2 * t), rect(t, t, partW, partH)];
}
function geomOf(rings: Pt[][]) {
  const b = ringsBBox(rings);
  return { bboxW: b.w, bboxH: b.h, fillAreaMm2: ringsFillArea(rings), perimeterMm: 0 };
}

const PROBES: Array<{ name: string; partW: number; partH: number; t: number; slice: number; repeat: number; speed: number; density: number; sec: number }> = [
  { name: "p01", partW: 30, partH: 20, t: 0.1, slice: 50, repeat: 1, speed: 300, density: 100, sec: 196 },
  { name: "p03", partW: 30, partH: 20, t: 0.1, slice: 200, repeat: 1, speed: 300, density: 100, sec: 784 },
  { name: "p05", partW: 30, partH: 20, t: 1.0, slice: 50, repeat: 1, speed: 300, density: 100, sec: 365 },
  { name: "p07", partW: 60, partH: 40, t: 0.1, slice: 50, repeat: 1, speed: 300, density: 100, sec: 634 },
  { name: "p09", partW: 30, partH: 20, t: 0.1, slice: 256, repeat: 1, speed: 300, density: 100, sec: 1008 },
  { name: "p10", partW: 30, partH: 20, t: 0.1, slice: 50, repeat: 1, speed: 300, density: 200, sec: 394 },
  { name: "p12", partW: 30, partH: 20, t: 1.0, slice: 50, repeat: 1, speed: 100, density: 100, sec: 724 },
  { name: "p13", partW: 30, partH: 20, t: 0.1, slice: 100, repeat: 1, speed: 200, density: 300, sec: 1232 },
];

describe("cut-time model", () => {
  it.each(PROBES)("predicts $name within 12% of Studio", (p) => {
    const est = stageSeconds(
      geomOf(band(p.partW, p.partH, p.t)),
      { sliceNumber: p.slice, repeat: p.repeat, speedMmS: p.speed, densityLpc: p.density },
      DEFAULT_CALIBRATION,
    );
    expect(Math.abs(est - p.sec) / p.sec).toBeLessThan(0.12);
  });

  it("scales linearly with slices and repeat", () => {
    const g = geomOf(band(30, 20, 0.1));
    const base = stageSeconds(g, { sliceNumber: 50, repeat: 1, speedMmS: 300, densityLpc: 100 });
    const x2s = stageSeconds(g, { sliceNumber: 100, repeat: 1, speedMmS: 300, densityLpc: 100 });
    const x2r = stageSeconds(g, { sliceNumber: 50, repeat: 2, speedMmS: 300, densityLpc: 100 });
    expect(x2s / base).toBeCloseTo(2, 1);
    expect(x2r / base).toBeCloseTo(2, 1);
  });

  it("fmtDuration formats m:ss and h:mm:ss", () => {
    expect(fmtDuration(196)).toBe("3:16");
    expect(fmtDuration(11437)).toBe("3:10:37");
    expect(fmtDuration(0)).toBe("0:00");
  });
});

describe("vectorCutSeconds", () => {
  it("is passes × (length/speed) + a per-pass overhead", () => {
    expect(vectorCutSeconds(1000, 2, 500)).toBeCloseTo(4.02, 6); // 2 × (1000/500 + 0.01)
  });
  it("floors passes and speed at 1", () => {
    expect(vectorCutSeconds(100, 0, 0)).toBeCloseTo(100 / 1 + 0.01, 6); // passes→1, speed→1
  });
  it("zero length → just the per-pass overhead", () => {
    expect(vectorCutSeconds(0, 3, 500)).toBeCloseTo(3 * 0.01, 6);
  });
});
