import {
  deltaE76,
  hueDeg,
  wrapHueDelta,
  type Lab,
} from "../color/math";
import type { ResultRecord, ValidationCell } from "../types";

export interface StatsSeriesEntry {
  result: ResultRecord;
  /** Map cell_index → measured Lab so we can re-derive every stat. */
  cells: Map<number, { hex: string; lab: Lab }>;
  /** Display label for the card header. */
  label: string;
}

export interface PerResultStats {
  resultId: number;
  label: string;
  totalCells: number;
  sampleCount: number;
  meanDeltaL: number;
  meanDeltaA: number;
  meanDeltaB: number;
  medianDeltaE: number;
  maxDeltaE: number;
  worstCellIndex: number | null;
  meanDeltaHue: number;
}

export interface AcrossRunsStats {
  medianSigma: number;
  worstSigma: { value: number; cellIndex: number | null };
  topVariable: { cellIndex: number; sigma: number }[];
}

export function computePerResultStats(
  cells: ValidationCell[],
  s: StatsSeriesEntry,
): PerResultStats {
  let dLs = 0, dAs = 0, dBs = 0;
  let dHueAcc = 0;
  let n = 0;
  let maxDE = 0;
  let worstCell: number | null = null;
  const dEs: number[] = [];
  for (const c of cells) {
    const exp = c.expected_lab as Lab | number[];
    if (!Array.isArray(exp) || exp.length !== 3) continue;
    const m = s.cells.get(c.cell_index);
    if (!m) continue;
    const e: Lab = [exp[0], exp[1], exp[2]];
    dLs += m.lab[0] - e[0];
    dAs += m.lab[1] - e[1];
    dBs += m.lab[2] - e[2];
    dHueAcc += wrapHueDelta(
      hueDeg(m.lab[1], m.lab[2]) - hueDeg(e[1], e[2]),
    );
    const dE = deltaE76(e, m.lab);
    dEs.push(dE);
    if (dE > maxDE) {
      maxDE = dE;
      worstCell = c.cell_index;
    }
    n++;
  }
  if (n === 0) {
    return {
      resultId: s.result.id,
      label: s.label,
      totalCells: cells.length,
      sampleCount: 0,
      meanDeltaL: 0,
      meanDeltaA: 0,
      meanDeltaB: 0,
      medianDeltaE: 0,
      maxDeltaE: 0,
      worstCellIndex: null,
      meanDeltaHue: 0,
    };
  }
  return {
    resultId: s.result.id,
    label: s.label,
    totalCells: cells.length,
    sampleCount: n,
    meanDeltaL: dLs / n,
    meanDeltaA: dAs / n,
    meanDeltaB: dBs / n,
    medianDeltaE: median(dEs),
    maxDeltaE: maxDE,
    worstCellIndex: worstCell,
    meanDeltaHue: dHueAcc / n,
  };
}

/** Per-cell σ across runs (RMS Lab deviation from the centroid),
 *  median + worst + top-10 most-variable list. Mirrors the math the
 *  chart uses for its "per-cell σ" axis so chart and stats stay in
 *  lockstep. */
export function computeAcrossRunsStats(
  cells: ValidationCell[],
  series: StatsSeriesEntry[],
): AcrossRunsStats {
  const perCell: { cellIndex: number; sigma: number }[] = [];
  for (const c of cells) {
    const labs: Lab[] = [];
    for (const s of series) {
      const m = s.cells.get(c.cell_index);
      if (m) labs.push(m.lab);
    }
    if (labs.length < 2) continue;
    let mL = 0, mA = 0, mB = 0;
    for (const l of labs) {
      mL += l[0] / labs.length;
      mA += l[1] / labs.length;
      mB += l[2] / labs.length;
    }
    let v = 0;
    for (const l of labs) {
      v += (l[0] - mL) ** 2 + (l[1] - mA) ** 2 + (l[2] - mB) ** 2;
    }
    perCell.push({
      cellIndex: c.cell_index,
      sigma: Math.sqrt(v / labs.length),
    });
  }
  if (perCell.length === 0) {
    return {
      medianSigma: 0,
      worstSigma: { value: 0, cellIndex: null },
      topVariable: [],
    };
  }
  const sortedDesc = [...perCell].sort((a, b) => b.sigma - a.sigma);
  const sortedSigmas = perCell.map((p) => p.sigma).sort((a, b) => a - b);
  return {
    medianSigma: median(sortedSigmas),
    worstSigma: {
      value: sortedDesc[0].sigma,
      cellIndex: sortedDesc[0].cellIndex,
    },
    topVariable: sortedDesc.slice(0, 10),
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function signedNum(v: number, decimals = 1): string {
  const sign = v > 0 ? "+" : "";
  const decs = Math.abs(v) >= 100 ? 0 : decimals;
  return `${sign}${v.toFixed(decs)}`;
}
