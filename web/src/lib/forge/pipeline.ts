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
import { inferWindingAndOutside } from "./contour";
import { buildPartRegion } from "./offset";
import {
  generateCleanPaths,
  generateDeepenPaths,
  generatePerforationPaths,
  generateSeedPaths,
} from "./stages";

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
  const mmPerUnit = cfg.mmPerUnitOverride ?? cal.mmPerUnit;
  if (!cal.confident && cfg.mmPerUnitOverride == null) {
    warnings.push("Could not calibrate path units → mm from the file; using 1.0. Set a manual mm/unit.");
  }

  const rawSubpaths = extractContourSubpaths(obj);
  if (rawSubpaths.length === 0) {
    throw new Error(`incise object ${inciseId} is not a usable vector/path contour`);
  }
  const subpaths = rawSubpaths.map((c) => toMm(c, mmPerUnit));

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
    const empty: Record<GeneratedClass, number> = { seed: 0, perforate: 0, deepen: 0, clean: 0 };
    return {
      paths: [],
      stats: {
        mmPerUnit,
        mmPerUnitConfident: cal.confident || cfg.mmPerUnitOverride != null,
        pathCounts: empty,
        totalPaths: 0,
        warnings,
      },
    };
  }

  // Physical process order: seed → perforate → deepen → clean across the whole
  // part, then re-stamp a global operationOrder.
  const seed = generateSeedPaths(part, cfg, inciseId);
  const perf = generatePerforationPaths(part, cfg, inciseId);
  const deepen = generateDeepenPaths(part, cfg, inciseId);
  const clean = generateCleanPaths(part, cfg, inciseId);

  const ordered: GeneratedPath[] = [...seed, ...perf, ...deepen, ...clean];
  ordered.forEach((p, i) => (p.operationOrder = i));

  const pathCounts: Record<GeneratedClass, number> = {
    seed: seed.length,
    perforate: perf.length,
    deepen: deepen.length,
    clean: clean.length,
  };

  const stats: DebugStats = {
    mmPerUnit,
    mmPerUnitConfident: cal.confident || cfg.mmPerUnitOverride != null,
    pathCounts,
    totalPaths: ordered.length,
    warnings,
  };
  return { paths: ordered, stats };
}
