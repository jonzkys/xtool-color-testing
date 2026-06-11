// web/src/lib/forge/pipeline.ts
import type {
  Contour,
  DebugStats,
  ForgeConfig,
  GeneratedClass,
  GeneratedPath,
  ParsedXcs,
  PipelineResult,
} from "./types";
import { extractContourSubpaths, calibrateMmPerUnit } from "./xcs";
import { optimalScanAngle, perpendicularExtentAt } from "./scanangle";
import { inferWindingAndOutside } from "./contour";
import { buildPartRegion } from "./offset";
import { estimateForge } from "./estimate";
import { fmtDuration } from "../cuttime/model";
import {
  generateCleanPaths,
  generateDeepenPaths,
  generatePerforationPaths,
  generateSeedPaths,
} from "./stages";
import { generateSpiralPaths } from "./spiral";

/** Scale a contour's points from path units → mm. */
function toMm(c: Contour, mmPerUnit: number): Contour {
  return { points: c.points.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit })), closed: c.closed };
}

/**
 * Run the full generation pipeline against the selected incise object. Returns
 * ordered GeneratedPath[] (seed → perforate → deepen A..D → clean) plus debug
 * stats + warnings. Pure: no I/O, no DOM. Throws only on unrecoverable input
 * (no such object / not a vector path) — soft issues become warnings.
 */
export function runPipeline(
  parsed: ParsedXcs,
  inciseId: string,
  cfg: ForgeConfig,
): PipelineResult {
  const obj = parsed.objects.find((o) => o.id === inciseId);
  if (!obj) throw new Error(`incise object ${inciseId} not found`);

  const warnings: string[] = [];

  const cal = calibrateMmPerUnit(parsed, obj);
  // A valid override is a positive number. `0 ?? x` slips 0 through (?? only
  // catches null/undefined) — and a 0 unit scale poisons every exported
  // coordinate with Infinity. Treat non-positive overrides as absent.
  const override = cfg.mmPerUnitOverride != null && cfg.mmPerUnitOverride > 0 ? cfg.mmPerUnitOverride : null;
  const mmPerUnit = override ?? cal.mmPerUnit;
  if (!cal.confident && override == null) {
    warnings.push("Could not calibrate path units → mm from the file; using 1.0. Set a manual mm/unit.");
  }

  const rawSubpaths = extractContourSubpaths(obj);
  if (rawSubpaths.length === 0) {
    throw new Error(`incise object ${inciseId} is not a usable vector/path contour`);
  }
  const subpaths = rawSubpaths.map((c) => toMm(c, mmPerUnit));

  // Speed-optimal raster scan angle from the mm-space geometry. Computed
  // always (shown in the debug panel); applied to export only behind the toggle.
  const scanAngleDeg = optimalScanAngle(subpaths);
  const baselineDeg = obj.sourceScanAngleDeg;
  const optimalExtent = perpendicularExtentAt(subpaths, scanAngleDeg);
  const baselineExtent = baselineDeg != null ? perpendicularExtentAt(subpaths, baselineDeg) : undefined;
  const scanAngleReductionPct =
    baselineExtent && baselineExtent > 0
      ? Math.max(0, Math.round((1 - optimalExtent / baselineExtent) * 100))
      : undefined;

  // Winding check — run per subpath; warn once if any is not confident.
  let windingWarned = false;
  for (const c of subpaths) {
    const winding = inferWindingAndOutside(c);
    if (!winding.confident && !windingWarned) {
      warnings.push("Inside/outside could not be inferred with confidence — choose a side (flip) before export.");
      windingWarned = true;
    }
  }

  // Reconstruct the part-solid region ONCE from the nested loops. Every stage's
  // kerf is a scrap-side band around this region (the part body is a hole in
  // each band), so there are no per-subpath tiny displays.
  const part = buildPartRegion(subpaths);
  if (part.length === 0) {
    warnings.push("Could not reconstruct a part region from the incise contour; no paths generated.");
    const empty: Record<GeneratedClass, number> = { seed: 0, perforate: 0, deepen: 0, clean: 0, spiral: 0 };
    return {
      paths: [],
      stats: {
        mmPerUnit,
        mmPerUnitConfident: cal.confident || override != null,
        pathCounts: empty,
        totalPaths: 0,
        warnings,
        scanAngleDeg,
        scanAngleBaselineDeg: baselineDeg,
        scanAngleReductionPct,
        estimate: {
          stages: [], totalSeconds: 0, baselineSeconds: 0, overheadPct: 0,
          pierces: 0, pocketCount: 0, bandCount: 0,
          budgetX: cfg.timeBudgetX ?? null, overBudget: false, worst: [],
        },
      },
    };
  }

  // Physical process order: seed → perforate → deepen → clean across the whole
  // part, then re-stamp a global operationOrder.
  const seed = generateSeedPaths(part, cfg, inciseId);
  const perf = generatePerforationPaths(part, cfg, inciseId);
  const deepen = generateDeepenPaths(part, cfg, inciseId);
  const clean = generateCleanPaths(part, cfg, inciseId);
  const spiralPaths = generateSpiralPaths(part, cfg, inciseId);

  // Standalone guard: spiral is mutually exclusive with incise stages.
  if (
    cfg.spiral.enabled &&
    (cfg.seed.enabled ||
      cfg.perforate.enabled ||
      cfg.clean.enabled ||
      cfg.deepen.groups.some((g) => g.enabled))
  ) {
    warnings.push(
      "Spiral Cut is standalone — incise stages are enabled too; export will emit spiral-only (mixed cut+incise is unsupported).",
    );
  }

  const ordered: GeneratedPath[] = [...seed, ...perf, ...deepen, ...clean, ...spiralPaths];
  ordered.forEach((p, i) => (p.operationOrder = i));

  const estimate = estimateForge(ordered, part, cfg, obj.params);
  if (estimate.overBudget) {
    const worst = estimate.worst
      .map((w) => `${w.groupName.replace(/^CUT_\d+_/, "")} ${fmtDuration(w.seconds)}`)
      .join(", ");
    warnings.push(
      `Estimated cut ${fmtDuration(estimate.totalSeconds)} ≈ ` +
      `${(estimate.overheadPct / 100).toFixed(1)}× a plain incise ` +
      `(budget ${estimate.budgetX}×). Biggest: ${worst}. ` +
      `Reduce slices/width, clean passes, or perforation density.`,
    );
  }

  const pathCounts: Record<GeneratedClass, number> = {
    seed: seed.length,
    perforate: perf.length,
    deepen: deepen.length,
    clean: clean.length,
    spiral: spiralPaths.length,
  };

  const stats: DebugStats = {
    mmPerUnit,
    mmPerUnitConfident: cal.confident || override != null,
    pathCounts,
    totalPaths: ordered.length,
    warnings,
    scanAngleDeg,
    scanAngleBaselineDeg: baselineDeg,
    scanAngleReductionPct,
    estimate,
  };
  return { paths: ordered, stats };
}
